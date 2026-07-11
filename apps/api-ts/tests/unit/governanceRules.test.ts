import { describe, expect, it } from 'vitest';
import { MAF_IDENTITY_POLICY, matchGovernanceIdentity } from '../../src/services/interrupts/identityMatch.js';
import { validateStructuredDecisionValue } from '../../src/services/interrupts/structuredDecisionBounds.js';
import { canAdvanceDelivery, canAdvanceRuntimeOutcome } from '../../src/services/interrupts/deliveryLifecycle.js';
import { isBindingLive } from '../../src/services/interrupts/bridgeBindings.js';
import { extractBearerToken, getConfiguredServiceToken } from '../../src/middleware/serviceAuth.js';
import { isMafGovernanceControlAvailable, isMafGovernanceEnabled } from '../../src/config/features.js';
import type { Request } from 'express';

describe('governance identity matching', () => {
  const base = {
    mission_id: 'm1',
    branch_id: 'main',
    framework: 'langgraph',
    interaction_request_id: 'irq-1',
    thread_id: 'thread-1',
  };

  it('matches required fields', () => {
    const result = matchGovernanceIdentity(base, { ...base, run_id: 'r1' }, { requireThreadId: true });
    expect(result.status === 'match' || result.status === 'partial').toBe(true);
  });

  it('blocks on missing required identity', () => {
    const result = matchGovernanceIdentity(base, { ...base, thread_id: undefined }, { requireThreadId: true });
    expect(result.status).toBe('missing_required');
  });

  it('treats optional absence as partial', () => {
    const result = matchGovernanceIdentity(
      { ...base, run_id: 'r1' },
      { ...base },
      { requireThreadId: true },
    );
    expect(result.status).toBe('partial');
  });

  it('diagnoses explicit conflicts', () => {
    const result = matchGovernanceIdentity(
      { ...base, run_id: 'r1' },
      { ...base, run_id: 'r2' },
      { requireThreadId: true },
    );
    expect(result.status).toBe('conflict');
  });

  it('does not use native_execution_key for matching', () => {
    const result = matchGovernanceIdentity(
      { ...base, native_execution_key: 'a' },
      { ...base, native_execution_key: 'b' },
      { requireThreadId: true },
    );
    expect(result.status).toBe('match');
  });

  it('matches MAF workflow/request identity while treating executor identity as consistency-only', () => {
    const maf = {
      mission_id: 'm1', branch_id: 'main', framework: 'ms_agent_framework',
      workflow_id: 'workflow-1', request_id: 'request-1',
    };
    const result = matchGovernanceIdentity(maf, { ...maf, executor_id: 'executor-1' }, {
      policy: MAF_IDENTITY_POLICY,
    });
    expect(result).toMatchObject({ status: 'partial', missingOptional: ['executor_id'] });
  });
});

describe('structured decision bounds', () => {
  it('rejects oversized payloads', () => {
    const value = { text: 'x'.repeat(20_000) };
    const result = validateStructuredDecisionValue(value);
    expect(result.ok).toBe(false);
  });

  it('rejects over-deep nesting', () => {
    let value: any = { v: 1 };
    for (let i = 0; i < 10; i += 1) value = { nested: value };
    expect(validateStructuredDecisionValue(value).ok).toBe(false);
  });

  it('rejects schema-invalid values', () => {
    const result = validateStructuredDecisionValue(
      { answer: 1 },
      { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    );
    expect(result.ok).toBe(false);
  });

  it('returns a safe summary for valid values', () => {
    const result = validateStructuredDecisionValue(
      { answer: 'yes' },
      { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toMatchObject({ kind: 'object' });
      expect(result.summary).not.toHaveProperty('answer');
    }
  });
});

describe('delivery and outcome non-regression', () => {
  it('does not regress accepted delivery to failed/pending', () => {
    expect(canAdvanceDelivery('accepted', 'failed')).toBe(false);
    expect(canAdvanceDelivery('accepted', 'pending')).toBe(false);
    expect(canAdvanceDelivery('pending', 'accepted')).toBe(true);
  });

  it('preserves failed runtime outcome', () => {
    expect(canAdvanceRuntimeOutcome('failed', 'resumed')).toBe(false);
    expect(canAdvanceRuntimeOutcome('unknown', 'failed')).toBe(true);
  });

  it('keeps accepted delivery distinct from an uncorrelated runtime outcome', () => {
    expect(canAdvanceRuntimeOutcome('unknown', 'continued_with_input')).toBe(true);
    expect(canAdvanceRuntimeOutcome('continued_with_input', 'unknown')).toBe(false);
  });
});

describe('binding liveness helper', () => {
  it('treats expired leases as not live', () => {
    expect(isBindingLive({
      lifecycle_state: 'active',
      lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    })).toBe(false);
    expect(isBindingLive({
      lifecycle_state: 'revoked',
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    })).toBe(false);
  });
});

describe('service auth', () => {
  it('keeps MAF governance independently disabled and fails closed without a token', () => {
    expect(isMafGovernanceEnabled({ MAF_GOVERNANCE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMafGovernanceControlAvailable({ MAF_GOVERNANCE_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMafGovernanceControlAvailable({
      MAF_GOVERNANCE_ENABLED: 'true', AGENTLENS_SERVICE_TOKEN: 'token',
    } as NodeJS.ProcessEnv)).toBe(true);
  });
  it('reads configured service token', () => {
    expect(getConfiguredServiceToken({})).toBeUndefined();
    expect(getConfiguredServiceToken({ AGENTLENS_SERVICE_TOKEN: 'secret' })).toBe('secret');
  });

  it('extracts bearer tokens', () => {
    const req = {
      header: (name: string) => (name.toLowerCase() === 'authorization' ? 'Bearer abc' : undefined),
    } as Request;
    expect(extractBearerToken(req)).toBe('abc');
  });
});
