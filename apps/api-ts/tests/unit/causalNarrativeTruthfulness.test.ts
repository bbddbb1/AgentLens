import { describe, expect, it } from 'vitest';
import {
  projectRuntimeExplanation,
  projectRuntimeSummary,
  type EventEnvelope,
} from '@agentlens/protocol';
import { generateWhyThisState } from '../../src/services/semantic.js';
import {
  buildNodeProjection,
  enhanceNodeProjectionWithLlm,
  enhanceRuntimeSummaryWithLlm,
} from '../../src/services/runtimeSummary.js';

function event(
  sequence_num: number,
  event_type: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    id: overrides.id ?? `e-${sequence_num}`,
    mission_id: 'm1',
    branch_id: 'main',
    branch_sequence_num: sequence_num,
    sequence_num,
    event_type,
    timestamp: overrides.timestamp ?? `2026-07-01T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    payload,
    metadata: {},
    ...overrides,
  };
}

describe('R0-B2b2 causal and narrative truthfulness', () => {
  it('keeps parent span structural and does not use it as trigger or downstream effect', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'task.started', { task: 'root' }, { id: 'root', span_id: 'root-span' }),
        event(1, 'tool.called', { 'gen_ai.tool.name': 'lookup' }, {
          id: 'child',
          span_id: 'child-span',
          causal: { parent_span_id: 'root-span', tool_call_id: 'lookup-1' },
        }),
      ],
    });

    expect(explanation.relations).toEqual([
      expect.objectContaining({ basis: 'parent_span' }),
    ]);
    const child = explanation.activities.find((activity) => activity.id === 'tool:lookup-1');
    const root = explanation.activities.find((activity) => activity.source_span_id === 'root-span');
    expect(child?.operator_facing_record?.trigger).toMatchObject({
      basis: 'unknown', condition: 'not_recorded', evidence_refs: [],
    });
    expect(root?.operator_facing_record?.downstream_effect).toMatchObject({
      basis: 'unknown', condition: 'not_recorded', evidence_refs: [],
    });
  });

  it('uses only an explicit trigger reference for trigger and causal downstream presentation', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'task.started', { task: 'root' }, { id: 'root', span_id: 'root-span' }),
        event(1, 'tool.called', { 'gen_ai.tool.name': 'lookup' }, {
          id: 'triggered-child',
          span_id: 'child-span',
          causal: { triggered_by_event_id: 'root', tool_call_id: 'lookup-1' },
        }),
      ],
    });

    const relation = explanation.relations[0];
    expect(relation).toMatchObject({ basis: 'trigger_reference' });
    expect(relation?.evidence_refs.map((ref) => ref.event_id)).toEqual(['triggered-child']);
    const child = explanation.activities.find((activity) => activity.id === 'tool:lookup-1');
    const root = explanation.activities.find((activity) => activity.source_span_id === 'root-span');
    expect(child?.operator_facing_record?.trigger).toMatchObject({ basis: 'derived', condition: 'recorded' });
    expect(child?.operator_facing_record?.trigger.evidence_refs?.map((ref) => ref.event_id))
      .toEqual(['triggered-child']);
    expect(root?.operator_facing_record?.downstream_effect).toMatchObject({ basis: 'derived', condition: 'recorded' });
    expect(root?.operator_facing_record?.downstream_effect.evidence_refs?.map((ref) => ref.event_id))
      .toEqual(['triggered-child']);
  });

  it('does not promote shared-parent interval overlap into parallel or merge semantics', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'task.started', { task: 'root' }, { span_id: 'root-span' }),
        event(1, 'tool.called', { 'gen_ai.tool.name': 'a' }, {
          span_id: 'child-a', causal: { parent_span_id: 'root-span', tool_call_id: 'a' },
        }),
        event(2, 'tool.called', { 'gen_ai.tool.name': 'b' }, {
          span_id: 'child-b', causal: { parent_span_id: 'root-span', tool_call_id: 'b' },
        }),
        event(3, 'tool.completed', { 'gen_ai.tool.name': 'a' }, {
          span_id: 'child-a', timestamp: '2026-07-01T00:00:05.000Z',
          causal: { parent_span_id: 'root-span', tool_call_id: 'a' },
        }),
        event(4, 'tool.completed', { 'gen_ai.tool.name': 'b' }, {
          span_id: 'child-b', timestamp: '2026-07-01T00:00:06.000Z',
          causal: { parent_span_id: 'root-span', tool_call_id: 'b' },
        }),
      ],
    });

    expect(explanation.parallel_groups).toEqual([]);
    expect(explanation.merge_groups).toEqual([]);
    expect(explanation.consistency_flags).toContainEqual(expect.objectContaining({
      code: 'ambiguous_parallelism',
      message: expect.stringContaining('overlap in recorded time'),
    }));
  });

  it('does not convert chronological adjacency into a relationship', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'a' }, {
          span_id: 'a-span', causal: { tool_call_id: 'a' },
        }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'a' }, {
          span_id: 'a-span', causal: { tool_call_id: 'a' },
        }),
        event(2, 'tool.called', { 'gen_ai.tool.name': 'b' }, {
          span_id: 'b-span', causal: { tool_call_id: 'b' },
        }),
      ],
    });

    expect(explanation.relations).toEqual([]);
  });

  it('does not promote failure or waiting into an unrecorded blocking claim', () => {
    const summary = projectRuntimeSummary({
      mission_id: 'm1', branch_id: 'main', objective: 'test', status: 'active', phase: 'executing',
      events: [event(0, 'tool.failed', {
        'gen_ai.tool.name': 'lookup', error: 'unavailable',
      }, { span_id: 'tool-span', causal: { tool_call_id: 'lookup-1' } })],
    });

    expect(summary.is_blocked).toBe(false);
    expect(summary.pending_work.some((item) => item.kind === 'blocked')).toBe(false);
    expect(summary.warnings).toContainEqual(expect.objectContaining({ text: expect.stringContaining('failed') }));
  });

  it('keeps decision references distinct from trigger references', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'task.started', { task: 'review request' }, {
          id: 'request', span_id: 'request-span',
        }),
        event(1, 'task.started', { task: 'recorded decision' }, {
          id: 'decision', span_id: 'decision-span', causal: { decision_for_event_id: 'request' },
        }),
      ],
    });

    expect(explanation.relations).toEqual([
      expect.objectContaining({ basis: 'decision_reference' }),
    ]);
    expect(explanation.relations.some((relation) => relation.basis === 'trigger_reference')).toBe(false);
  });

  it('keeps concise-story ranking in the summary instead of making it L1 runtime truth', () => {
    const events = Array.from({ length: 6 }, (_, index) => event(
      index,
      'tool.called',
      { 'gen_ai.tool.name': `tool-${index}` },
      { span_id: `span-${index}`, causal: { tool_call_id: `call-${index}` } },
    ));
    const explanation = projectRuntimeExplanation({ mission_id: 'm1', branch_id: 'main', events });
    const reordered = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main', events: [...events].reverse(),
    });
    const summary = projectRuntimeSummary({
      mission_id: 'm1', branch_id: 'main', objective: 'test', status: 'active', phase: 'executing', events,
    });

    expect(explanation.activities).toHaveLength(6);
    expect(explanation.activities.every((activity) => activity.story_critical === undefined)).toBe(true);
    expect(reordered.activities.map((activity) => ({
      id: activity.id, status: activity.status, outcome: activity.outcome,
    }))).toEqual(explanation.activities.map((activity) => ({
      id: activity.id, status: activity.status, outcome: activity.outcome,
    })));
    expect(summary.activities).toHaveLength(6);
    expect(summary.story_activities).toHaveLength(5);
  });

  it('quarantines generated prose as an alternative semantic authority', async () => {
    const events = [event(0, 'tool.called', { 'gen_ai.tool.name': 'lookup' }, {
      span_id: 'tool-span', agent_id: 'agent-1', causal: { tool_call_id: 'lookup-1' },
    })];
    const summary = projectRuntimeSummary({
      mission_id: 'm1', branch_id: 'main', objective: 'test',
      status: 'active', phase: 'executing', events,
    });
    const node = buildNodeProjection({
      mission_id: 'm1', branch_id: 'main', agent_id: 'agent-1', events,
    });

    expect(await enhanceRuntimeSummaryWithLlm(summary)).toBe(summary);
    expect(node).not.toBeNull();
    expect(await enhanceNodeProjectionWithLlm(node!)).toBe(node);
  });

  it('keeps why-this-state on the exact historical explanation frame', async () => {
    const events = [
      event(0, 'task.started', { task: 'root' }, { id: 'root', span_id: 'root-span' }),
      event(1, 'tool.called', { 'gen_ai.tool.name': 'late' }, {
        id: 'late-trigger', span_id: 'late-span',
        causal: { triggered_by_event_id: 'root', tool_call_id: 'late' },
      }),
    ];
    const historical = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main', events, as_of_sequence_num: 0,
    });
    const current = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main', events, as_of_sequence_num: 1,
    });
    const historicalNarrative = await generateWhyThisState({ explanation: historical });
    const currentNarrative = await generateWhyThisState({ explanation: current });

    expect(historicalNarrative.frame?.sequence_num).toBe(0);
    expect(historicalNarrative.summary).not.toContain('trigger reference');
    expect(historicalNarrative.evidence_refs?.some((ref) => ref.event_id === 'late-trigger')).toBe(false);
    expect(currentNarrative.frame?.sequence_num).toBe(1);
    expect(currentNarrative.summary).toContain('explicit trigger reference');
    expect(currentNarrative.evidence_refs?.some((ref) => ref.event_id === 'late-trigger')).toBe(true);
  });

  it('describes unresolved relationship evidence without inventing a target', async () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [event(0, 'tool.called', { 'gen_ai.tool.name': 'lookup' }, {
        id: 'dangling', span_id: 'dangling-span',
        causal: { triggered_by_event_id: 'missing-event', tool_call_id: 'lookup' },
      })],
    });
    const narrative = await generateWhyThisState({ explanation });

    expect(narrative.summary).toContain('relationship reference is unresolved');
    expect(narrative.anomalies).toContainEqual(expect.objectContaining({
      code: 'dangling_trigger_reference',
    }));
  });

  it('does not choose an arbitrary parent activity when one span has multiple invocations', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [
        event(0, 'span.started', {
          operation_name: 'llm.call', 'gen_ai.request.id': 'request-a',
        }, { span_id: 'shared-parent' }),
        event(1, 'span.started', {
          operation_name: 'llm.call', 'gen_ai.request.id': 'request-b',
        }, { span_id: 'shared-parent' }),
        event(2, 'tool.called', { 'gen_ai.tool.name': 'lookup' }, {
          span_id: 'child', causal: { parent_span_id: 'shared-parent', tool_call_id: 'child-call' },
        }),
      ],
    });

    expect(explanation.relations.some((relation) => relation.basis === 'parent_span')).toBe(false);
    expect(explanation.consistency_flags).toContainEqual(expect.objectContaining({
      code: 'dangling_parent_span',
      message: expect.stringContaining('cannot be resolved unambiguously'),
    }));
  });
});
