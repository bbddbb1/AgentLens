import { describe, expect, it } from 'vitest';
import { normalizeSpansToMissionEvents } from '../../src/services/runtime/SpanNormalizer.js';
import type { OtlpSpan } from '@agentlens/protocol';

describe('SpanNormalizer - Telemetry Ingestion Contract Tests', () => {
  it('correctly extracts origin framework and agent registration events', () => {
    const spans: OtlpSpan[] = [
      {
        trace_id: 't1',
        span_id: 's1',
        operation_name: 'run_agent',
        start_time_unix_nano: 1000000,
        end_time_unix_nano: 2000000,
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'agent-researcher',
          'gen_ai.agent.name': 'Researcher Agent',
          'gen_ai.agent.role': 'researcher',
          'gen_ai.agent.team': 'search-team',
          'gen_ai.agent.goal': 'Find AI papers',
          'gen_ai.agent.framework': 'langgraph',
          'agent.span.kind': 'invoke_agent',
          'gen_ai.agent.task': 'Retrieve recent LLM advancements',
        },
        events: [],
      },
    ];

    const events = normalizeSpansToMissionEvents('m1', spans);

    // Should create agent.registered and span.started and task.started and span.completed / task.completed / etc.
    const registered = events.find((e) => e.event_type === 'agent.registered');
    expect(registered).toBeDefined();
    expect(registered!.agent_id).toBe('agent-researcher');
    expect(registered!.origin_framework).toBe('langgraph');
    expect(registered!.payload).toEqual(
      expect.objectContaining({
        agent_id: 'agent-researcher',
        name: 'Researcher Agent',
        role: 'researcher',
        team: 'search-team',
        summary: 'Find AI papers',
        framework: 'langgraph',
      })
    );

    const taskStarted = events.find((e) => e.event_type === 'task.started');
    expect(taskStarted).toBeDefined();
    expect(taskStarted!.payload.task).toBe('Retrieve recent LLM advancements');
  });

  it('extracts model provenance and LLM usage metadata', () => {
    const spans: OtlpSpan[] = [
      {
        trace_id: 't1',
        span_id: 's1',
        operation_name: 'llm_call',
        start_time_unix_nano: 1000000,
        end_time_unix_nano: 2000000,
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'agent1',
          'gen_ai.system': 'openai',
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.model.version': '2024-05-13',
          'gen_ai.usage.input_tokens': 150,
          'gen_ai.usage.output_tokens': 200,
          'gen_ai.request.temperature': 0.7,
          'gen_ai.response.finish_reason': 'stop',
        },
      },
    ];

    const events = normalizeSpansToMissionEvents('m1', spans);
    const spanStarted = events.find((e) => e.event_type === 'span.started');

    expect(spanStarted).toBeDefined();
    expect(spanStarted!.model).toEqual({
      provider: 'openai',
      model_name: 'gpt-4o',
      model_version: '2024-05-13',
      tokens_input: 150,
      tokens_output: 200,
      temperature: 0.7,
      stop_reason: 'stop',
    });
  });

  it('correctly maps error source and cause attributions', () => {
    const spans: OtlpSpan[] = [
      {
        trace_id: 't1',
        span_id: 's1',
        operation_name: 'tool_exec',
        start_time_unix_nano: 1000000,
        end_time_unix_nano: 2000000,
        status_code: 'ERROR',
        attributes: {
          'gen_ai.agent.id': 'agent1',
          'error.source': 'tool',
          'error.cause': 'timeout',
          'error.severity': 'critical',
          'error.recovery.action': 'retry_with_backoff',
          'error.original': 'Connection refused from server',
        },
      },
    ];

    const events = normalizeSpansToMissionEvents('m1', spans);
    const failed = events.find((e) => e.event_type === 'span.failed');

    expect(failed).toBeDefined();
    expect(failed!.error).toEqual({
      source: 'tool',
      cause: 'timeout',
      severity: 'critical',
      recovery_action: 'retry_with_backoff',
      original_error: 'Connection refused from server',
    });
  });

  it('sets correct causal contexts for parent execution spans', () => {
    const spans: OtlpSpan[] = [
      {
        trace_id: 't1',
        span_id: 'child1',
        parent_span_id: 'parent1',
        operation_name: 'subtask',
        start_time_unix_nano: 1000000,
        end_time_unix_nano: 2000000,
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'agent1',
          'gen_ai.tool.id': 'tool-db-write',
        },
      },
    ];

    const events = normalizeSpansToMissionEvents('m1', spans);
    const spanStarted = events.find((e) => e.event_type === 'span.started');

    expect(spanStarted).toBeDefined();
    expect(spanStarted!.causal).toEqual({
      parent_span_id: 'parent1',
      tool_call_id: 'tool-db-write',
    });
  });

  it('identifies correct actors for tool and human events', () => {
    const spans: OtlpSpan[] = [
      {
        trace_id: 't1',
        span_id: 's1',
        operation_name: 'call_tool',
        start_time_unix_nano: 1000000,
        end_time_unix_nano: 2000000,
        status_code: 'OK',
        attributes: {
          'gen_ai.agent.id': 'agent1',
          'agent.span.kind': 'execute_tool',
          'gen_ai.tool.name': 'calculator',
          'gen_ai.tool.input': '2 + 2',
        },
      },
    ];

    const events = normalizeSpansToMissionEvents('m1', spans);
    const toolCalled = events.find((e) => e.event_type === 'tool.called');

    expect(toolCalled).toBeDefined();
    expect(toolCalled!.actor_type).toBe('tool');
    expect(toolCalled!.actor_id).toBe('calculator');
  });
});
