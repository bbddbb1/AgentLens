import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtlpIngestRequestSchema } from '@agentlens/protocol';
import { eventsThroughCursor } from '@agentlens/protocol/internal';
import { initializeDatabase, pool } from '../../src/db/postgres.js';
import { missionStore } from '../../src/services/missionStore.js';
import { registerBridgeBinding } from '../../src/services/interrupts/bridgeBindings.js';
import { applyRuntimeOutcome, claimDelivery, postDeliveryReceipt } from '../../src/services/interrupts/deliveryLifecycle.js';
import { parseGovernanceStateHistory } from '../../src/services/interrupts/governanceState.js';
import { reconcileInterruptActionability } from '../../src/services/interrupts/reconcileActionability.js';
import { GovernanceControlError } from '../../src/services/interrupts/controlAuthority.js';
import { normalizeSpansToFacts } from '../../src/services/runtime/normalization/index.js';

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
      const successorBindingId = randomUUID();
      try {
        await successorClient.query('BEGIN');
        await expect(registerBridgeBinding(successorClient, {
          missionId: mission.id, branchId: 'main', controlRef: 'successor-control-0123456789', leaseSeconds: 120,
          interruptId: 'irq-valid', interactionRequestId: 'irq-valid', framework: 'langgraph',
          nativeIdentity: {
            mission_id: mission.id, branch_id: 'main', framework: 'langgraph', interaction_request_id: 'irq-valid', thread_id: 'thread-irq-valid',
          },
        })).rejects.toMatchObject({ code: '23505' });
        await successorClient.query('ROLLBACK');
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

  it('scopes source-local span and invocation identity while preserving real revisions', async () => {
    const id = randomUUID();
    governanceMissionIds.push(id);
    const makeSpan = (traceId: string, marker: string) => ({
      trace_id: traceId,
      span_id: 'reused-span',
      parent_span_id: null,
      operation_name: 'agent.invoke',
      start_time_unix_nano: traceId === 'trace-a' ? '1000' : '1001',
      end_time_unix_nano: traceId === 'trace-a' ? '1010' : '1011',
      status_code: 'OK',
      attributes: { marker },
      events: [
        { name: 'tool.called', timestamp: '1002', attributes: { tool_call_id: 'reused-call' } },
        { name: 'tool.completed', timestamp: '1003', attributes: { tool_call_id: 'reused-call' } },
      ],
    });
    await missionStore.ingestSpans(id, [makeSpan('trace-a', 'a'), makeSpan('trace-b', 'b')]);

    const persisted = await pool.query(
      `SELECT trace_id, span_id, revision_num FROM spans WHERE mission_id = $1 ORDER BY trace_id, revision_num`,
      [id],
    );
    expect(persisted.rows).toEqual([
      { trace_id: 'trace-a', span_id: 'reused-span', revision_num: 1 },
      { trace_id: 'trace-b', span_id: 'reused-span', revision_num: 1 },
    ]);
    const facts = normalizeSpansToFacts([
      { ...makeSpan('trace-a', 'a'), branch_id: 'main' },
      { ...makeSpan('trace-b', 'b'), branch_id: 'main' },
    ]);
    const tools = facts.activities.filter((activity) => activity.kind === 'tool');
    expect(tools).toHaveLength(2);
    expect(new Set(tools.map((activity) => activity.id)).size).toBe(2);
    expect(tools.every((activity) => activity.invocation_id === 'reused-call')).toBe(true);

    await missionStore.ingestSpans(id, [{
      ...makeSpan('trace-a', 'a-corrected'),
      end_time_unix_nano: '1020',
    }]);
    const revisions = await pool.query(
      `SELECT trace_id, revision_num, attributes->>'marker' AS marker
       FROM spans WHERE mission_id = $1 ORDER BY trace_id, revision_num`,
      [id],
    );
    expect(revisions.rows).toEqual([
      { trace_id: 'trace-a', revision_num: 1, marker: 'a' },
      { trace_id: 'trace-a', revision_num: 2, marker: 'a-corrected' },
      { trace_id: 'trace-b', revision_num: 1, marker: 'b' },
    ]);
  });

  it('reconstructs one coherent database snapshot when a span commit races the frame read', async () => {
    const id = randomUUID();
    governanceMissionIds.push(id);
    await missionStore.ingestSpans(id, [{
      trace_id: 'snapshot-trace', span_id: 'before', parent_span_id: null,
      operation_name: 'before', start_time_unix_nano: '2000', end_time_unix_nano: '2001',
      status_code: 'OK', attributes: {}, events: [],
    }]);

    const writer = await pool.connect();
    const monitor = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('LOCK TABLE spans IN ACCESS EXCLUSIVE MODE');
      const reading = missionStore.getReplayFromTelemetry(id, 'main');
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        const state = await monitor.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database()
             AND query LIKE '%FROM spans%mission_id%branch_id%'
             AND wait_event_type = 'Lock'`,
        );
        blocked = (state.rowCount ?? 0) > 0;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await writer.query(`UPDATE evidence_admission_counters SET next_seq = 3 WHERE mission_id = $1`, [id]);
      await writer.query(
        `INSERT INTO spans (
           id, mission_id, branch_id, trace_id, span_id, parent_span_id, name,
           start_time_unix_nano, end_time_unix_nano, status_code, attributes, events,
           admission_seq, revision_num
         ) VALUES ($1,$2,'main','snapshot-trace','after',NULL,'after',2002,2003,'OK','{}','[]',2,1)`,
        [randomUUID(), id],
      );
      await writer.query(
        `INSERT INTO interrupts (
           id, mission_id, branch_id, interrupt_id, reason, requested_admission_seq,
           requested_evidence, request_lifecycle, runtime_outcome, governance_state_history, control_mode
         ) VALUES (
           $1,$2,'main','after-request','after request',3,
           '{"interrupt_id":"after-request","reason":"after request","payload":{}}',
           'pending','awaiting_interaction',
           '[{"transition_id":"request:3:pending:test","admission_seq":3,"axis":"request","state":"pending","recorded_at":"2026-01-01T00:00:00.000Z","source":"interrupt_request"},{"transition_id":"runtime:3:awaiting_interaction:test","admission_seq":3,"axis":"runtime","state":"awaiting_interaction","recorded_at":"2026-01-01T00:00:00.000Z","source":"interrupt_request"}]',
           'unavailable'
         )`,
        [randomUUID(), id],
      );
      await writer.query('COMMIT');
      const raced = await reading;
      expect(raced?.events.some((event) => event.source_span_id === 'after')).toBe(false);
      expect(raced?.current_state?.interrupts).not.toHaveProperty('after-request');
      const afterCommit = await missionStore.getReplayFromTelemetry(id, 'main');
      expect(afterCommit?.events.some((event) => event.source_span_id === 'after')).toBe(true);
      expect(afterCommit?.current_state?.interrupts).toHaveProperty('after-request');
    } finally {
      await writer.query('ROLLBACK').catch(() => undefined);
      writer.release();
      monitor.release();
    }
  });

  it('inherits the exact parent Governance prefix without a lossy child row', async () => {
    const mission = await missionStore.createMission({ objective: 'exact governance fork' });
    governanceMissionIds.push(mission.id);
    const token = 'fork-exact-token-0123456789';
    await missionStore.createInterrupt({
      mission_id: mission.id, interrupt_id: 'fork-request', reason: 'exact reason',
      resume_token: token, payload: { visible: 'recorded' },
    });
    await missionStore.decideInterrupt(mission.id, 'fork-request', {
      branch_id: 'main', decision: 'approve', comment: 'recorded decision', idempotency_key: 'fork-decision',
    });
    const parentBefore = await missionStore.getReplayFromTelemetry(mission.id, 'main');
    const cutoff = parentBefore!.snapshots.at(-1)!.sequence_num;
    const child = await missionStore.createReplayBranch(mission.id, {
      name: 'governance child', source_branch_id: 'main', forked_from_sequence_num: cutoff,
    });
    const childRows = await pool.query(
      `SELECT 1 FROM interrupts WHERE mission_id = $1 AND branch_id = $2`,
      [mission.id, child!.id],
    );
    expect(childRows.rowCount).toBe(0);
    const childBefore = await missionStore.getReplayFromTelemetry(mission.id, child!.id);
    const childExplanationBefore = await missionStore.getRuntimeExplanation(mission.id, child!.id, cutoff);
    expect(childBefore?.current_state?.interrupts['fork-request']).toMatchObject({
      reason: 'exact reason', decision_state: 'recorded', runtime_outcome: 'awaiting_interaction',
    });
    await missionStore.resumeInterruptByToken(token);
    const childAfter = await missionStore.getReplayFromTelemetry(mission.id, child!.id);
    expect(childAfter?.events).toEqual(childBefore?.events);
    expect(childAfter?.current_state).toEqual(childBefore?.current_state);

    await missionStore.createInterrupt({
      mission_id: mission.id, branch_id: child!.id, interrupt_id: 'fork-request',
      reason: 'child-local collision', resume_token: 'child-fork-token-0123456789',
    });
    const childWithLocal = await missionStore.getReplayFromTelemetry(mission.id, child!.id);
    const childExplanationReread = await missionStore.getRuntimeExplanation(mission.id, child!.id, cutoff);
    expect(childExplanationReread).toEqual(childExplanationBefore);
    expect(childExplanationReread?.activities.some((activity) => activity.id === 'human:fork-request')).toBe(true);
    const colliding = Object.values(childWithLocal?.current_state?.interrupts ?? {})
      .filter((interrupt) => String(interrupt.interrupt_id).endsWith('fork-request'));
    expect(colliding).toHaveLength(2);
    expect(new Set(colliding.map((interrupt) => interrupt.interrupt_id)).size).toBe(2);
    expect(new Set(colliding.map((interrupt) => interrupt.reason))).toEqual(
      new Set(['exact reason', 'child-local collision']),
    );
    expect((await missionStore.getReplayFromTelemetry(mission.id, 'main'))?.current_state?.interrupts)
      .toHaveProperty('fork-request');
  });

  it('enforces unique mutation authority, deterministic expiry, and credential isolation', async () => {
    const mission = await missionStore.createMission({ objective: 'authority adversary' });
    governanceMissionIds.push(mission.id);
    const token = 'unique-legacy-token-0123456789';
    await missionStore.createInterrupt({
      mission_id: mission.id, interrupt_id: 'legacy-one', reason: 'legacy one', resume_token: token,
      payload: { resume_token: token, safe: true },
    });
    await expect(missionStore.createInterrupt({
      mission_id: mission.id, interrupt_id: 'legacy-two', reason: 'legacy two', resume_token: token,
    })).rejects.toMatchObject({ code: '23505' });
    expect((await pool.query(
      `SELECT COUNT(*)::int AS count FROM interrupts WHERE resume_token_hash IS NOT NULL AND mission_id = $1`,
      [mission.id],
    )).rows[0].count).toBe(1);

    const storedLegacy = (await pool.query(
      `SELECT payload, requested_evidence FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'legacy-one'`,
      [mission.id],
    )).rows[0];
    expect(JSON.stringify(storedLegacy)).not.toContain(token);
    expect(JSON.stringify(storedLegacy)).not.toContain('resume_token');

    const genericDecision = await missionStore.decideInterrupt(mission.id, 'legacy-one', {
      branch_id: 'main', decision: 'resume', idempotency_key: 'generic-resume-decision',
    });
    expect(genericDecision).toMatchObject({
      decision_state: 'recorded', request_lifecycle: 'pending', runtime_outcome: 'awaiting_interaction',
    });
    const beforeDedicatedResume = (await pool.query(
      `SELECT governance_state_history FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'legacy-one'`,
      [mission.id],
    )).rows[0];
    expect(parseGovernanceStateHistory(beforeDedicatedResume.governance_state_history)
      .some((transition) => transition.axis === 'runtime' && transition.state === 'resumed')).toBe(false);
    const genericDecisionAdmission = Math.max(...parseGovernanceStateHistory(beforeDedicatedResume.governance_state_history)
      .filter((transition) => transition.axis === 'decision')
      .map((transition) => transition.admission_seq));
    expect((await missionStore.getRuntimeExplanation(mission.id, 'main', genericDecisionAdmission))?.run_outcome)
      .toBe('waiting');
    expect(await missionStore.resumeInterruptByToken(token)).toMatchObject({ runtime_outcome: 'resumed' });

    await missionStore.createInterrupt({
      mission_id: mission.id, interrupt_id: 'expired-request', reason: 'expired',
      resume_token: 'expired-token-0123456789', expires_at: '2000-01-01T00:00:00.000Z',
    });
    const beforeExpiry = (await pool.query(
      `SELECT request_lifecycle, governance_state_history FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'expired-request'`,
      [mission.id],
    )).rows[0];
    const expiryClient = await pool.connect();
    try {
      await expiryClient.query('BEGIN');
      const evaluation = await reconcileInterruptActionability(expiryClient, {
        missionId: mission.id, branchId: 'main', interruptId: 'expired-request', framework: 'langgraph',
      });
      expect(evaluation.actionability).toBe('unavailable');
      await expiryClient.query('COMMIT');
    } finally {
      expiryClient.release();
    }
    const afterExpiry = (await pool.query(
      `SELECT request_lifecycle, governance_state_history FROM interrupts WHERE mission_id = $1 AND interrupt_id = 'expired-request'`,
      [mission.id],
    )).rows[0];
    expect(afterExpiry.request_lifecycle).toBe('pending');
    expect(afterExpiry.governance_state_history).toEqual(beforeExpiry.governance_state_history);
    expect((await missionStore.getReplayFromTelemetry(mission.id, 'main'))
      ?.current_state?.interrupts['expired-request']).toMatchObject({
        request_lifecycle: 'pending', runtime_outcome: 'awaiting_interaction', actionability: 'unavailable',
      });

    await missionStore.ingestSpans(mission.id, [{
      trace_id: 'credential-trace', span_id: 'credential-span', parent_span_id: null,
      operation_name: 'credential.probe', start_time_unix_nano: '3000', end_time_unix_nano: '3001', status_code: 'OK',
      attributes: { 'gen_ai.agent.resume.token': 'telemetry-secret', control_ref: 'control-secret', safe: 'visible' },
      events: [{ name: 'agent.interrupt.requested', timestamp: '3000', attributes: {
        interrupt_id: 'credential-request', 'gen_ai.agent.resume.token': 'event-secret', reason: 'credential probe',
      } }],
    }]);
    const raw = (await pool.query(
      `SELECT attributes, events FROM spans WHERE mission_id = $1 AND span_id = 'credential-span'`,
      [mission.id],
    )).rows[0];
    expect(JSON.stringify(raw)).not.toContain('telemetry-secret');
    expect(JSON.stringify(raw)).not.toContain('event-secret');
    expect(JSON.stringify(raw)).not.toContain('control-secret');

    await pool.query(
      `UPDATE spans SET attributes = attributes || '{"nested":{"resume_token":"historical-secret"}}'::jsonb
       WHERE mission_id = $1 AND span_id = 'credential-span'`,
      [mission.id],
    );
    await pool.query(`DROP INDEX idx_interrupts_unique_legacy_resume_token`);
    await pool.query(
      `UPDATE interrupts AS duplicate
       SET resume_token_hash = source.resume_token_hash, control_mode = 'legacy_token'
       FROM interrupts AS source
       WHERE duplicate.mission_id = $1 AND duplicate.interrupt_id = 'expired-request'
         AND source.mission_id = $1 AND source.interrupt_id = 'legacy-one'`,
      [mission.id],
    );
    await pool.query(
      `DELETE FROM agentlens_schema_migrations WHERE name = 'r0_refreeze_control_credential_cleanup'`,
    );
    await initializeDatabase();
    const migrated = (await pool.query(
      `SELECT attributes FROM spans WHERE mission_id = $1 AND span_id = 'credential-span'`,
      [mission.id],
    )).rows[0];
    expect(JSON.stringify(migrated)).not.toContain('historical-secret');
    expect(JSON.stringify(migrated)).not.toContain('resume_token');
    const invalidated = await pool.query(
      `SELECT interrupt_id, resume_token_hash, control_mode
       FROM interrupts WHERE mission_id = $1 AND interrupt_id IN ('legacy-one','expired-request')
       ORDER BY interrupt_id`,
      [mission.id],
    );
    expect(invalidated.rows).toEqual([
      { interrupt_id: 'expired-request', resume_token_hash: null, control_mode: 'unavailable' },
      { interrupt_id: 'legacy-one', resume_token_hash: null, control_mode: 'unavailable' },
    ]);
  });

  it('lets PostgreSQL select at most one active pre-interrupt binding under concurrency', async () => {
    const mission = await missionStore.createMission({ objective: 'binding race' });
    governanceMissionIds.push(mission.id);
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      const input = {
        missionId: mission.id, branchId: 'main', leaseSeconds: 120,
        interactionRequestId: 'pre-request', framework: 'langgraph' as const,
        nativeIdentity: {
          mission_id: mission.id, branch_id: 'main', framework: 'langgraph', interaction_request_id: 'pre-request', thread_id: 'thread-pre',
        },
      };
      await registerBridgeBinding(first, { ...input, controlRef: 'pre-control-one-0123456789' });
      const racing = registerBridgeBinding(second, { ...input, controlRef: 'pre-control-two-0123456789' });
      await new Promise((resolve) => setTimeout(resolve, 25));
      await first.query('COMMIT');
      const successor = await racing;
      await second.query('COMMIT');
      expect((await pool.query(
        `SELECT COUNT(*)::int AS count FROM framework_bridge_bindings
         WHERE mission_id = $1 AND branch_id = 'main' AND interaction_request_id = 'pre-request' AND lifecycle_state = 'active'`,
        [mission.id],
      )).rows[0].count).toBe(1);
      expect((await pool.query(
        `SELECT id FROM framework_bridge_bindings
         WHERE mission_id = $1 AND branch_id = 'main' AND interaction_request_id = 'pre-request' AND lifecycle_state = 'active'`,
        [mission.id],
      )).rows[0].id).toBe(successor.id);

      await pool.query(`DROP INDEX idx_framework_bridge_one_active_request`);
      await pool.query(`DROP INDEX idx_framework_bridge_one_active_interaction`);
      await pool.query(
        `INSERT INTO framework_bridge_bindings (
           id, mission_id, branch_id, framework, interrupt_id, interaction_request_id,
           control_ref_hash, generation, lifecycle_state, registered_at, lease_expires_at,
           last_heartbeat_at, native_identity
         )
         SELECT $2, mission_id, branch_id, framework, interrupt_id, interaction_request_id,
                $3, generation + 1, 'active', NOW(), NOW() + INTERVAL '2 minutes', NOW(), native_identity
         FROM framework_bridge_bindings WHERE id = $1`,
        [successor.id, randomUUID(), 'f'.repeat(64)],
      );
      await initializeDatabase();
      expect((await pool.query(
        `SELECT COUNT(*)::int AS count FROM framework_bridge_bindings
         WHERE mission_id = $1 AND interaction_request_id = 'pre-request' AND lifecycle_state = 'active'`,
        [mission.id],
      )).rows[0].count).toBe(0);
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
  });
});
