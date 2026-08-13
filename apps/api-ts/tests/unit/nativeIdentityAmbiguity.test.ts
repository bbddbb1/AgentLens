import { describe, expect, it } from 'vitest';
import { evaluateActionability } from '../../src/services/interrupts/reconcileActionability.js';
import {
  interruptIdsWithAmbiguousNativeIdentity,
  nextIdentityAmbiguousFlag,
  resolveInterruptIdentityAmbiguity,
} from '../../src/services/interrupts/nativeIdentityAmbiguity.js';
import { hasAmbiguousNativeIdentity, normalizeSpansToFacts } from '../../src/services/runtime/normalization/index.js';

const baseInterrupt = {
  interrupt_id: 'irq-1',
  mission_id: 'm1',
  branch_id: 'main',
  framework: 'langgraph',
  control_mode: 'framework_binding',
  request_lifecycle: 'pending',
  status: 'pending',
  native_identity: {
    mission_id: 'm1',
    branch_id: 'main',
    framework: 'langgraph',
    interaction_request_id: 'irq-1',
    thread_id: 'thread-1',
    run_id: 'run-1',
  },
};

const liveMatchingBinding = {
  id: 'b1',
  mission_id: 'm1',
  branch_id: 'main',
  framework: 'langgraph',
  interrupt_id: 'irq-1',
  interaction_request_id: 'irq-1',
  control_ref_hash: 'hash',
  generation: 1,
  lifecycle_state: 'active' as const,
  registered_at: new Date().toISOString(),
  lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  last_heartbeat_at: new Date().toISOString(),
  native_identity: {
    mission_id: 'm1',
    branch_id: 'main',
    framework: 'langgraph',
    interaction_request_id: 'irq-1',
    thread_id: 'thread-1',
    run_id: 'run-1',
  },
};

function span(partial: Record<string, unknown>) {
  return {
    trace_id: 'trace-1',
    span_id: 'span-1',
    start_time_unix_nano: '1',
    end_time_unix_nano: '2',
    name: 'agent',
    attributes: {},
    events: [],
    ...partial,
  };
}

describe('normalization → interrupt identity_ambiguous propagation', () => {
  it('detects conflicting thread identity across lifecycle events for the same activity', () => {
    const spans = [
      span({
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.langgraph.thread_id': 'thread-a',
        },
        events: [
          {
            name: 'agent.tool.call',
            attributes: {
              'gen_ai.tool.name': 'search',
              'agentlens.langgraph.run_id': 'run-1',
              'agentlens.langgraph.thread_id': 'thread-a',
            },
          },
          {
            name: 'agent.interrupt.requested',
            attributes: {
              'agentlens.langgraph.run_id': 'run-1',
              'agentlens.langgraph.thread_id': 'thread-b',
              'agentlens.langgraph.interrupt_request_id': 'irq-1',
              'agentlens.interrupt.id': 'irq-1',
            },
          },
        ],
      }),
    ];

    const facts = normalizeSpansToFacts(spans);
    expect(hasAmbiguousNativeIdentity(facts.diagnostics)).toBe(true);
    expect(facts.diagnostics.some((d) => d.code === 'conflicting_native_identity' && d.field === 'thread_id')).toBe(true);

    const ambiguousIds = interruptIdsWithAmbiguousNativeIdentity(spans);
    expect(ambiguousIds.has('irq-1')).toBe(true);

    const resolution = resolveInterruptIdentityAmbiguity({
      interruptId: 'irq-1',
      ambiguousInterruptIds: ambiguousIds,
      previouslyAmbiguous: false,
      nextIdentity: {
        framework: 'langgraph',
        thread_id: 'thread-b',
        run_id: 'run-1',
        interrupt_request_id: 'irq-1',
      },
    });
    expect(resolution.fromNormalization).toBe(true);
    expect(resolution.identityAmbiguous).toBe(true);
  });

  it('detects conflicting run identity for the same interrupt request across lifecycle evidence', () => {
    const spans = [
      span({
        span_id: 'span-a',
        events: [{
          name: 'agent.interrupt.requested',
          attributes: {
            'agentlens.langgraph.run_id': 'run-a',
            'agentlens.langgraph.thread_id': 'thread-1',
            'agentlens.langgraph.interrupt_request_id': 'irq-1',
            'agentlens.interrupt.id': 'irq-1',
          },
        }],
      }),
      span({
        span_id: 'span-b',
        start_time_unix_nano: '3',
        events: [{
          name: 'agent.interrupt.requested',
          attributes: {
            'agentlens.langgraph.run_id': 'run-b',
            'agentlens.langgraph.thread_id': 'thread-1',
            'agentlens.langgraph.interrupt_request_id': 'irq-1',
            'agentlens.interrupt.id': 'irq-1',
          },
        }],
      }),
    ];

    const ambiguousIds = interruptIdsWithAmbiguousNativeIdentity(spans);
    expect(ambiguousIds.has('irq-1')).toBe(true);

    const resolution = resolveInterruptIdentityAmbiguity({
      interruptId: 'irq-1',
      ambiguousInterruptIds: ambiguousIds,
      previousIdentity: {
        framework: 'langgraph',
        run_id: 'run-a',
        thread_id: 'thread-1',
        interrupt_request_id: 'irq-1',
      },
      previouslyAmbiguous: false,
      nextIdentity: {
        framework: 'langgraph',
        run_id: 'run-b',
        thread_id: 'thread-1',
        interrupt_request_id: 'irq-1',
      },
    });
    expect(resolution.identityAmbiguous).toBe(true);
    expect(resolution.fromNormalization || resolution.fromStoredMerge).toBe(true);
  });

  it('persists identity_ambiguous and blocks actionability even with a live matching binding', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: {
        ...baseInterrupt,
        identity_ambiguous: true,
      },
      binding: liveMatchingBinding,
    });
    expect(result.actionability).toBe('identity_conflict');
  });

  it('rejects decision submission when identity is ambiguous', () => {
    const live = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: { ...baseInterrupt, identity_ambiguous: true },
      binding: liveMatchingBinding,
    });
    // decideInterrupt rejects on identity_conflict before recording.
    expect(live.actionability).toBe('identity_conflict');
    expect(
      live.actionability === 'identity_conflict'
        || live.diagnostic === 'conflicting_native_identity',
    ).toBe(true);
  });

  it('rejects bridge claim when identity is ambiguous', () => {
    const live = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: { ...baseInterrupt, identity_ambiguous: true },
      binding: liveMatchingBinding,
    });
    // claim route requires actionability === 'actionable'.
    expect(live.actionability).not.toBe('actionable');
    expect(live.actionability).toBe('identity_conflict');
  });

  it('keeps non-conflicting identity actionable with a live matching binding', () => {
    const spans = [
      span({
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.langgraph.thread_id': 'thread-1',
        },
        events: [{
          name: 'agent.interrupt.requested',
          attributes: {
            'agentlens.langgraph.run_id': 'run-1',
            'agentlens.langgraph.thread_id': 'thread-1',
            'agentlens.langgraph.interrupt_request_id': 'irq-1',
            'agentlens.interrupt.id': 'irq-1',
          },
        }],
      }),
    ];
    const ambiguousIds = interruptIdsWithAmbiguousNativeIdentity(spans);
    expect(ambiguousIds.has('irq-1')).toBe(false);

    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: liveMatchingBinding,
      identityAmbiguous: false,
    });
    expect(result.actionability).toBe('actionable');
  });

  it('keeps repeated identical ingestion idempotent and never clears ambiguity with a later partial', () => {
    const spans = [
      span({
        attributes: {
          'agentlens.langgraph.run_id': 'run-1',
          'agentlens.langgraph.thread_id': 'thread-a',
        },
        events: [
          {
            name: 'agent.tool.call',
            attributes: {
              'agentlens.langgraph.run_id': 'run-1',
              'agentlens.langgraph.thread_id': 'thread-a',
            },
          },
          {
            name: 'agent.interrupt.requested',
            attributes: {
              'agentlens.langgraph.run_id': 'run-1',
              'agentlens.langgraph.thread_id': 'thread-b',
              'agentlens.langgraph.interrupt_request_id': 'irq-1',
            },
          },
        ],
      }),
    ];

    const first = interruptIdsWithAmbiguousNativeIdentity(spans);
    const second = interruptIdsWithAmbiguousNativeIdentity(spans);
    expect([...first]).toEqual([...second]);
    expect(first.has('irq-1')).toBe(true);

    const afterAmbiguity = resolveInterruptIdentityAmbiguity({
      interruptId: 'irq-1',
      ambiguousInterruptIds: first,
      previouslyAmbiguous: true,
      previousIdentity: {
        framework: 'langgraph',
        run_id: 'run-1',
        thread_id: 'thread-a',
        interrupt_request_id: 'irq-1',
      },
      // Later partial event only carries run_id — must not clear ambiguity.
      nextIdentity: {
        framework: 'langgraph',
        run_id: 'run-1',
        interrupt_request_id: 'irq-1',
      },
    });
    expect(afterAmbiguity.identityAmbiguous).toBe(true);
    expect(nextIdentityAmbiguousFlag(true, false)).toBe(true);
    expect(nextIdentityAmbiguousFlag(false, false)).toBe(false);
  });
});
