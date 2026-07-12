import { describe, expect, it } from 'vitest';
import { serializeInterruptPublic } from '../../src/services/interrupts/publicSerializer.js';
import { canAdvanceDelivery, canAdvanceRuntimeOutcome } from '../../src/services/interrupts/deliveryLifecycle.js';

const FORBIDDEN = [
  'control_ref',
  'control_ref_hash',
  'claimed_at',
  'claiming_binding_id',
  'claim_deadline',
  'authorized_binding_id',
  'resume_token',
  'checkpoint_payload',
  'application_state',
];

describe('governance public-output scans', () => {
  it('excludes private bridge and claim fields from interrupt serialization', () => {
    const publicInterrupt = serializeInterruptPublic({
      id: '11111111-1111-1111-1111-111111111111',
      mission_id: '22222222-2222-2222-2222-222222222222',
      interrupt_id: 'irq-1',
      status: 'approved',
      reason: 'ok',
      payload: {
        resume_token: 'super-secret',
        control_ref: 'should-not-leak',
        authorized_binding_id: 'should-not-leak',
        event: 'agent.interrupt.requested',
      },
      decision_payload: { token: 'also-secret', kind: 'approve' },
      decision_value_summary: { kind: 'approve' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      decision_state: 'recorded',
      delivery_state: 'accepted',
      runtime_outcome: 'unknown',
      governance_available: true,
    } as any);

    const blob = JSON.stringify(publicInterrupt);
    expect(blob).not.toContain('super-secret');
    expect(blob).not.toContain('should-not-leak');
    expect(blob).not.toContain('also-secret');
    expect(blob).not.toContain('control_ref');
    expect(blob).not.toContain('claimed_at');
    expect(blob).not.toContain('claiming_binding_id');
    expect(blob).not.toContain('authorized_binding_id');
    expect(publicInterrupt.payload).not.toHaveProperty('resume_token');
    expect(publicInterrupt.delivery_state).toBe('accepted');
    expect(publicInterrupt.runtime_outcome).toBe('unknown');
  });

  it('keeps accepted delivery with failed runtime outcome independent', () => {
    expect(canAdvanceDelivery('accepted', 'failed')).toBe(false);
    expect(canAdvanceRuntimeOutcome('unknown', 'failed')).toBe(true);
  });

  it('allowlists MAF public facts and excludes native workflow definition/state', () => {
    const output = serializeInterruptPublic({
      id: '1', mission_id: '2', interrupt_id: 'maf-request', status: 'pending', reason: 'review',
      payload: {
        attributes: {
          'workflow.definition': '{"executors":["secret"]}',
          'agentlens.maf.request_id': 'maf-request',
          'agentlens.maf.workflow_id': 'private-workflow-id',
          'agentlens.maf.response_type': 'ReferenceReviewResponse',
        },
      },
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      framework: 'ms_agent_framework',
    } as any);
    const blob = JSON.stringify(output);
    expect(blob).not.toContain('workflow.definition');
    expect(blob).not.toContain('private-workflow-id');
    expect(blob).not.toContain('executors');
    expect(blob).toContain('maf-request');
    expect(blob).toContain('ReferenceReviewResponse');
  });
});
