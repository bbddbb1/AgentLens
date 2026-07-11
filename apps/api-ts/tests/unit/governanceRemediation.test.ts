import { describe, expect, it } from 'vitest';
import { evaluateActionability } from '../../src/services/interrupts/reconcileActionability.js';
import { canAdvanceDelivery, canAdvanceRuntimeOutcome } from '../../src/services/interrupts/deliveryLifecycle.js';
import { isLangGraphGovernanceControlAvailable } from '../../src/config/features.js';
import { hasAmbiguousNativeIdentity, mergeNativeRuntimeIdentities } from '../../src/services/runtime/normalization/index.js';

const baseInterrupt = {
  interrupt_id: 'irq-1',
  mission_id: 'm1',
  branch_id: 'main',
  framework: 'langgraph',
  native_identity: {
    mission_id: 'm1',
    branch_id: 'main',
    framework: 'langgraph',
    interaction_request_id: 'irq-1',
    thread_id: 'thread-1',
  },
};

const liveBinding = {
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
  },
};

describe('authoritative actionability evaluation', () => {
  it('requires governance control availability', () => {
    const result = evaluateActionability({
      governanceControlAvailable: false,
      interrupt: baseInterrupt,
      binding: liveBinding,
    });
    expect(result.actionability).toBe('unavailable');
  });

  it('matches interrupt + live binding → actionable', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: liveBinding,
    });
    expect(result.actionability).toBe('actionable');
  });

  it('interrupt without binding → observed_only', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: null,
    });
    expect(result.actionability).toBe('observed_only');
  });

  it('binding without interrupt → no actionable request', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: null,
      binding: liveBinding,
    });
    expect(result.actionability).toBe('observed_only');
    expect(result.reason).toBe('binding_without_interrupt');
  });

  it('missing required identity → non-actionable', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: {
        ...baseInterrupt,
        native_identity: { ...baseInterrupt.native_identity, thread_id: undefined },
      },
      binding: liveBinding,
    });
    expect(result.actionability).toBe('observed_only');
    expect(result.reason).toContain('missing_required');
  });

  it('identity conflict → identity_conflict', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: {
        ...liveBinding,
        native_identity: { ...liveBinding.native_identity, thread_id: 'other-thread' },
      },
    });
    expect(result.actionability).toBe('identity_conflict');
  });

  it('expired binding → non-actionable', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: {
        ...liveBinding,
        lease_expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(result.actionability).toBe('observed_only');
  });

  it('revoked binding → non-actionable', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: { ...liveBinding, lifecycle_state: 'revoked' },
    });
    expect(result.actionability).toBe('observed_only');
  });

  it('ambiguous native identity blocks control', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: liveBinding,
      identityAmbiguous: true,
    });
    expect(result.actionability).toBe('identity_conflict');
  });

  it('does not match on interrupt id alone when thread differs', () => {
    const result = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: {
        ...liveBinding,
        interrupt_id: 'irq-1',
        interaction_request_id: 'irq-1',
        native_identity: {
          ...liveBinding.native_identity,
          thread_id: 'different',
        },
      },
    });
    expect(result.actionability).toBe('identity_conflict');
  });
});

describe('monotonic delivery and runtime outcome', () => {
  it('never reclaims terminal delivery states', () => {
    expect(canAdvanceDelivery('accepted', 'pending')).toBe(false);
    expect(canAdvanceDelivery('unknown', 'pending')).toBe(false);
    expect(canAdvanceDelivery('failed', 'pending')).toBe(false);
    expect(canAdvanceDelivery('pending', 'accepted')).toBe(true);
  });

  it('preserves runtime failure across late accepted receipt axis', () => {
    expect(canAdvanceRuntimeOutcome('failed', 'resumed')).toBe(false);
    expect(canAdvanceDelivery('pending', 'accepted')).toBe(true);
  });

  it('handles outcome before and after accepted delivery independently', () => {
    expect(canAdvanceRuntimeOutcome('unknown', 'resumed')).toBe(true);
    expect(canAdvanceDelivery('pending', 'accepted')).toBe(true);
    expect(canAdvanceDelivery('accepted', 'failed')).toBe(false);
  });
});

describe('governance auth fail-closed', () => {
  it('requires both flag and service token for control availability', () => {
    expect(isLangGraphGovernanceControlAvailable({})).toBe(false);
    expect(isLangGraphGovernanceControlAvailable({
      LANGGRAPH_GOVERNANCE_ENABLED: 'true',
    })).toBe(false);
    expect(isLangGraphGovernanceControlAvailable({
      LANGGRAPH_GOVERNANCE_ENABLED: 'true',
      AGENTLENS_SERVICE_TOKEN: 'secret',
    })).toBe(true);
  });
});

describe('ambiguous identity gating from normalization', () => {
  it('wires conflicting_native_identity into governance block signal', () => {
    const merged = mergeNativeRuntimeIdentities([
      { identity: { run_id: 'a', thread_id: 't1' }, source: { attribute_keys: [], translator: 'langgraph', span_id: '1' } },
      { identity: { run_id: 'b', thread_id: 't1' }, source: { attribute_keys: [], translator: 'langgraph', span_id: '2' } },
    ]);
    expect(hasAmbiguousNativeIdentity(merged.diagnostics)).toBe(true);
    const gated = evaluateActionability({
      governanceControlAvailable: true,
      interrupt: baseInterrupt,
      binding: liveBinding,
      identityAmbiguous: hasAmbiguousNativeIdentity(merged.diagnostics),
    });
    expect(gated.actionability).toBe('identity_conflict');
  });
});
