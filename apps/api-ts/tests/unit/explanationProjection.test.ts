import { describe, expect, it } from 'vitest';
import { projectRuntimeExplanation, type EventEnvelope } from '@agentlens/protocol';

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
    timestamp: overrides.timestamp ?? `2026-06-28T00:00:${String(sequence_num).padStart(2, '0')}.000Z`,
    payload,
    metadata: {},
    ...overrides,
  };
}

describe('projectRuntimeExplanation', () => {
  it('prefers invocation identifiers over span identifiers for tools', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'search_logs' }, {
          span_id: 'shared-span',
          causal: { tool_call_id: 'call-123' },
        }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'search_logs' }, {
          span_id: 'shared-span',
          causal: { tool_call_id: 'call-123' },
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('tool:call-123');
    expect(explanation.activities[0]?.source_span_id).toBe('shared-span');
  });

  it('prefers LLM request identifiers over span identifiers for llm activity identity', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.started', { operation_name: 'llm.call', 'gen_ai.request.model': 'gpt-4.1', 'gen_ai.request.id': 'req-llm-1' }, {
          span_id: 'shared-llm-span',
        }),
        event(1, 'span.completed', { operation_name: 'llm.call', 'gen_ai.request.model': 'gpt-4.1', 'gen_ai.request.id': 'req-llm-1' }, {
          span_id: 'shared-llm-span',
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('llm:req-llm-1');
  });

  it('prefers retrieval request identifiers over span identifiers for retrieval activity identity', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.started', { operation_name: 'retrieval.search', 'retrieval.backend': 'cmdb', 'retrieval.request_id': 'req-ret-1' }, {
          span_id: 'shared-retrieval-span',
        }),
        event(1, 'span.completed', { operation_name: 'retrieval.search', 'retrieval.backend': 'cmdb', 'retrieval.request_id': 'req-ret-1' }, {
          span_id: 'shared-retrieval-span',
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('retrieval:req-ret-1');
  });

  it('prefers workflow step, interrupt, and artifact identifiers over span identifiers', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'task.started', { task: 'Draft plan', 'gen_ai.workflow.step_id': 'step-plan' }, { span_id: 'workflow-span' }),
        event(1, 'interrupt.requested', { interrupt_id: 'int-7', reason: 'Need approval' }, { span_id: 'interrupt-span' }),
        event(2, 'artifact.created', { artifact_id: 'artifact-42', artifact_name: 'diagnostic.md' }, { span_id: 'artifact-span' }),
      ],
    });

    expect(explanation.activities.map((activity) => activity.id)).toEqual([
      'workflow:step-plan',
      'human:int-7',
      'artifact:artifact-42',
    ]);
  });

  it('keeps historical frames from inheriting final mission state', () => {
    const events = [
      event(0, 'mission.created'),
      event(1, 'interrupt.requested', { interrupt_id: 'int-1', reason: 'Approval needed' }),
      event(2, 'interrupt.decision', { interrupt_id: 'int-1', decision: 'approve' }),
      event(3, 'mission.status_changed', { status: 'completed' }),
    ];

    const historical = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events,
      as_of_sequence_num: 1,
    });
    const finalFrame = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events,
      as_of_sequence_num: 3,
    });

    expect(historical.run_outcome).toBe('waiting');
    expect(finalFrame.run_outcome).toBe('completed');
  });

  it('flags orphan terminal evidence without inventing a start', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.failed', { 'gen_ai.tool.name': 'fetch' }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-x' },
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.started_at).toBeUndefined();
    expect(explanation.consistency_flags.some((flag) => flag.code === 'orphan_terminal')).toBe(true);
    expect(explanation.consistency_flags.some((flag) => flag.code === 'missing_start')).toBe(true);
  });

  it('keeps frame overview as the authority state when selectable activities exist', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch' }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-overview' },
        }),
      ],
    });

    expect(explanation.selected_activity_state).toEqual({
      kind: 'overview',
      reason: 'frame_overview',
    });
  });

  it('uses a no-activity authority state when the frame has no selectable activities', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [],
    });

    expect(explanation.selected_activity_state).toEqual({
      kind: 'no_activity',
      reason: 'no_selectable_activity',
    });
  });

  it('falls back to span identity when invocation-level identity is absent', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch' }, { span_id: 'fallback-span' }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('tool:span:fallback-span');
  });

  it('falls back to event identity when neither invocation-level nor span identity is available', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch' }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('tool:event:e-0');
  });

  it('flags shared spans when multiple invocation identities reuse one span', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch-a' }, {
          span_id: 'shared-span',
          causal: { tool_call_id: 'call-a' },
        }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'fetch-a' }, {
          span_id: 'shared-span',
          causal: { tool_call_id: 'call-a' },
        }),
        event(2, 'tool.called', { 'gen_ai.tool.name': 'fetch-b' }, {
          span_id: 'shared-span',
          causal: { tool_call_id: 'call-b' },
        }),
        event(3, 'tool.completed', { 'gen_ai.tool.name': 'fetch-b' }, {
          span_id: 'shared-span',
          causal: { tool_call_id: 'call-b' },
        }),
      ],
    });

    expect(explanation.activities.map((activity) => activity.id)).toEqual(['tool:call-a', 'tool:call-b']);
    expect(explanation.consistency_flags.some((flag) => flag.code === 'shared_span_multiple_invocations')).toBe(true);
  });

  it('supports multiple activities recorded within one span when invocation identifiers differ by kind', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.started', { operation_name: 'llm.call', 'gen_ai.request.model': 'gpt-4.1', 'gen_ai.request.id': 'req-1' }, {
          span_id: 'mixed-span',
        }),
        event(1, 'span.started', { operation_name: 'retrieval.search', 'retrieval.backend': 'logs', 'retrieval.request_id': 'ret-1' }, {
          span_id: 'mixed-span',
        }),
      ],
    });

    expect(explanation.activities.map((activity) => activity.id)).toEqual(['llm:req-1', 'retrieval:ret-1']);
    expect(explanation.consistency_flags.some((flag) => flag.code === 'shared_span_multiple_invocations')).toBe(true);
  });

  it('never leaks redacted values through explanation inputs or outputs', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch', 'gen_ai.tool.input': 'secret-input' }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-redacted' },
          policy: { decision: 'redact', reason: 'sensitive' },
        }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'fetch', 'gen_ai.tool.output': 'secret-output' }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-redacted' },
          policy: { decision: 'redact', reason: 'sensitive' },
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.inputs?.input).toMatchObject({ kind: 'redaction', policy_decision: 'redact' });
    expect(explanation.activities[0]?.outputs?.output).toMatchObject({ kind: 'redaction', policy_decision: 'redact' });
    expect(JSON.stringify(explanation)).not.toContain('secret-input');
    expect(JSON.stringify(explanation)).not.toContain('secret-output');
  });

  it('treats tool.called with gen_ai.tool.status=completed as terminal lifecycle evidence without tool.completed', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          'gen_ai.tool.name': 'fetch',
          'gen_ai.tool.status': 'completed',
        }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-completed' },
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('tool:call-completed');
    expect(explanation.activities[0]?.status).toBe('completed');
    expect(explanation.activities[0]?.ended_at).toBeDefined();
  });

  it('treats tool.called with gen_ai.tool.status=failed as terminal lifecycle evidence without tool.completed', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          'gen_ai.tool.name': 'fetch',
          'gen_ai.tool.status': 'failed',
          reason: 'timeout',
        }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-failed' },
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('tool:call-failed');
    expect(explanation.activities[0]?.status).toBe('failed');
    expect(explanation.activities[0]?.error?.error).toBe('timeout');
  });

  it('preserves explicit terminal status on tool.called when displayable I/O is redacted', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          'gen_ai.tool.name': 'fetch',
          'gen_ai.tool.status': 'completed',
          'gen_ai.tool.input': 'secret-input',
          'gen_ai.tool.output': 'secret-output',
        }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-redacted-terminal' },
          policy: { decision: 'redact', reason: 'sensitive' },
        }),
      ],
    });

    expect(explanation.activities[0]?.status).toBe('completed');
    expect(explanation.activities[0]?.inputs?.input).toMatchObject({ kind: 'redaction' });
    expect(explanation.activities[0]?.outputs?.output).toMatchObject({ kind: 'redaction' });
  });

  it('treats terminal status on retrieval tool.called as closing the retrieval invocation', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          operation_name: 'retrieval.search',
          'retrieval.backend': 'logs',
          'retrieval.request_id': 'ret-1',
          'gen_ai.tool.status': 'completed',
        }, {
          span_id: 'retrieval-span',
        }),
      ],
    });

    expect(explanation.activities).toHaveLength(1);
    expect(explanation.activities[0]?.id).toBe('retrieval:ret-1');
    expect(explanation.activities[0]?.status).toBe('completed');
  });

  it('emits proven parallel and merge groups only from shared-parent overlap evidence', () => {
    const events = [
      event(0, 'task.started', { task: 'root' }, { span_id: 'root-span' }),
      event(1, 'tool.called', { 'gen_ai.tool.name': 'a' }, {
        id: 'child-a-start',
        span_id: 'child-a',
        timestamp: '2026-06-28T00:00:01.000Z',
        causal: { parent_span_id: 'root-span', tool_call_id: 'a-1' },
      }),
      event(2, 'tool.called', { 'gen_ai.tool.name': 'b' }, {
        id: 'child-b-start',
        span_id: 'child-b',
        timestamp: '2026-06-28T00:00:02.000Z',
        causal: { parent_span_id: 'root-span', tool_call_id: 'b-1' },
      }),
      event(3, 'tool.completed', { 'gen_ai.tool.name': 'a' }, {
        span_id: 'child-a',
        timestamp: '2026-06-28T00:00:05.000Z',
        causal: { parent_span_id: 'root-span', tool_call_id: 'a-1' },
      }),
      event(4, 'tool.completed', { 'gen_ai.tool.name': 'b' }, {
        span_id: 'child-b',
        timestamp: '2026-06-28T00:00:06.000Z',
        causal: { parent_span_id: 'root-span', tool_call_id: 'b-1' },
      }),
      event(5, 'task.started', { task: 'merge' }, {
        span_id: 'merge-span',
        causal: { triggered_by_event_id: 'child-a-start' },
      }),
      event(6, 'task.started', { task: 'merge' }, {
        id: 'merge-basis',
        span_id: 'merge-span',
        causal: { triggered_by_event_id: 'child-b-start' },
      }),
    ];

    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events,
    });

    expect(explanation.parallel_groups).toHaveLength(1);
    expect(explanation.parallel_groups[0]?.activity_ids).toEqual(['tool:a-1', 'tool:b-1']);
    expect(explanation.merge_groups).toHaveLength(1);
    expect(explanation.merge_groups[0]?.predecessor_activity_ids).toEqual(['tool:a-1', 'tool:b-1']);
  });
});
