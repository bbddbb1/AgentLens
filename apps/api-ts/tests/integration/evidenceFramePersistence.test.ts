import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsThroughCursor, OtlpIngestRequestSchema } from '@agentlens/protocol';
import { initializeDatabase, pool } from '../../src/db/postgres.js';
import { missionStore } from '../../src/services/missionStore.js';
import { registerBridgeBinding } from '../../src/services/interrupts/bridgeBindings.js';
import { applyRuntimeOutcome, claimDelivery, postDeliveryReceipt } from '../../src/services/interrupts/deliveryLifecycle.js';
import { parseGovernanceStateHistory } from '../../src/services/interrupts/governanceState.js';
import { reconcileInterruptActionability } from '../../src/services/interrupts/reconcileActionability.js';
import { GovernanceControlError } from '../../src/services/interrupts/controlAuthority.js';

const hasTestDatabase = Boolean(process.env.AGENTLENS_TEST_DATABASE_URL);
const suite = hasTestDatabase ? describe : describe.skip;

suite('R0-A PostgreSQL evidence/frame foundation', () => {
  const missionId = randomUUID();
  const governanceMissionIds: string[] = [];
  let childBranchId = '';

  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await missionStore.deleteMission(missionId).catch(() => false);
    for (const id of governanceMissionIds) await missionStore.deleteMission(id).catch(() => false);
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
      governanceMissionIds.push(mission.id);
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
           SET framework = 'langgraph', control_mode = 'framework_binding', native_identity = $3::jsonb,
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
          bindingId,
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

  it('fails closed on exact current control authority and preserves one idempotent mutation', async () => {
    const priorFlag = process.env.LANGGRAPH_GOVERNANCE_ENABLED;
    const priorToken = process.env.AGENTLENS_SERVICE_TOKEN;
    process.env.LANGGRAPH_GOVERNANCE_ENABLED = 'true';
    process.env.AGENTLENS_SERVICE_TOKEN = 'r0-c2-local-test-token';
    try {
      const mission = await missionStore.createMission({ objective: 'R0-C2 control acceptance' });
      governanceMissionIds.push(mission.id);

      const prepareFrameworkRequest = async (
        interruptId: string,
        options: { binding?: boolean; threadId?: string; bindingThreadId?: string; supported?: string[]; schema?: Record<string, unknown> } = {},
      ): Promise<{ bindingId?: string; controlRef?: string }> => {
        await missionStore.createInterrupt({
          mission_id: mission.id,
          interrupt_id: interruptId,
          reason: `Review ${interruptId}`,
        });
        const threadId = options.threadId ?? `thread-${interruptId}`;
        const identity = {
          mission_id: mission.id,
          branch_id: 'main',
          framework: 'langgraph',
          interaction_request_id: interruptId,
          thread_id: threadId,
        };
        await pool.query(
          `UPDATE interrupts
           SET framework = 'langgraph', control_mode = 'framework_binding', native_identity = $3::jsonb,
               supported_decision_types = $4::jsonb, safe_input_schema = $5::jsonb,
               actionability = 'observed_only'
           WHERE mission_id = $1 AND branch_id = 'main' AND interrupt_id = $2`,
          [mission.id, interruptId, JSON.stringify(identity), JSON.stringify(options.supported ?? ['approve', 'reject']), options.schema ? JSON.stringify(options.schema) : null],
        );
        if (options.binding === false) return {};
        const controlRef = `control-${interruptId}-0123456789`;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const binding = await registerBridgeBinding(client, {
            missionId: mission.id,
            branchId: 'main',
            controlRef,
            leaseSeconds: 120,
            nativeIdentity: { ...identity, thread_id: options.bindingThreadId ?? threadId },
            interruptId,
            interactionRequestId: interruptId,
            framework: 'langgraph',
          });
          await reconcileInterruptActionability(client, {
            missionId: mission.id,
            branchId: 'main',
            interruptId,
            framework: 'langgraph',
          });
          await client.query('COMMIT');
          return { bindingId: binding.id, controlRef };
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };

      const valid = await prepareFrameworkRequest('irq-valid');
      const first = await missionStore.decideInterrupt(mission.id, 'irq-valid', {
        branch_id: 'main', decision: 'approve', comment: 'ship', idempotency_key: 'c2-idempotent',
      });
      const repeated = await missionStore.decideInterrupt(mission.id, 'irq-valid', {
        branch_id: 'main', decision: 'approve', comment: 'ship', idempotency_key: 'c2-idempotent',
      });
      expect(repeated?.decision_id).toBe(first?.decision_id);
      await expect(missionStore.decideInterrupt(mission.id, 'irq-valid', {
        branch_id: 'main', decision: 'approve', comment: 'different', idempotency_key: 'c2-idempotent',
      })).rejects.toMatchObject<Partial<GovernanceControlError>>({ code: 'idempotency_conflict' });
      const durable = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM interrupt_delivery_attempts WHERE mission_id = $1 AND interrupt_id = 'irq-valid') AS deliveries,
           (SELECT jsonb_array_length(governance_state_history) FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'irq-valid') AS revisions`,
        [mission.id],
      );
      expect(durable.rows[0]).toMatchObject({ deliveries: 1, revisions: 4 });

      const successorClient = await pool.connect();
      let successorBindingId = '';
      try {
        await successorClient.query('BEGIN');
        const successor = await registerBridgeBinding(successorClient, {
          missionId: mission.id, branchId: 'main', controlRef: 'successor-control-0123456789', leaseSeconds: 120,
          interruptId: 'irq-valid', interactionRequestId: 'irq-valid', framework: 'langgraph',
          nativeIdentity: {
            mission_id: mission.id, branch_id: 'main', framework: 'langgraph', interaction_request_id: 'irq-valid', thread_id: 'thread-irq-valid',
          },
        });
        successorBindingId = successor.id;
        await successorClient.query('COMMIT');
      } catch (error) {
        await successorClient.query('ROLLBACK');
        throw error;
      } finally {
        successorClient.release();
      }

      const deliveryClient = await pool.connect();
      try {
        await deliveryClient.query('BEGIN');
        expect((await claimDelivery(deliveryClient, {
          missionId: mission.id, branchId: 'main', interruptId: 'irq-valid', bindingId: successorBindingId,
        })).claimed).toBe(false);
        const claim = await claimDelivery(deliveryClient, {
          missionId: mission.id, branchId: 'main', interruptId: 'irq-valid', bindingId: valid.bindingId!,
        });
        expect(claim.claimed).toBe(true);
        expect(await postDeliveryReceipt(deliveryClient, {
          missionId: mission.id, branchId: 'main', interruptId: 'irq-valid', deliveryId: claim.deliveryId!,
          receipt: 'accepted', bindingId: successorBindingId,
        })).toBe('unknown');
        expect(await postDeliveryReceipt(deliveryClient, {
          missionId: mission.id, branchId: 'main', interruptId: 'irq-valid', deliveryId: claim.deliveryId!,
          receipt: 'failed', bindingId: valid.bindingId!,
        })).toBe('failed');
        await deliveryClient.query('COMMIT');
      } catch (error) {
        await deliveryClient.query('ROLLBACK');
        throw error;
      } finally {
        deliveryClient.release();
      }
      expect((await missionStore.listInterrupts(mission.id, undefined, 'main'))?.find((row) => row.interrupt_id === 'irq-valid'))
        .toMatchObject({ decision_state: 'recorded', delivery_state: 'failed', runtime_outcome: 'awaiting_interaction' });

      await prepareFrameworkRequest('irq-disabled');
      const beforeDisabled = await pool.query(
        `SELECT decision_state, delivery_state, governance_state_history FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'irq-disabled'`,
        [mission.id],
      );
      process.env.LANGGRAPH_GOVERNANCE_ENABLED = 'false';
      await expect(missionStore.decideInterrupt(mission.id, 'irq-disabled', {
        branch_id: 'main', decision: 'approve', idempotency_key: 'disabled',
      })).rejects.toMatchObject<Partial<GovernanceControlError>>({ code: 'control_unavailable' });
      process.env.LANGGRAPH_GOVERNANCE_ENABLED = 'true';
      const afterDisabled = await pool.query(
        `SELECT decision_state, delivery_state, governance_state_history FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'irq-disabled'`,
        [mission.id],
      );
      expect(afterDisabled.rows[0]).toEqual(beforeDisabled.rows[0]);

      await prepareFrameworkRequest('irq-missing-binding', { binding: false });
      await expect(missionStore.decideInterrupt(mission.id, 'irq-missing-binding', {
        branch_id: 'main', decision: 'approve', idempotency_key: 'missing',
      })).rejects.toMatchObject<Partial<GovernanceControlError>>({ code: 'not_actionable' });
      await prepareFrameworkRequest('irq-conflict', { bindingThreadId: 'wrong-thread' });
      await expect(missionStore.decideInterrupt(mission.id, 'irq-conflict', {
        branch_id: 'main', decision: 'approve', idempotency_key: 'conflict',
      })).rejects.toMatchObject<Partial<GovernanceControlError>>({ code: 'identity_conflict' });

      await prepareFrameworkRequest('irq-structured', { supported: ['structured_response'] });
      await expect(missionStore.decideInterrupt(mission.id, 'irq-structured', {
        branch_id: 'main', decision: 'revise', payload: {}, idempotency_key: 'structured',
      })).rejects.toMatchObject<Partial<GovernanceControlError>>({ code: 'invalid_decision' });

      await missionStore.createInterrupt({ mission_id: mission.id, interrupt_id: 'irq-unknown', reason: 'unknown' });
      await pool.query(
        `UPDATE interrupts SET control_mode = 'framework_binding', framework = 'future_framework', native_identity = '{}'::jsonb
         WHERE mission_id = $1 AND interrupt_id = 'irq-unknown'`,
        [mission.id],
      );
      await expect(missionStore.decideInterrupt(mission.id, 'irq-unknown', {
        branch_id: 'main', decision: 'approve', idempotency_key: 'unknown',
      })).rejects.toMatchObject<Partial<GovernanceControlError>>({ code: 'control_unsupported' });

      const legacyToken = 'legacy-control-token-0123456789';
      await missionStore.createInterrupt({ mission_id: mission.id, interrupt_id: 'irq-legacy', reason: 'legacy', resume_token: legacyToken });
      const legacyDecision = await missionStore.decideInterrupt(mission.id, 'irq-legacy', {
        branch_id: 'main', decision: 'approve', idempotency_key: 'legacy',
      });
      expect(legacyDecision).toMatchObject({ control_mode: 'legacy_token', decision_state: 'recorded', runtime_outcome: 'awaiting_interaction' });
      expect(await missionStore.resumeInterruptByToken(legacyToken)).toMatchObject({ runtime_outcome: 'resumed' });

      const frameworkToken = 'framework-token-0123456789';
      await missionStore.createInterrupt({ mission_id: mission.id, interrupt_id: 'irq-no-token-bypass', reason: 'framework', resume_token: frameworkToken });
      await pool.query(
        `UPDATE interrupts SET control_mode = 'framework_binding', framework = 'langgraph', native_identity = '{}'::jsonb
         WHERE mission_id = $1 AND interrupt_id = 'irq-no-token-bypass'`,
        [mission.id],
      );
      expect(await missionStore.resumeInterruptByToken(frameworkToken)).toBeNull();
      expect((await missionStore.listInterrupts(mission.id, undefined, 'main'))
        ?.find((row) => row.interrupt_id === 'irq-no-token-bypass'))
        .toMatchObject({ decision_state: 'none', delivery_state: 'not_requested', runtime_outcome: 'awaiting_interaction' });
    } finally {
      if (priorFlag === undefined) delete process.env.LANGGRAPH_GOVERNANCE_ENABLED;
      else process.env.LANGGRAPH_GOVERNANCE_ENABLED = priorFlag;
      if (priorToken === undefined) delete process.env.AGENTLENS_SERVICE_TOKEN;
      else process.env.AGENTLENS_SERVICE_TOKEN = priorToken;
    }
  });
});
