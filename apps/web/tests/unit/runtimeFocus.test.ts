import { describe, expect, it, vi } from 'vitest';
import type {
  GraphSnapshot,
  RuntimeExplanationActivity,
  RuntimeExplanationProjection,
} from '@agentlens/protocol';
import { focusRuntimeActivity, matchNodeToActivity, resolveSelectedActivity } from '@/lib/runtimeFocus';

function activity(id: string, spanId = 'shared-span'): RuntimeExplanationActivity {
  return {
    id,
    kind: 'llm',
    title: id,
    action: 'Invoke model',
    status: 'completed',
    outcome: 'Unknown',
    source_span_id: spanId,
    evidence_refs: [{ event_id: `event-${id}`, sequence_num: 1, timestamp: '2026-01-01T00:00:00.000Z', branch_id: 'main' }],
  };
}

const snapshot: GraphSnapshot = {
  id: 'snapshot-1',
  mission_id: 'm1',
  branch_id: 'main',
  sequence_num: 1,
  timestamp: '2026-01-01T00:00:00.000Z',
  nodes: [{
    id: 'span-node',
    type: 'agent',
    label: 'Shared span',
    status: 'unknown',
    source_span_id: 'shared-span',
    position: { x: 0, y: 0 },
  }],
  edges: [],
};

const explanation: RuntimeExplanationProjection = {
  mission_id: 'm1',
  branch_id: 'main',
  as_of_sequence_num: 1,
  projection_version: 'runtime_explanation.v1',
  run_outcome: 'completed',
  activities: [activity('llm:request-a'), activity('llm:request-b')],
  relations: [],
  parallel_groups: [],
  merge_groups: [],
  consistency_flags: [],
};

describe('canonical runtime focus', () => {
  it('never invents activity identity from a shared source span', () => {
    expect(matchNodeToActivity(snapshot, activity('llm:request-a'))).toBeNull();
    expect(resolveSelectedActivity(explanation, snapshot, null, 'span-node', null)).toBeNull();
  });

  it('resolves only explicit canonical activity and evidence identities', () => {
    expect(resolveSelectedActivity(explanation, snapshot, 'llm:request-b', null, null)?.id).toBe('llm:request-b');
    expect(resolveSelectedActivity(explanation, snapshot, null, null, 'event-llm:request-a')?.id).toBe('llm:request-a');
  });

  it('changes frame before applying same-frame activity focus', () => {
    const calls: string[] = [];
    const target = {
      setSelectedEventId: vi.fn((value: string | null) => calls.push(`event:${value}`)),
      setSelectedActivityId: vi.fn((value: string | null) => calls.push(`activity:${value}`)),
      setSelectedNodeId: vi.fn((value: string | null) => calls.push(`node:${value}`)),
      setCurrentFrame: vi.fn((value: number) => calls.push(`frame:${value}`)),
    };
    focusRuntimeActivity(activity('llm:request-a'), [snapshot], [{
      id: 'event-llm:request-a',
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 1,
      branch_sequence_num: 1,
      event_type: 'framework.interaction',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {},
      metadata: {},
    }], target);

    expect(calls).toEqual([
      'frame:0',
      'event:event-llm:request-a',
      'activity:llm:request-a',
      'node:null',
    ]);
  });
});
