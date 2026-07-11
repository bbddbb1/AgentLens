import { describe, expect, it } from 'vitest';
import { normalizeSpansToFacts } from '../../src/services/runtime/normalization/index.js';

function span(overrides: Record<string, any> = {}) {
  return {
    span_id: 'span-1',
    trace_id: 'trace-1',
    name: 'tool',
    start_time_unix_nano: '100',
    end_time_unix_nano: '200',
    status_code: 'OK',
    attributes: {},
    ...overrides,
  };
}

describe('normalizeSpansToFacts', () => {
  it('lets explicit failure dominate success-like telemetry', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'gen_ai.tool.name': 'search',
        },
        status_code: 'ERROR',
      }),
      span({
        span_id: 'span-2',
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'gen_ai.tool.name': 'search',
        },
      }),
    ]);

    expect(facts.activities).toHaveLength(1);
    expect(facts.activities[0]).toMatchObject({ outcome: 'failure', lifecycle: 'failed' });
  });

  it('keeps repeated same-name tools distinct by run id', () => {
    const facts = normalizeSpansToFacts([
      span({ attributes: { 'gen_ai.tool.name': 'search', 'agentlens.langgraph.run_id': 'run-1' } }),
      span({ span_id: 'span-2', attributes: { 'gen_ai.tool.name': 'search', 'agentlens.langgraph.run_id': 'run-2' } }),
    ]);

    expect(facts.activities.map((activity) => activity.id)).toEqual(['run:run-1', 'run:run-2']);
  });

  it('normalizes tool events with their recorded run identity', () => {
    const facts = normalizeSpansToFacts([
      span({
        events: [{
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'search',
            'agentlens.langgraph.run_id': 'tool-run',
          },
        }],
      }),
    ]);

    expect(facts.activities).toContainEqual(expect.objectContaining({
      id: 'run:tool-run',
      kind: 'tool',
      native_runtime_identity: expect.objectContaining({ run_id: 'tool-run' }),
    }));
  });

  it('treats parent-child nesting as correlation, not handoff', () => {
    const facts = normalizeSpansToFacts([
      span({ attributes: { 'agentlens.langgraph.run_id': 'parent' } }),
      span({
        span_id: 'child',
        parent_span_id: 'span-1',
        attributes: { 'agentlens.langgraph.run_id': 'child', 'agentlens.langgraph.parent_run_id': 'parent' },
      }),
    ]);

    expect(facts.relationships.some((relationship) => relationship.kind === 'parent_child')).toBe(true);
    expect(facts.relationships.some((relationship) => relationship.kind === 'handoff')).toBe(false);
  });

  it('requires explicit LangGraph handoff evidence and resolves its target', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: { 'agentlens.langgraph.run_id': 'planner', 'gen_ai.agent.id': 'planner' },
        events: [{
          name: 'agent.handoff.requested',
          attributes: {
            'agentlens.langgraph.explicit_handoff': 'true',
            'gen_ai.agent.handoff.target': 'worker',
          },
        }],
      }),
      span({
        span_id: 'worker-span',
        attributes: { 'agentlens.langgraph.run_id': 'worker', 'gen_ai.agent.id': 'worker' },
      }),
    ]);

    expect(facts.relationships).toContainEqual(expect.objectContaining({
      kind: 'handoff',
      resolution: 'resolved',
      target_activity_id: 'run:worker',
    }));
  });

  it('keeps an unresolved explicit handoff diagnostic without a target activity', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: { 'agentlens.langgraph.run_id': 'planner' },
        events: [{
          name: 'agent.handoff.requested',
          attributes: {
            'agentlens.langgraph.explicit_handoff': 'true',
            'gen_ai.agent.handoff.target': 'missing',
          },
        }],
      }),
    ]);

    expect(facts.relationships).toContainEqual(expect.objectContaining({
      kind: 'handoff',
      resolution: 'unresolved',
      target_reference: 'missing',
    }));
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({ code: 'unresolved_relationship' }));
  });

  it('is deterministic for span permutations', () => {
    const spans = [
      span({ attributes: { 'agentlens.langgraph.run_id': 'one', 'gen_ai.tool.name': 'search' } }),
      span({ span_id: 'span-2', attributes: { 'agentlens.langgraph.run_id': 'two', 'gen_ai.tool.name': 'search' } }),
    ];
    expect(normalizeSpansToFacts(spans)).toEqual(normalizeSpansToFacts([...spans].reverse()));
  });

  it('preserves explicit retrieval and native identity references', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: {
          'agentlens.langgraph.retrieval': 'true',
          'agentlens.langgraph.thread_id': 'thread-1',
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.langgraph.parent_run_id': 'parent-1',
          'agentlens.langgraph.interrupt_request_id': 'interrupt-1',
          'agentlens.langgraph.checkpoint_id': 'checkpoint-1',
          'agentlens.langgraph.activity_correlation_id': 'activity-1',
          'agentlens.native_execution_key': 'native-key',
        },
      }),
    ]);

    expect(facts.activities[0]).toMatchObject({
      kind: 'retrieval',
      native_runtime_identity: {
        framework: 'langgraph',
        thread_id: 'thread-1',
        run_id: 'run-1',
        parent_run_id: 'parent-1',
        interrupt_request_id: 'interrupt-1',
        checkpoint_id: 'checkpoint-1',
        activity_correlation_id: 'activity-1',
        native_execution_key: 'native-key',
      },
    });
  });

  it('does not inherit parent-span OK for incomplete tool start events', () => {
    const facts = normalizeSpansToFacts([
      span({
        status_code: 'OK',
        events: [{
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'search',
            'gen_ai.tool.status': 'active',
            'agentlens.langgraph.run_id': 'tool-open',
          },
        }],
      }),
    ]);

    const tool = facts.activities.find((activity) => activity.kind === 'tool');
    expect(tool).toMatchObject({ outcome: 'unknown', lifecycle: 'started' });
  });

  it('lets explicit tool error dominate an earlier active status for the same run', () => {
    const facts = normalizeSpansToFacts([
      span({
        status_code: 'OK',
        events: [
          {
            name: 'agent.tool.call',
            attributes: {
              'gen_ai.tool.name': 'search',
              'gen_ai.tool.status': 'active',
              'agentlens.langgraph.run_id': 'tool-err',
            },
          },
          {
            name: 'agent.tool.call',
            attributes: {
              'gen_ai.tool.name': 'search',
              'gen_ai.tool.status': 'error',
              'agentlens.langgraph.run_id': 'tool-err',
            },
          },
        ],
      }),
    ]);

    expect(facts.activities.filter((activity) => activity.kind === 'tool')).toHaveLength(1);
    expect(facts.activities.find((activity) => activity.kind === 'tool')).toMatchObject({
      outcome: 'failure',
      lifecycle: 'failed',
    });
  });
});
