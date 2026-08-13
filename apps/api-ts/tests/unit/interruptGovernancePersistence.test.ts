import { describe, expect, it } from 'vitest';
import { mapInterruptRowToRecord, serializeInterruptPublic } from '../../src/services/interrupts/publicSerializer.js';
import {
  isLangGraphGovernanceControlAvailable,
  isLangGraphGovernanceEnabled,
} from '../../src/config/features.js';

describe('LangGraph governance interrupt persistence serializers', () => {
  it('reads legacy interrupt rows as non-actionable observations', () => {
    const record = mapInterruptRowToRecord({
      id: '11111111-1111-1111-1111-111111111111',
      mission_id: '22222222-2222-2222-2222-222222222222',
      branch_id: 'main',
      interrupt_id: 'interrupt-1',
      status: 'pending',
      reason: 'Human input required',
      payload: { resume_token: 'secret-token-value', event: 'agent.interrupt.requested' },
      decision_payload: {},
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }, { governanceEnabled: false });

    expect(record.actionability).toBe('unavailable');
    expect(record.decision_state).toBe('none');
    expect(record.delivery_state).toBe('not_requested');
    expect(record.runtime_outcome).toBe('unknown');
    expect(record.governance_available).toBe(false);
    expect(record.payload).not.toHaveProperty('resume_token');
    expect(JSON.stringify(record)).not.toContain('secret-token-value');
  });

  it('round-trips independent decision, delivery, and runtime-outcome axes', () => {
    const record = mapInterruptRowToRecord({
      id: '11111111-1111-1111-1111-111111111111',
      mission_id: '22222222-2222-2222-2222-222222222222',
      branch_id: 'main',
      interrupt_id: 'interrupt-1',
      status: 'approved',
      reason: 'approve',
      payload: {},
      decision: 'approve',
      decision_state: 'recorded',
      decision_id: '33333333-3333-3333-3333-333333333333',
      decision_actor: 'local-operator',
      decision_type: 'approve',
      decision_value_summary: { kind: 'approve' },
      delivery_state: 'accepted',
      delivery_id: '44444444-4444-4444-4444-444444444444',
      runtime_outcome: 'failed',
      actionability: 'actionable',
      request_lifecycle: 'resolved',
      framework: 'langgraph',
      control_mode: 'framework_binding',
      supported_decision_types: ['approve', 'reject'],
      claimed_at: '2026-01-01T00:01:00.000Z',
      claiming_binding_id: 'should-not-leak',
      control_ref_hash: 'should-not-leak',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:02:00.000Z',
      decided_at: '2026-01-01T00:00:30.000Z',
    }, { governanceEnabled: true });

    expect(record.decision_state).toBe('recorded');
    expect(record.delivery_state).toBe('accepted');
    expect(record.runtime_outcome).toBe('failed');
    expect(record.governance_available).toBe(true);
    expect(record).not.toHaveProperty('claimed_at');
    expect(record).not.toHaveProperty('claiming_binding_id');
    expect(record).not.toHaveProperty('control_ref_hash');
    expect(JSON.stringify(serializeInterruptPublic(record))).not.toContain('should-not-leak');
  });

  it('makes only explicitly marked legacy-token rows actionable', () => {
    const base = {
      id: '11111111-1111-1111-1111-111111111111',
      mission_id: '22222222-2222-2222-2222-222222222222', branch_id: 'main',
      interrupt_id: 'legacy', status: 'pending', reason: 'review', payload: {},
      request_lifecycle: 'pending', decision_state: 'none',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    expect(mapInterruptRowToRecord(base, { governanceEnabled: true })).toMatchObject({
      control_mode: 'unavailable', governance_available: false, actionability: 'unavailable',
    });
    expect(mapInterruptRowToRecord({ ...base, control_mode: 'legacy_token' })).toMatchObject({
      control_mode: 'legacy_token', governance_available: true, actionability: 'actionable',
    });
  });

  it('defaults the LangGraph governance feature flag to disabled', () => {
    expect(isLangGraphGovernanceEnabled({})).toBe(false);
    expect(isLangGraphGovernanceEnabled({ LANGGRAPH_GOVERNANCE_ENABLED: 'true' })).toBe(true);
    expect(isLangGraphGovernanceControlAvailable({
      LANGGRAPH_GOVERNANCE_ENABLED: 'true',
    })).toBe(false);
    expect(isLangGraphGovernanceControlAvailable({
      LANGGRAPH_GOVERNANCE_ENABLED: 'true',
      AGENTLENS_SERVICE_TOKEN: 'tok',
    })).toBe(true);
  });
});
