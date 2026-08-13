import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsThroughCursor, OtlpIngestRequestSchema } from '@agentlens/protocol';
import { initializeDatabase, pool } from '../../src/db/postgres.js';
import { missionStore } from '../../src/services/missionStore.js';
import { registerBridgeBinding } from '../../src/services/interrupts/bridgeBindings.js';
import { applyRuntimeOutcome, claimDelivery, postDeliveryReceipt } from '../../src/services/interrupts/deliveryLifecycle.js';
import { parseGovernanceStateHistory } from '../../src/services/interrupts/governanceState.js';
import { reconcileInterruptActionability } from '../../src/services/interrupts/reconcileActionability.js';

const hasTestDatabase = Boolean(process.env.AGENTLENS_TEST_DATABASE_URL);
const suite = hasTestDatabase ? describe : describe.skip;

suite('R0-A PostgreSQL evidence/frame foundation', () => {
  const missionId = randomUUID();
  let governanceMissionId = '';
  let childBranchId = '';

  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await missionStore.deleteMission(missionId).catch(() => false);
    if (governanceMissionId) await missionStore.deleteMission(governanceMissionId).catch(() => false);
    await pool.end();
  });

  it('round-trips exact nanoseconds and preserves immutable frames, revisions, and fork prefixes', async () => {
    const timestamp = '1783949765222001500';
    const spanA = {
      trace_id: 'trace-r0a', span_id: 'shared', parent_span_id: null,
      operation_name: 'tool.lookup', start_time_unix_nano: timestamp,
      end_time_unix_nano: timestamp, status_code: 'OK',
      attributes: { revision: 'A' }, events: [],
    };
    const adjacent = {
      trace_id: 'trace-r0a', span_id: 'adjacent', parent_span_id: null,
      operation_name: 'tool.lookup.next', start_time_unix_nano: '1783949765222001501',
      end_time_unix_nano: '1783949765222001501', status_code: 'OK',
      attributes: {}, events: [],
    };

    const validated = OtlpIngestRequestSchema.parse({ mission_id: missionId, spans: [spanA, adjacent] });
    await missionStore.ingestSpans(validated.mission_id, validated.spans, validated.resource_attributes);
    const initial = await missionStore.getReplayFromTelemetry(missionId, 'main');
    expect(initial?.snapshots.map((snapshot) => snapshot.sequence_num)).toEqual([1, 2]);
    const publishedSnapshot = structuredClone(initial?.snapshots.find((snapshot) => snapshot.sequence_num === 2));
    const publishedEvents = structuredClone(eventsThroughCursor(initial?.events ?? [], 2));

    const persisted = await pool.query(
      `SELECT span_id, start_time_unix_nano::text AS start_nano, admission_seq, revision_num
       FROM spans WHERE mission_id = $1 ORDER BY admission_seq`,
      [missionId],
    );
    expect(persisted.rows).toEqual([
      { span_id: 'shared', start_nano: timestamp, admission_seq: 1, revision_num: 1 },
      { span_id: 'adjacent', start_nano: '1783949765222001501', admission_seq: 2, revision_num: 1 },
    ]);
    expect((initial?.events ?? [])
      .filter((event) => event.id === event.span_id)
      .map((event) => event.metadata?.runtime_timestamp_unix_nano)).toEqual([
      timestamp,
      '1783949765222001501',
    ]);

    const child = await missionStore.createReplayBranch(missionId, {
      name: 'Frozen child', source_branch_id: 'main', forked_from_sequence_num: 2,
    });
    expect(child).not.toBeNull();
    childBranchId = child!.id;
    const childBeforeParentChanges = await missionStore.getReplayFromTelemetry(missionId, childBranchId);

    await missionStore.ingestSpans(missionId, [{
      trace_id: 'trace-r0a', span_id: 'late', parent_span_id: null,
      operation_name: 'late.earlier', start_time_unix_nano: '1783949765222001400',
      end_time_unix_nano: '1783949765222001450', status_code: 'OK', attributes: {}, events: [],
    }]);
    await missionStore.ingestSpans(missionId, [{
      ...spanA,
      end_time_unix_nano: '1783949765222001600',
      attributes: { revision: 'B', enriched: true },
      events: [{ name: 'tool.completed', timestamp: '1783949765222001550', attributes: { result_count: 1 } }],
    }]);

    const after = await missionStore.getReplayFromTelemetry(missionId, 'main');
    expect(after?.snapshots.find((snapshot) => snapshot.sequence_num === 2)).toEqual(publishedSnapshot);
    expect(structuredClone(eventsThroughCursor(after?.events ?? [], 2))).toEqual(publishedEvents);
    expect(eventsThroughCursor(after?.events ?? [], 2).some((event) => event.source_span_id === 'late')).toBe(false);
    expect(eventsThroughCursor(after?.events ?? [], 4).some((event) => event.source_span_id === 'late')).toBe(true);
    expect(eventsThroughCursor(after?.events ?? [], 2).some((event) => event.event_type === 'tool.completed')).toBe(false);
    expect(eventsThroughCursor(after?.events ?? [], 4).some((event) => event.event_type === 'tool.completed')).toBe(true);

    const audit = await missionStore.getAuditEvents(missionId, 'main', 2);
    const explanation = await missionStore.getRuntimeExplanation(missionId, 'main', 2);
    const summary = await missionStore.getRuntimeSummary(missionId, 'main', 2);
    const graph = after?.snapshots.find((snapshot) => snapshot.sequence_num === 2);
    expect(structuredClone(audit.events)).toEqual(publishedEvents);
    expect(explanation?.as_of_sequence_num).toBe(2);
    expect(summary?.sequence_num).toBe(2);
    expect(graph?.sequence_num).toBe(2);
    expect(after?.current_state?.sequence_num).toBe(4);
    expect(after?.current_state?.nodes).toEqual(after?.snapshots.at(-1)?.nodes);

    const childAfterParentChanges = await missionStore.getReplayFromTelemetry(missionId, childBranchId);
    expect(childAfterParentChanges?.events).toEqual(childBeforeParentChanges?.events);
    expect(childAfterParentChanges?.snapshots).toEqual(childBeforeParentChanges?.snapshots);

    await missionStore.ingestSpans(missionId, [{
      ...spanA,
      trace_id: 'child-trace',
      operation_name: 'child.same-source-id',
      attributes: { branch: 'child' },
    }], {}, childBranchId);
    const childWithCollision = await missionStore.getReplayFromTelemetry(missionId, childBranchId);
    expect(childWithCollision?.snapshots.find((snapshot) => snapshot.sequence_num === 2))
      .toEqual(childBeforeParentChanges?.snapshots.find((snapshot) => snapshot.sequence_num === 2));
    expect(eventsThroughCursor(childWithCollision?.events ?? [], 2))
      .toEqual(eventsThroughCursor(childBeforeParentChanges?.events ?? [], 2));
    const collisionNodes = childWithCollision?.snapshots.at(-1)?.nodes
      .filter((node) => node.source_span_id === 'shared') ?? [];
    expect(collisionNodes).toHaveLength(2);
    expect(new Set(collisionNodes.map((node) => node.id)).size).toBe(2);

    const repeated = await missionStore.getReplayFromTelemetry(missionId, childBranchId);
    expect(repeated?.events).toEqual(childWithCollision?.events);
    expect(repeated?.snapshots).toEqual(childWithCollision?.snapshots);
    expect(repeated?.current_state).toEqual(childWithCollision?.current_state);

    const revisions = await pool.query(
      `SELECT revision_num, admission_seq, attributes
       FROM spans WHERE mission_id = $1 AND branch_id = 'main' AND span_id = 'shared'
       ORDER BY revision_num`,
      [missionId],
    );
    expect(revisions.rows.map((row) => [row.revision_num, row.admission_seq, row.attributes.revision])).toEqual([
      [1, 1, 'A'],
      [2, 4, 'B'],
    ]);
  });

  it('persists independent Governance axes at exact immutable frame cutoffs', async () => {
    const priorFlag = process.env.LANGGRAPH_GOVERNANCE_ENABLED;
    const priorToken = process.env.AGENTLENS_SERVICE_TOKEN;
    process.env.LANGGRAPH_GOVERNANCE_ENABLED = 'true';
    process.env.AGENTLENS_SERVICE_TOKEN = 'r0-c1-local-test-token';
    try {
      const mission = await missionStore.createMission({ objective: 'R0-C1 persistence acceptance' });
      governanceMissionId = mission.id;
      const interruptId = 'irq-r0-c1';
      await missionStore.createInterrupt({
        mission_id: mission.id,
        interrupt_id: interruptId,
        reason: 'Review required',
      });

      const requestRow = (await pool.query(
        `SELECT * FROM interrupts WHERE mission_id = $1 AND branch_id = 'main' AND interrupt_id = $2`,
        [mission.id, interruptId],
      )).rows[0];
      const requestAdmission = Number(requestRow.requested_admission_seq);
      const requestReplay = await missionStore.getReplayFromTelemetry(mission.id, 'main');
      const frozenRequestEvents = structuredClone(eventsThroughCursor(requestReplay?.events ?? [], requestAdmission));

      let bindingId = '';
      const setupClient = await pool.connect();
      try {
        await setupClient.query('BEGIN');
        const nativeIdentity = {
          mission_id: mission.id,
          branch_id: 'main',
          framework: 'langgraph',
          interaction_request_id: interruptId,
          thread_id: 'thread-r0-c1',
        };
        await setupClient.query(
          `UPDATE interrupts
           SET framework = 'langgraph', native_identity = $3::jsonb,
               supported_decision_types = '["approve","reject"]'::jsonb
           WHERE mission_id = $1 AND branch_id = 'main' AND interrupt_id = $2`,
          [mission.id, interruptId, JSON.stringify(nativeIdentity)],
        );
        const binding = await registerBridgeBinding(setupClient, {
          missionId: mission.id,
          branchId: 'main',
          controlRef: 'control-r0-c1',
          leaseSeconds: 120,
          nativeIdentity,
          interruptId,
          interactionRequestId: interruptId,
          framework: 'langgraph',
        });
        bindingId = binding.id;
        const actionable = await reconcileInterruptActionability(setupClient, {
          missionId: mission.id,
          branchId: 'main',
          interruptId,
          framework: 'langgraph',
        });
        expect(actionable.actionability).toBe('actionable');
        await setupClient.query('COMMIT');
      } catch (error) {
        await setupClient.query('ROLLBACK');
        throw error;
      } finally {
        setupClient.release();
      }

      const decision = await missionStore.decideInterrupt(mission.id, interruptId, {
        branch_id: 'main',
        decision: 'approve',
        idempotency_key: 'r0-c1-decision',
      });
      expect(decision).toMatchObject({
        decision_state: 'recorded', delivery_state: 'pending', runtime_outcome: 'awaiting_interaction',
      });
      let persisted = (await pool.query(
        `SELECT * FROM interrupts WHERE mission_id = $1 AND branch_id = 'main' AND interrupt_id = $2`,
        [mission.id, interruptId],
      )).rows[0];
      const decisionAdmission = Number(persisted.decided_admission_seq);
      const deliveryId = String(persisted.delivery_id);

      const deliveryClient = await pool.connect();
      try {
        await deliveryClient.query('BEGIN');
        const claim = await claimDelivery(deliveryClient, {
          missionId: mission.id,
          branchId: 'main',
          interruptId,
          bindingId,
        });
        expect(claim.claimed).toBe(true);
        await postDeliveryReceipt(deliveryClient, {
          missionId: mission.id,
          branchId: 'main',
          interruptId,
          deliveryId,
          receipt: 'accepted',
        });
        await deliveryClient.query('COMMIT');
      } catch (error) {
        await deliveryClient.query('ROLLBACK');
        throw error;
      } finally {
        deliveryClient.release();
      }

      persisted = (await pool.query(
        `SELECT * FROM interrupts WHERE mission_id = $1 AND branch_id = 'main' AND interrupt_id = $2`,
        [mission.id, interruptId],
      )).rows[0];
      const deliveryAdmission = Math.max(...parseGovernanceStateHistory(persisted.governance_state_history)
        .filter((transition) => transition.axis === 'delivery' && transition.state === 'accepted')
        .map((transition) => transition.admission_seq));

      const outcomeClient = await pool.connect();
      try {
        await outcomeClient.query('BEGIN');
        await applyRuntimeOutcome(outcomeClient, {
          missionId: mission.id,
          branchId: 'main',
          interruptId,
          outcome: 'failed',
          deliveryId,
          requireDeliveryCorrelation: true,
        });
        await outcomeClient.query('COMMIT');
      } catch (error) {
        await outcomeClient.query('ROLLBACK');
        throw error;
      } finally {
        outcomeClient.release();
      }

      persisted = (await pool.query(
        `SELECT * FROM interrupts WHERE mission_id = $1 AND branch_id = 'main' AND interrupt_id = $2`,
        [mission.id, interruptId],
      )).rows[0];
      const outcomeAdmission = Math.max(...parseGovernanceStateHistory(persisted.governance_state_history)
        .filter((transition) => transition.axis === 'runtime' && transition.state === 'failed')
        .map((transition) => transition.admission_seq));
      const replay = await missionStore.getReplayFromTelemetry(mission.id, 'main');
      expect(structuredClone(eventsThroughCursor(replay?.events ?? [], requestAdmission))).toEqual(frozenRequestEvents);

      const stateAt = (sequence: number) => replay?.snapshots.find((snapshot) => snapshot.sequence_num === sequence);
      expect(stateAt(requestAdmission)).toBeDefined();
      expect(stateAt(decisionAdmission)).toBeDefined();
      expect(stateAt(deliveryAdmission)).toBeDefined();
      expect(stateAt(outcomeAdmission)).toBeDefined();

      const decisionExplanation = await missionStore.getRuntimeExplanation(mission.id, 'main', decisionAdmission);
      const deliveryExplanation = await missionStore.getRuntimeExplanation(mission.id, 'main', deliveryAdmission);
      const outcomeExplanation = await missionStore.getRuntimeExplanation(mission.id, 'main', outcomeAdmission);
      expect(decisionExplanation?.run_outcome).toBe('waiting');
      expect(deliveryExplanation?.run_outcome).toBe('waiting');
      expect(outcomeExplanation?.run_outcome).toBe('failed');
      expect(replay?.current_state?.interrupts[interruptId]).toMatchObject({
        request_lifecycle: 'resolved',
        decision_state: 'recorded',
        delivery_state: 'accepted',
        runtime_outcome: 'failed',
      });
    } finally {
      if (priorFlag === undefined) delete process.env.LANGGRAPH_GOVERNANCE_ENABLED;
      else process.env.LANGGRAPH_GOVERNANCE_ENABLED = priorFlag;
      if (priorToken === undefined) delete process.env.AGENTLENS_SERVICE_TOKEN;
      else process.env.AGENTLENS_SERVICE_TOKEN = priorToken;
    }
  });
});
