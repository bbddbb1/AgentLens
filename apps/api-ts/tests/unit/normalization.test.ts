import { describe, expect, it } from 'vitest';
import {
  hasAmbiguousNativeIdentity,
  mergeNativeRuntimeIdentities,
  normalizeSpansToFacts,
} from '../../src/services/runtime/normalization/index.js';

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
  it('does not merge separate spans merely because a native run id is reused', () => {
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

    expect(facts.activities).toHaveLength(2);
    expect(facts.activities).toContainEqual(expect.objectContaining({
      id: 'tool:span:span-1', outcome: 'failure', lifecycle: 'failed',
    }));
    expect(facts.activities).toContainEqual(expect.objectContaining({
      id: 'tool:span:span-2', outcome: 'success', lifecycle: 'completed',
    }));
  });

  it('keeps repeated same-name tools distinct by safe span fallback while retaining native run provenance', () => {
    const facts = normalizeSpansToFacts([
      span({ attributes: { 'gen_ai.tool.name': 'search', 'agentlens.langgraph.run_id': 'run-1' } }),
      span({ span_id: 'span-2', attributes: { 'gen_ai.tool.name': 'search', 'agentlens.langgraph.run_id': 'run-2' } }),
    ]);

    expect(facts.activities.map((activity) => activity.id)).toEqual(['tool:span:span-1', 'tool:span:span-2']);
    expect(facts.activities.map((activity) => activity.native_runtime_identity?.run_id)).toEqual(['run-1', 'run-2']);
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
      id: 'tool:span:span-1',
      kind: 'tool',
      identity_basis: 'span_fallback',
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
      target_activity_id: 'agent:span:worker-span',
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
              'agentlens.langgraph.activity_correlation_id': 'tool-invocation-err',
            },
          },
          {
            name: 'agent.tool.call',
            attributes: {
              'gen_ai.tool.name': 'search',
              'gen_ai.tool.status': 'error',
              'agentlens.langgraph.run_id': 'tool-err',
              'agentlens.langgraph.activity_correlation_id': 'tool-invocation-err',
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

  it('retains earlier native identity fields when a later lifecycle event is partial', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: {
          'agentlens.langgraph.thread_id': 'thread-1',
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.langgraph.checkpoint_id': 'ckpt-1',
          'agentlens.langgraph.activity_correlation_id': 'corr-1',
          'agentlens.native_execution_key': 'obs-key-1',
        },
        events: [{
          name: 'agent.interrupt.requested',
          attributes: {
            'agentlens.langgraph.interrupt_request_id': 'interrupt-1',
            'agentlens.langgraph.run_id': 'run-1',
          },
        }],
      }),
    ]);

    const spanActivity = facts.activities.find((item) => item.invocation_id === 'corr-1');
    expect(spanActivity?.native_runtime_identity).toMatchObject({
      framework: 'langgraph',
      thread_id: 'thread-1',
      run_id: 'run-1',
      checkpoint_id: 'ckpt-1',
      activity_correlation_id: 'corr-1',
      native_execution_key: 'obs-key-1',
    });
    const interruptActivity = facts.activities.find((item) => item.kind === 'human');
    expect(interruptActivity).toMatchObject({
      id: 'human:interrupt-1',
      native_runtime_identity: expect.objectContaining({ interrupt_request_id: 'interrupt-1' }),
    });
    expect(facts.diagnostics.some((diagnostic) => diagnostic.code === 'conflicting_native_identity')).toBe(false);
  });

  it('coalesces equal repeated native identity values without conflict diagnostics', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.langgraph.thread_id': 'thread-1',
          'agentlens.native_execution_key': 'obs-key-1',
        },
        events: [{
          name: 'agent.tool.call',
          attributes: {
            'gen_ai.tool.name': 'search',
            'agentlens.langgraph.run_id': 'run-1',
            'agentlens.langgraph.thread_id': 'thread-1',
            'agentlens.native_execution_key': 'obs-key-1',
          },
        }],
      }),
    ]);

    expect(facts.activities[0]?.native_runtime_identity).toMatchObject({
      run_id: 'run-1',
      thread_id: 'thread-1',
      native_execution_key: 'obs-key-1',
    });
    expect(facts.diagnostics.filter((diagnostic) => diagnostic.code === 'conflicting_native_identity')).toHaveLength(0);
  });

  it('keeps the first recorded native identity value and diagnoses explicit conflicts', () => {
    const result = mergeNativeRuntimeIdentities([
      {
        identity: { run_id: 'run-a', thread_id: 'thread-1', native_execution_key: 'key-1' },
        source: { attribute_keys: ['a'], translator: 'langgraph', span_id: 'span-a' },
      },
      {
        identity: { run_id: 'run-b', thread_id: 'thread-1', native_execution_key: 'key-1' },
        source: { attribute_keys: ['b'], translator: 'langgraph', span_id: 'span-b' },
      },
    ]);

    expect(result.identity).toMatchObject({
      run_id: 'run-a',
      thread_id: 'thread-1',
      native_execution_key: 'key-1',
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'conflicting_native_identity',
      field: 'run_id',
      ambiguous_native_identity: true,
      source: expect.objectContaining({ span_id: 'span-a' }),
      conflicting_source: expect.objectContaining({ span_id: 'span-b' }),
    }));
    expect(hasAmbiguousNativeIdentity(result.diagnostics)).toBe(true);
  });

  it('treats native_execution_key as observational and never uses it to invent conflicts alone', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.native_execution_key': 'obs-key-1',
        },
        events: [{
          name: 'agent.interrupt.requested',
          attributes: {
            'agentlens.langgraph.run_id': 'run-1',
            'agentlens.langgraph.interrupt_request_id': 'interrupt-1',
            // Same observational key retained; still not a control credential.
            'agentlens.native_execution_key': 'obs-key-1',
          },
        }],
      }),
    ]);

    expect(facts.activities[0]?.native_runtime_identity?.native_execution_key).toBe('obs-key-1');
    expect(facts.activities[0]?.native_runtime_identity?.interrupt_request_id).toBe('interrupt-1');
  });

  it('preserves MAF workflow, executor, and request identity in MAF terminology', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: {
          'workflow.id': 'workflow-1',
          'executor.id': 'executor-1',
          'agentlens.maf.request_id': 'request-1',
          'agentlens.maf.request_type': 'ReferenceReviewRequest',
          'agentlens.maf.response_type': 'ReferenceReviewResponse',
        },
      }),
    ]);

    expect(facts.activities[0]?.native_runtime_identity).toMatchObject({
      framework: 'ms_agent_framework',
      workflow_id: 'workflow-1',
      executor_id: 'executor-1',
      request_id: 'request-1',
      request_type: 'ReferenceReviewRequest',
      response_type: 'ReferenceReviewResponse',
    });
    expect(facts.activities[0]?.native_runtime_identity?.thread_id).toBeUndefined();
  });

  it('normalizes bounded MAF request enrichment without LangGraph semantics', () => {
    const facts = normalizeSpansToFacts([span({ events: [{
      name: 'agentlens.maf.request_info',
      attributes: {
        'agentlens.maf.request_id': 'request-1',
        'agentlens.maf.request_type': 'ReferenceReviewRequest',
        'agentlens.maf.response_type': 'ReferenceReviewResponse',
        'agentlens.maf.safe_data_state': 'bounded',
      },
    }] })]);

    expect(facts.activities.some((activity) => activity.kind === 'human')).toBe(false);
    expect(facts.activities).toContainEqual(expect.objectContaining({
      kind: 'unknown',
      native_runtime_identity: expect.objectContaining({ framework: 'ms_agent_framework', request_id: 'request-1' }),
      source_references: expect.arrayContaining([
        expect.objectContaining({ translator: 'maf', event_name: 'agentlens.maf.request_info' }),
      ]),
    }));
  });

  it('preserves explicit MAF failure and safely diagnoses unknown MAF telemetry', () => {
    const facts = normalizeSpansToFacts([
      span({
        attributes: { 'workflow.id': 'workflow-failed', 'executor.id': 'executor-failed' },
        status_code: 'ERROR',
        events: [{ name: 'agentlens.maf.unrecognized', attributes: { 'agentlens.maf.workflow_id': 'workflow-failed' } }],
      }),
    ]);

    expect(facts.activities[0]).toMatchObject({ outcome: 'failure', lifecycle: 'failed' });
    expect(facts.diagnostics).toContainEqual(expect.objectContaining({
      code: 'unknown_telemetry',
      source: expect.objectContaining({ translator: 'maf' }),
    }));
  });

  it('does not infer MAF relationships from timestamp overlap or names', () => {
    const facts = normalizeSpansToFacts([
      span({ attributes: { 'workflow.id': 'workflow-1', 'executor.id': 'same-name' } }),
      span({ span_id: 'span-2', attributes: { 'workflow.id': 'workflow-2', 'executor.id': 'same-name' } }),
    ]);

    expect(facts.relationships).toEqual([]);
  });
});
