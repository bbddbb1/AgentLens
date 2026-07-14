import { describe, expect, it } from 'vitest';
import {
  eventsThroughCursor,
  projectRuntimeExplanation,
  projectRuntimeSummary,
  type EventEnvelope,
} from '@agentlens/protocol';
import { attachExplanationToNodes } from '../../src/services/missionStore.js';
import { projectReplay, projectReplayEvidence, projectTraceSnapshot } from '../../src/services/runtime/projection.js';

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
  it('keeps the diagnosis LLM active before terminal evidence and completed after it', () => {
    const replay = projectReplay(missionId, 'main', capturedAuthoritySpans);
    const terminalIndex = replay.events.findIndex((entry) => entry.span_id === llmSpanId && entry.id.includes('-event-'));
    const terminal = replay.events[terminalIndex]!;
    const beforeTerminal = replay.events[terminalIndex - 1]!;
    const before = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
      as_of_sequence_num: beforeTerminal.sequence_num,
    });
    const after = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
      as_of_sequence_num: terminal.sequence_num,
    });

    expect(before.activities.find((activity) => activity.source_span_id === llmSpanId)?.status).toBe('active');
    expect(after.activities.find((activity) => activity.source_span_id === llmSpanId)?.status).toBe('completed');

    const beforeGraph = projectTraceSnapshot(missionId, 'main', capturedAuthoritySpans, 1783949756835000000);
    const afterGraph = projectTraceSnapshot(missionId, 'main', capturedAuthoritySpans, 1783949765222001500);
    expect(attachExplanationToNodes(beforeGraph.nodes, before).find((node) => node.span_id === llmSpanId)?.status).toBe('active');
    expect(attachExplanationToNodes(afterGraph.nodes, after).find((node) => node.span_id === llmSpanId)?.status).toBe('completed');
  });

  it('does not inherit completion at a historical frame and completes at the final frame', () => {
    const replay = projectReplay(missionId, 'main', capturedAuthoritySpans);
    const rootStart = replay.events.find((entry) => entry.id === 'ce72dfbedb6eb4c3')!;
    const historical = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
      as_of_sequence_num: rootStart.sequence_num,
    });
    const finalFrame = projectRuntimeExplanation({
      mission_id: missionId, branch_id: 'main', events: replay.events as EventEnvelope[],
    });

    expect(historical.run_outcome).toBe('active');
    expect(historical.runtime_phase?.label).toBe('Active Work');
    expect(finalFrame.run_outcome).toBe('completed');
    expect(finalFrame.runtime_phase?.label).toBe('Completed');
    expect(replay.current_state).toMatchObject({ status: 'completed', phase: 'Completed' });
  });

  it('keeps published event and frame cursors stable when earlier telemetry arrives late', () => {
    const initialReplay = projectReplay(missionId, 'main', capturedAuthoritySpans);
    const initialEventIdentity = new Map(initialReplay.events.map((event) => [event.id, event.sequence_num]));
    const initialFrameIdentity = new Map(initialReplay.snapshots.map((snapshot) => [snapshot.id, {
      sequence_num: snapshot.sequence_num,
      source_event_sequence_num: snapshot.source_event_sequence_num,
      timestamp: snapshot.timestamp,
    }]));
    const llmTerminal = initialReplay.events.find((event) =>
      event.span_id === llmSpanId && event.id.includes('-event-'))!;
    const publishedCutoff = llmTerminal.sequence_num;

    const lateSpan = {
      span_id: 'late-evidence', trace_id: 'trace-captured', parent_span_id: 'ce72dfbedb6eb4c3',
      operation_name: 'tool.lookup', start_time_unix_nano: '1783949756800000000',
      end_time_unix_nano: '1783949756810000000', status_code: 'OK', attributes: {},
      events: [{
        name: 'tool.result', timestamp: '1783949756805000000', attributes: { result_count: 1 },
      }],
    };
    const reloadedReplay = projectReplay(missionId, 'main', [...capturedAuthoritySpans, lateSpan]);

    for (const [eventId, sequenceNum] of initialEventIdentity) {
      expect(reloadedReplay.events.find((event) => event.id === eventId)?.sequence_num).toBe(sequenceNum);
    }
    for (const [frameId, identity] of initialFrameIdentity) {
      expect(reloadedReplay.snapshots.find((snapshot) => snapshot.id === frameId)).toMatchObject(identity);
    }
    expect(reloadedReplay.events.find((event) => event.id === llmTerminal.id)?.sequence_num).toBe(publishedCutoff);

    const auditEvidence = eventsThroughCursor(reloadedReplay.events, publishedCutoff);
    const explanation = projectRuntimeExplanation({
      mission_id: missionId,
      branch_id: 'main',
      events: reloadedReplay.events as EventEnvelope[],
      as_of_sequence_num: publishedCutoff,
    });
    const summary = projectRuntimeSummary({
      mission_id: missionId,
      branch_id: 'main',
      objective: 'captured mission',
      status: 'active',
      phase: 'executing',
      events: reloadedReplay.events,
      up_to_sequence_num: publishedCutoff,
    });
    const graphFrame = reloadedReplay.snapshots.find((snapshot) => snapshot.source_event_id === llmSpanId)!;
    const graphNodes = attachExplanationToNodes(graphFrame.nodes, explanation);

    expect(auditEvidence.some((event) => event.span_id === 'late-evidence')).toBe(true);
    expect(auditEvidence.at(-1)?.sequence_num).toBe(publishedCutoff);
    expect(explanation.as_of_sequence_num).toBe(publishedCutoff);
    expect(explanation.as_of_timestamp).toBe(llmTerminal.timestamp);
    expect(summary.sequence_num).toBe(publishedCutoff);
    expect(summary.frame?.as_of_timestamp).toBe(llmTerminal.timestamp);
    expect(graphNodes.find((node) => node.span_id === llmSpanId)?.status).toBe('completed');
    expect(eventsThroughCursor(reloadedReplay.events, Number.MAX_SAFE_INTEGER)).toEqual([]);
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
    expect(replay.current_state?.phase).toBe(explanation.runtime_phase?.label);
  });
});
