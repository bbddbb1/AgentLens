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
      event(0, 'framework.activity', {}, { metadata: {
        runtime_lifecycle: 'started', runtime_lifecycle_basis: 'explicit_event',
      } }),
      event(1, 'interrupt.requested', { interrupt_id: 'int-1', reason: 'Approval needed' }),
      event(2, 'interrupt.decision', { interrupt_id: 'int-1', decision: 'approve' }),
      event(3, 'framework.interaction', {}, { metadata: {
        runtime_lifecycle: 'completed', runtime_lifecycle_basis: 'explicit_event',
      } }),
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
    expect(explanation.consistency_flags.some((flag) => flag.code === 'missing_start')).toBe(true);
    expect(explanation.consistency_flags.some((flag) => flag.code === 'orphan_terminal')).toBe(false);
  });

  it.each([
    ['active', [event(0, 'framework.activity', {}, { metadata: { runtime_lifecycle: 'started', runtime_lifecycle_basis: 'explicit_event' } })]],
    ['waiting', [event(0, 'interrupt.requested', { interrupt_id: 'int-1' })]],
    ['completed', [event(0, 'framework.interaction', {}, { metadata: { runtime_lifecycle: 'completed', runtime_lifecycle_basis: 'explicit_event' } })]],
    ['failed', [event(0, 'framework.interaction', {}, { metadata: { runtime_lifecycle: 'failed', runtime_lifecycle_basis: 'explicit_event' } })]],
  ] as const)('derives %s from explicit runtime lifecycle evidence', (expected, events) => {
    expect(projectRuntimeExplanation({ mission_id: 'm1', branch_id: 'main', events }).run_outcome).toBe(expected);
  });

  it('returns unknown when run evidence is missing and ignores mission-container status', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [event(0, 'mission.status_changed', { status: 'completed' })],
    });
    expect(explanation.run_outcome).toBe('unknown');
    expect(explanation.consistency_flags.some((flag) => flag.code === 'run_evidence_insufficient')).toBe(true);
  });

  it('returns unknown when terminal run evidence conflicts', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'framework.interaction', {}, { metadata: { runtime_lifecycle: 'completed', runtime_lifecycle_basis: 'explicit_event' } }),
        event(1, 'framework.interaction', {}, { metadata: { runtime_lifecycle: 'failed', runtime_lifecycle_basis: 'explicit_event' } }),
      ],
    });
    expect(explanation.run_outcome).toBe('unknown');
    expect(explanation.consistency_flags.some((flag) => flag.code === 'run_evidence_conflict')).toBe(true);
  });

  it('returns unknown when multiple execution-root candidates provide no terminal evidence', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.started', {}, { span_id: 'root-1', metadata: {
          runtime_lifecycle: 'started', runtime_lifecycle_basis: 'execution_root_span', runtime_root_candidate: true,
        } }),
        event(1, 'span.started', {}, { span_id: 'root-2', metadata: {
          runtime_lifecycle: 'started', runtime_lifecycle_basis: 'execution_root_span', runtime_root_candidate: true,
        } }),
      ],
    });
    expect(explanation.run_outcome).toBe('unknown');
    expect(explanation.consistency_flags[0]?.message).toContain('2 execution-root candidates');
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

  it('deduplicates repeated relationship and shared-span conditions by stable identity', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'a' }, { span_id: 'shared', parent_span_id: 'missing', causal: { tool_call_id: 'a', parent_span_id: 'missing' } }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'a' }, { span_id: 'shared', parent_span_id: 'missing', causal: { tool_call_id: 'a', parent_span_id: 'missing' } }),
        event(2, 'tool.called', { 'gen_ai.tool.name': 'b' }, { span_id: 'shared', parent_span_id: 'missing', causal: { tool_call_id: 'b', parent_span_id: 'missing' } }),
      ],
    });
    expect(explanation.consistency_flags.filter((flag) => flag.code === 'dangling_parent_span')).toHaveLength(1);
    expect(explanation.consistency_flags.filter((flag) => flag.code === 'shared_span_multiple_invocations')).toHaveLength(1);
  });

  it('coalesces equivalent terminal evidence and flags only conflicting terminal outcomes', () => {
    const equivalent = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch' }, { span_id: 'tool', causal: { tool_call_id: 'call' } }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'fetch' }, { span_id: 'tool', causal: { tool_call_id: 'call' } }),
        event(2, 'span.completed', { operation_name: 'execute_tool', 'gen_ai.tool.name': 'fetch' }, { span_id: 'tool', causal: { tool_call_id: 'call' } }),
      ],
    });
    expect(equivalent.consistency_flags.some((flag) => flag.code === 'duplicate_terminal')).toBe(false);

    const conflicting = projectRuntimeExplanation({
      mission_id: 'm1', branch_id: 'main',
      events: [
        event(0, 'tool.called', { 'gen_ai.tool.name': 'fetch' }, { span_id: 'tool', causal: { tool_call_id: 'call' } }),
        event(1, 'tool.completed', { 'gen_ai.tool.name': 'fetch' }, { span_id: 'tool', causal: { tool_call_id: 'call' } }),
        event(2, 'tool.failed', { 'gen_ai.tool.name': 'fetch' }, { span_id: 'tool', causal: { tool_call_id: 'call' } }),
      ],
    });
    expect(conflicting.consistency_flags.filter((flag) => flag.code === 'duplicate_terminal')).toHaveLength(1);
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

  it('promotes gen_ai.completion into operator-facing output', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.started', { operation_name: 'llm.call', 'gen_ai.request.id': 'req-llm-1' }, {
          span_id: 'llm-span',
        }),
        event(1, 'span.completed', {
          operation_name: 'llm.call',
          'gen_ai.request.id': 'req-llm-1',
          'gen_ai.completion': 'diagnosis result text',
        }, { span_id: 'llm-span' }),
      ],
    });

    const activity = explanation.activities[0];
    expect(activity?.operator_facing_record?.output.condition).toBe('recorded');
    expect(activity?.operator_facing_record?.output.value).toBe('diagnosis result text');
  });

  it('promotes gen_ai.prompt into operator-facing input', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.started', {
          operation_name: 'llm.call',
          'gen_ai.request.id': 'req-llm-2',
          'gen_ai.prompt': 'system prompt text',
        }, { span_id: 'llm-span-2' }),
      ],
    });

    expect(explanation.activities[0]?.operator_facing_record?.input.condition).toBe('recorded');
    expect(explanation.activities[0]?.operator_facing_record?.input.value).toBe('system prompt text');
  });

  it('records structured gen_ai.response without leaking through projection', () => {
    const structured = { hypothesis: { description: 'cell fault', confidence: 0.9 } };
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.completed', {
          operation_name: 'llm.call',
          'gen_ai.request.id': 'req-llm-3',
          'gen_ai.response': structured,
        }, { span_id: 'llm-span-3' }),
      ],
    });

    expect(explanation.activities[0]?.operator_facing_record?.output.condition).toBe('recorded');
    expect(explanation.activities[0]?.operator_facing_record?.output.value).toEqual(structured);
  });

  it('does not promote workload-private output keys into L1 output', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.completed', {
          operation_name: 'llm.call',
          'gen_ai.request.id': 'req-private',
          'basestation.aiops.llm.output.summary': '{"hypothesis":"private"}',
        }, { span_id: 'llm-private' }),
      ],
    });

    expect(explanation.activities[0]?.outputs?.output).toBeUndefined();
    expect(explanation.activities[0]?.operator_facing_record?.output.condition).toBe('not_recorded');
  });

  it('normalizes tool.called output from gen_ai.tool.output', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          'gen_ai.tool.name': 'fetch',
          'gen_ai.tool.output': '{"ok":true}',
        }, {
          span_id: 'tool-span',
          causal: { tool_call_id: 'call-out-1' },
        }),
      ],
    });

    expect(explanation.activities[0]?.operator_facing_record?.output.condition).toBe('recorded');
    expect(explanation.activities[0]?.operator_facing_record?.output.value).toBe('{"ok":true}');
  });

  it('normalizes tool.called output from tool_output alias', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          'gen_ai.tool.name': 'fetch',
          tool_output: 'alias-output',
        }, {
          span_id: 'tool-span-2',
          causal: { tool_call_id: 'call-out-2' },
        }),
      ],
    });

    expect(explanation.activities[0]?.operator_facing_record?.output.condition).toBe('recorded');
    expect(explanation.activities[0]?.operator_facing_record?.output.value).toBe('alias-output');
  });

  it('normalizes retrieval/tool activity output from generic output key', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.completed', {
          operation_name: 'retrieval.search',
          'retrieval.request_id': 'ret-1',
          output: 'retrieval hits',
        }, { span_id: 'ret-span' }),
      ],
    });

    expect(explanation.activities[0]?.operator_facing_record?.output.condition).toBe('recorded');
    expect(explanation.activities[0]?.operator_facing_record?.output.value).toBe('retrieval hits');
  });

  it('normalizes tool input from gen_ai.tool.input', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'tool.called', {
          'gen_ai.tool.name': 'fetch',
          'gen_ai.tool.input': '{"query":"logs"}',
        }, {
          span_id: 'tool-in-span',
          causal: { tool_call_id: 'call-in-1' },
        }),
      ],
    });

    expect(explanation.activities[0]?.operator_facing_record?.input.condition).toBe('recorded');
    expect(explanation.activities[0]?.operator_facing_record?.input.value).toBe('{"query":"logs"}');
  });

  it('keeps story sufficiency independent from missing normalized output', () => {
    const explanation = projectRuntimeExplanation({
      mission_id: 'm1',
      branch_id: 'main',
      events: [
        event(0, 'span.completed', {
          operation_name: 'llm.call',
          'gen_ai.request.id': 'req-story',
          'gen_ai.agent.id': 'diagnosis',
        }, { span_id: 'llm-story', agent_id: 'diagnosis' }),
      ],
    });

    const record = explanation.activities[0]?.operator_facing_record;
    expect(record?.output.condition).toBe('not_recorded');
    expect(record?.evidence_condition.condition).toBe('recorded');
  });
});
