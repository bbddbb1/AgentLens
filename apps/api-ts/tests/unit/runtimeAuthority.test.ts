import { describe, expect, it } from 'vitest';
import {
  eventsThroughCursor,
  projectRuntimeExplanation,
  projectRuntimeSummary,
  type EventEnvelope,
} from '@agentlens/protocol';
import { attachExplanationToNodes } from '../../src/services/missionStore.js';
import { projectReplay, projectReplayEvidence, projectRuntimeStateAtFrame } from '../../src/services/runtime/projection.js';

const missionId = '1dca0da4-d87e-44ed-8745-267e8d6f6114';
const llmSpanId = 'f04b063d21b885a2';

const capturedAuthoritySpans = [
  {
    span_id: 'ce72dfbedb6eb4c3', trace_id: 'trace-captured', parent_span_id: null,
    operation_name: 'mission.execute', start_time_unix_nano: '1783949756767000000',
    end_time_unix_nano: '1783949765226527200', status_code: 'OK',
    attributes: { 'gen_ai.workflow.status': 'completed', 'gen_ai.workflow.phase': 'completed' }, events: [],
  },
  {
    span_id: 'abcca24aaea726fa', trace_id: 'trace-captured', parent_span_id: 'ce72dfbedb6eb4c3',
    operation_name: 'mission.lifecycle', start_time_unix_nano: '1783949756767000000',
    end_time_unix_nano: '1783949765226469600', status_code: 'OK', attributes: {},
    events: [{
      name: 'basestation.aiops.workflow.completed', timestamp: '1783949765224337300',
      attributes: { 'basestation.aiops.terminal': true, 'basestation.aiops.terminal.status': 'ok' },
    }],
  },
  {
    span_id: llmSpanId, trace_id: 'trace-captured', parent_span_id: 'abcca24aaea726fa',
    operation_name: 'llm.call', start_time_unix_nano: '1783949756835000000',
    end_time_unix_nano: '1783949765222012400', status_code: 'OK',
    attributes: { 'gen_ai.request.model': 'deepseek-v4-flash' },
    events: [{
      name: 'basestation.aiops.llm.terminated', timestamp: '1783949765222001500',
      attributes: { 'basestation.aiops.terminal': true, 'basestation.aiops.terminal.status': 'ok' },
    }],
  },
];

describe('captured mission runtime authority', () => {
  it('admits one complete span revision atomically instead of source-time slicing it', () => {
    const replay = projectReplay(missionId, 'main', capturedAuthoritySpans);
    const terminalIndex = replay.events.findIndex((entry) => entry.span_id === llmSpanId && entry.id.includes('-event-'));
    const terminal = replay.events[terminalIndex]!;
    const start = replay.events.find((entry) => entry.span_id === llmSpanId && entry.id === llmSpanId)!;
    const atAdmission = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
      as_of_sequence_num: terminal.sequence_num,
    });

    expect(start.sequence_num).toBe(terminal.sequence_num);
    expect(atAdmission.activities.find((activity) => activity.source_span_id === llmSpanId)?.status).toBe('completed');
    const graph = replay.snapshots.find((snapshot) => snapshot.sequence_num === terminal.sequence_num)!;
    expect(attachExplanationToNodes(graph.nodes, atAdmission).find((node) => node.span_id === llmSpanId)?.status).toBe('completed');
  });

  it('does not manufacture an active subframe inside a complete admitted root revision', () => {
    const replay = projectReplay(missionId, 'main', capturedAuthoritySpans);
    const rootStart = replay.events.find((entry) => entry.id === 'ce72dfbedb6eb4c3')!;
    const historical = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
      as_of_sequence_num: rootStart.sequence_num,
    });
    const finalFrame = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
    });

    expect(historical.run_outcome).toBe('completed');
    expect(historical.runtime_phase?.label).toBe('Completed');
    expect(finalFrame.run_outcome).toBe('completed');
    expect(finalFrame.runtime_phase?.label).toBe('Completed');
    expect(replay.current_state).toMatchObject({ status: 'completed', phase: 'Completed' });
  });

  it('preserves adjacent source nanoseconds as distinct exact ordering keys', () => {
    const t = '1783949765222001500';
    const replay = projectReplayEvidence(missionId, 'main', [
      {
        branch_id: 'main', admission_seq: 1, revision_num: 1,
        span_id: 'later', trace_id: 'trace-ns', parent_span_id: null,
        operation_name: 'later', start_time_unix_nano: '1783949765222001501',
        end_time_unix_nano: '1783949765222001501', status_code: 'OK', attributes: {}, events: [],
      },
      {
        branch_id: 'main', admission_seq: 2, revision_num: 1,
        span_id: 'earlier', trace_id: 'trace-ns', parent_span_id: null,
        operation_name: 'earlier', start_time_unix_nano: t,
        end_time_unix_nano: '1783949765222001501', status_code: 'OK', attributes: {}, events: [],
      },
    ]);

    const starts = eventsThroughCursor(replay.events, 2).filter((event) => event.id === event.span_id);
    expect(starts.map((event) => event.metadata?.runtime_timestamp_unix_nano)).toEqual([
      '1783949765222001500',
      '1783949765222001501',
    ]);
    expect(starts.map((event) => event.id)).toEqual(['earlier', 'later']);
    expect(replay.snapshots.at(-1)?.nodes.find((node) => node.source_span_id === 'earlier')?.duration_ms)
      .toBe(0.000001);
  });

  it('keeps late telemetry and corrected span revisions out of a published frame', () => {
    const root = {
      branch_id: 'main', admission_seq: 1, revision_num: 1,
      span_id: 'root', trace_id: 'trace-foundation', parent_span_id: null,
      operation_name: 'mission.execute', start_time_unix_nano: '100',
      end_time_unix_nano: '500', status_code: 'OK', attributes: {}, events: [],
    };
    const revisionA = {
      branch_id: 'main', admission_seq: 2, revision_num: 1,
      span_id: 'worker', trace_id: 'trace-foundation', parent_span_id: 'root',
      operation_name: 'tool.lookup', start_time_unix_nano: '300',
      end_time_unix_nano: '0', status_code: 'UNSET', attributes: { version: 'A' },
      events: [{ name: 'tool.started', timestamp: '300', attributes: { version: 'A' } }],
    };
    const lateEarlier = {
      branch_id: 'main', admission_seq: 3, revision_num: 1,
      span_id: 'late', trace_id: 'trace-foundation', parent_span_id: 'root',
      operation_name: 'late.lookup', start_time_unix_nano: '200',
      end_time_unix_nano: '250', status_code: 'OK', attributes: {}, events: [],
    };
    const revisionB = {
      ...revisionA,
      admission_seq: 4,
      revision_num: 2,
      end_time_unix_nano: '450',
      status_code: 'OK',
      attributes: { version: 'B', enriched: true },
      events: [
        ...revisionA.events,
        { name: 'tool.completed', timestamp: '400', attributes: { version: 'B' } },
      ],
    };

    const before = projectReplay(missionId, 'main', [root, revisionA]);
    const published = before.snapshots.find((snapshot) => snapshot.sequence_num === 2)!;
    const publishedEvents = eventsThroughCursor(before.events, 2);
    const after = projectReplay(missionId, 'main', [root, revisionA, lateEarlier, revisionB]);
    const reread = after.snapshots.find((snapshot) => snapshot.sequence_num === 2)!;
    const rereadEvents = eventsThroughCursor(after.events, 2);

    expect(reread).toEqual(published);
    expect(rereadEvents).toEqual(publishedEvents);
    expect(rereadEvents.some((event) => event.source_span_id === 'late')).toBe(false);
    expect(rereadEvents.some((event) => event.event_type === 'tool.completed')).toBe(false);
    expect(reread.nodes.find((node) => node.source_span_id === 'worker')).toMatchObject({ status: 'active' });

    const laterEvents = eventsThroughCursor(after.events, 4);
    expect(laterEvents.some((event) => event.source_span_id === 'late')).toBe(true);
    expect(laterEvents.some((event) => event.event_type === 'tool.completed')).toBe(true);
    expect(after.snapshots.find((snapshot) => snapshot.sequence_num === 4)?.nodes
      .find((node) => node.source_span_id === 'worker')).toMatchObject({ status: 'completed' });
  });

  it('uses one admission cutoff for evidence, explanation, summary, graph, and current state', () => {
    const spans = [
      {
        branch_id: 'main', admission_seq: 1, revision_num: 1,
        span_id: 'shared', trace_id: 'trace-shared', parent_span_id: null,
        operation_name: 'tool.lookup', start_time_unix_nano: '100', end_time_unix_nano: '0',
        status_code: 'UNSET', attributes: {}, events: [],
      },
      {
        branch_id: 'main', admission_seq: 2, revision_num: 2,
        span_id: 'shared', trace_id: 'trace-shared', parent_span_id: null,
        operation_name: 'tool.lookup', start_time_unix_nano: '100', end_time_unix_nano: '300',
        status_code: 'OK', attributes: {},
        events: [{ name: 'tool.completed', timestamp: '250', attributes: { result_count: 1 } }],
      },
    ];
    const replay = projectReplay(missionId, 'main', spans);
    const cutoff = 1;
    const evidence = eventsThroughCursor(replay.events, cutoff);
    const explanation = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[], as_of_sequence_num: cutoff,
    });
    const summary = projectRuntimeSummary({
      mission_id: missionId, branch_id: 'main', objective: 'shared cutoff', status: 'active', phase: 'executing',
      events: replay.events, up_to_sequence_num: cutoff,
    });
    const graph = replay.snapshots.find((snapshot) => snapshot.sequence_num === cutoff)!;
    const currentState = projectRuntimeStateAtFrame(missionId, 'main', replay.events, graph);

    expect(new Set(evidence.map((event) => event.sequence_num))).toEqual(new Set([cutoff]));
    expect(explanation.as_of_sequence_num).toBe(cutoff);
    expect(summary.sequence_num).toBe(cutoff);
    expect(graph.sequence_num).toBe(cutoff);
    expect(evidence.some((event) => event.event_type === 'tool.completed')).toBe(false);
    expect(graph.nodes.find((node) => node.source_span_id === 'shared')).toMatchObject({ status: 'active' });
    expect(currentState.sequence_num).toBe(cutoff);
    expect(currentState.nodes).toEqual(graph.nodes);
    expect(currentState.edges).toEqual(graph.edges);
    expect(replay.current_state?.sequence_num).toBe(2);
    expect(replay.current_state?.nodes).toEqual(replay.snapshots.at(-1)?.nodes);
  });

  it('keeps admitted interrupt request and decision evidence independent of later aggregate state', () => {
    const admitted = {
      branch_id: 'main', interrupt_id: 'interrupt-immutable', agent_id: 'agent-1', span_id: null,
      status: 'approved', reason: 'mutable reason', payload: { mutable: true },
      requested_evidence: {
        agent_id: 'agent-1', interrupt_id: 'interrupt-immutable', reason: 'original reason',
        resume_url: null, payload: { original: true },
      },
      created_at: '2026-01-01T00:00:00.000Z', requested_admission_seq: 1,
      decision: 'approve', decision_comment: 'approved once', decided_at: '2026-01-01T00:00:01.000Z',
      decided_admission_seq: 2, delivery_state: 'pending', runtime_outcome: 'awaiting_interaction',
    };
    const before = projectReplayEvidence(missionId, 'main', [], [admitted]);
    const after = projectReplayEvidence(missionId, 'main', [], [{
      ...admitted,
      reason: 'later corrected aggregate',
      payload: { mutable: 'changed' },
      delivery_state: 'delivered',
      runtime_outcome: 'resumed',
    }]);

    expect(eventsThroughCursor(after.events, 2)).toEqual(eventsThroughCursor(before.events, 2));
    expect(after.events.find((event) => event.event_type === 'interrupt.requested')?.payload)
      .toMatchObject({ reason: 'original reason', original: true });
    expect(after.events.find((event) => event.event_type === 'interrupt.decision')?.payload)
      .not.toHaveProperty('delivery_state');
  });

  it('reconstructs equivalent deterministic evidence and projections repeatedly', () => {
    const spans = capturedAuthoritySpans.map((span, index) => ({
      ...span,
      branch_id: 'main',
      admission_seq: index + 1,
      revision_num: 1,
    }));
    const first = projectReplay(missionId, 'main', spans);
    const second = projectReplay(missionId, 'main', spans);

    expect(second.events).toEqual(first.events);
    expect(second.snapshots).toEqual(first.snapshots);
    expect(second.current_state).toEqual(first.current_state);
  });

  it('keeps evidence materialization below explanation and Replay compatibility fields', () => {
    const evidence = projectReplayEvidence(missionId, 'main', capturedAuthoritySpans);
    expect(evidence.current_state).toMatchObject({ status: 'unknown', phase: 'Unknown' });

    const explanation = projectRuntimeExplanation({
      mission_id: missionId,
      branch_id: 'main',
      events: evidence.events as EventEnvelope[],
    });
    const replay = projectReplay(missionId, 'main', capturedAuthoritySpans);

    expect(explanation.run_outcome).toBe('completed');
    expect(replay.current_state?.status).toBe(explanation.run_outcome);
    expect(replay.current_state?.status_provenance).toEqual(explanation.run_outcome_provenance);
    expect(replay.current_state?.phase).toBe(explanation.runtime_phase?.label);
    expect(replay.current_state?.runtime_phase).toEqual(explanation.runtime_phase);
  });
});
