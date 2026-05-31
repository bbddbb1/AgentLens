import { describe, expect, it } from 'vitest';
import { PolicyEngine } from '../../src/services/policyEngine.js';
import type { EventEnvelope } from '@agentlens/protocol';

describe('Governance PolicyEngine Paths', () => {
  const engine = new PolicyEngine();

  it('allows safe tool executions', () => {
    const event: Partial<EventEnvelope> = {
      event_type: 'tool.called',
      payload: {
        tool_name: 'web_search',
        tool_input: 'what is agent governance',
      },
    };

    const decision = engine.evaluateEvent(event as EventEnvelope);
    expect(decision).toBeNull(); // Safe event should not trigger any policy constraint
  });

  it('denies dangerous commands with high strictness', () => {
    const event: Partial<EventEnvelope> = {
      event_type: 'tool.called',
      payload: {
        tool_name: 'terminal',
        tool_input: 'rm -rf /data/files',
      },
    };

    const decision = engine.evaluateEvent(event as EventEnvelope);
    expect(decision).not.toBeNull();
    expect(decision!.decision).toBe('deny');
    expect(decision!.rule_id).toBe('rule-deny-dangerous-tools');
    expect(decision!.reason).toContain('restricted commands');
  });

  it('requires human review for critical financial activities', () => {
    const event: Partial<EventEnvelope> = {
      event_type: 'tool.called',
      payload: {
        tool_name: 'transfer_funds',
        tool_input: { amount: 1000, currency: 'USD', destination: 'account-123' },
      },
    };

    const decision = engine.evaluateEvent(event as EventEnvelope);
    expect(decision).not.toBeNull();
    expect(decision!.decision).toBe('require_review');
    expect(decision!.rule_id).toBe('rule-require-review-financial');
  });

  it('respects precedence order when multiple rules match (deny over require_review)', () => {
    // An event that triggers both require_review (transfer_funds) and deny (contains rm -rf)
    const event: Partial<EventEnvelope> = {
      event_type: 'tool.called',
      payload: {
        tool_name: 'transfer_funds',
        tool_input: 'rm -rf /dangerous/operation',
      },
    };

    const decision = engine.evaluateEvent(event as EventEnvelope);
    expect(decision).not.toBeNull();
    expect(decision!.decision).toBe('deny'); // Deny is stricter (strictness 4) than require_review (strictness 3)
  });
});
