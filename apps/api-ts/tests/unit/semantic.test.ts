import { describe, expect, it } from 'vitest';
import { projectRuntimeExplanation, type EventEnvelope } from '@agentlens/protocol';
import { generateMissionSummary, generateWhyThisState } from '../../src/services/semantic.js';
import type { MissionAggregate } from '../../src/types/mission.js';

function missionAggregate(overrides: Partial<MissionAggregate> = {}): MissionAggregate {
  return {
    mission: {
      id: 'm1', objective: 'Observe execution', status: 'active', phase: 'executing',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T01:00:00.000Z',
      metadata: {}, is_encrypted: false, visibility: 'private',
    },
    agents: [],
    snapshots: [],
    ...overrides,
  };
}

function event(
  sequence_num: number,
  event_type: string,
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    id: overrides.id ?? `e-${sequence_num}`,
    mission_id: 'm1', branch_id: 'main', branch_sequence_num: sequence_num,
    sequence_num, event_type,
    timestamp: `2026-01-01T00:00:0${sequence_num}.000Z`,
    payload: {}, metadata: {},
    ...overrides,
  };
}

describe('generateMissionSummary', () => {
  it('reports the container state without inventing execution when no snapshot exists', async () => {
    const result = await generateMissionSummary(missionAggregate());

    expect(result.summary).toBe('Mission container status is active; no execution snapshot is recorded.');
    expect(result.conflicts).toEqual([]);
    expect(result.anomalies).toEqual([]);
  });

  it('describes recorded node and edge counts without causal diagnosis', async () => {
    const result = await generateMissionSummary(missionAggregate({
      snapshots: [{
        id: 'frame-7', mission_id: 'm1', sequence_num: 7,
        timestamp: '2026-01-01T00:00:07.000Z',
        nodes: [
          { id: 'a', type: 'agent', label: 'A', status: 'active', position: { x: 0, y: 0 } },
          { id: 'b', type: 'task', label: 'B', status: 'waiting', position: { x: 1, y: 0 } },
        ],
        edges: [{ id: 'edge', source: 'a', target: 'b', type: 'dependency', status: 'active' }],
      }],
    }));

    expect(result.summary).toContain('Latest recorded graph snapshot is frame 7.');
    expect(result.summary).toContain('Recorded node states: 1 active, 1 waiting.');
    expect(result.summary).toContain('Recorded graph relationships: 1 dependency.');
    expect(result.summary).not.toMatch(/blocked|caused|next step|coordinating/i);
  });

  it('does not infer loops or conflict from repeated recorded delegation edges', async () => {
    const snapshots = Array.from({ length: 10 }, (_, sequence_num) => ({
      id: `frame-${sequence_num}`, mission_id: 'm1', sequence_num,
      timestamp: `2026-01-01T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
      nodes: [],
      edges: [{
        id: `edge-${sequence_num}`, source: 'a', target: 'b',
        type: 'delegation' as const, status: 'completed' as const,
      }],
    }));
    const result = await generateMissionSummary(missionAggregate({ snapshots }));

    expect(result.conflicts).toEqual([]);
    expect(result.anomalies).toEqual([]);
    expect(result.summary).not.toMatch(/loop|excessive|diverging/i);
  });
});

describe('generateWhyThisState', () => {
  it('reports canonical frame status and activity counts only', async () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [event(0, 'tool.called', {
        payload: { 'gen_ai.tool.name': 'lookup' },
        span_id: 'tool-span', causal: { tool_call_id: 'lookup-1' },
      })],
    });
    const result = await generateWhyThisState({ explanation });

    expect(result.frame?.sequence_num).toBe(0);
    expect(result.summary).toContain('RuntimeExplanation reports run status');
    expect(result.summary).toContain('1 runtime activities');
    expect(result.summary).not.toMatch(/because|blocked|next step|shaping/i);
    expect(result.evidence_refs?.map((ref) => ref.event_id)).toEqual(['e-0']);
  });

  it('reports a decision reference without claiming runtime continuation', async () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [
        event(0, 'task.started', {
          id: 'request', span_id: 'request-span', payload: { task: 'review request' },
        }),
        event(1, 'task.started', {
          id: 'decision', span_id: 'decision-span', payload: { task: 'recorded decision' },
          causal: { decision_for_event_id: 'request' },
        }),
      ],
    });
    const result = await generateWhyThisState({ explanation });

    expect(result.summary).toContain('1 decision reference');
    expect(result.summary).not.toMatch(/resumed|continued|caused/i);
  });
});
