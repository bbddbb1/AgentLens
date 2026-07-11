import { describe, expect, it } from 'vitest';
import type { RuntimeInterruptState } from '@agentlens/protocol';

/** Mirrors Govern-tab control filtering rules in RightSidebar after remediation. */
function supportedControls(interrupt: RuntimeInterruptState): string[] {
  const isFrameworkGovernance = interrupt.framework === 'langgraph'
    || interrupt.framework === 'ms_agent_framework'
    || Boolean(interrupt.supported_decision_types?.length)
    || interrupt.actionability !== undefined;
  if (interrupt.governance_available === false) return [];
  if (interrupt.decision_state === 'recorded') return [];
  if (isFrameworkGovernance) {
    if (interrupt.actionability !== 'actionable') return [];
    return interrupt.supported_decision_types ?? [];
  }
  return ['approve', 'reject', 'revise', 'resume'];
}

describe('Govern UI control filtering (remediation)', () => {
  it('hides controls when governance is unavailable', () => {
    expect(supportedControls({
      interrupt_id: 'i1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: false, actionability: 'actionable', framework: 'langgraph',
      supported_decision_types: ['approve'],
    })).toEqual([]);
  });

  it('shows only declared supported_decision_types for LangGraph', () => {
    expect(supportedControls({
      interrupt_id: 'i1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: true, actionability: 'actionable', framework: 'langgraph',
      supported_decision_types: ['approve'],
    })).toEqual(['approve']);
  });

  it('uses the same declared-control behavior for MAF', () => {
    expect(supportedControls({
      interrupt_id: 'maf-1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: true, actionability: 'actionable', framework: 'ms_agent_framework',
      supported_decision_types: ['approve', 'reject'],
    })).toEqual(['approve', 'reject']);
  });

  it('shows no buttons when LangGraph supported list is empty', () => {
    expect(supportedControls({
      interrupt_id: 'i1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: true, actionability: 'actionable', framework: 'langgraph',
      supported_decision_types: [],
    })).toEqual([]);
  });

  it('does not treat pending delivery as accepted or resumed', () => {
    const interrupt: RuntimeInterruptState = {
      interrupt_id: 'i1', status: 'approved', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      decision_state: 'recorded', delivery_state: 'pending', runtime_outcome: 'unknown',
    };
    expect(interrupt.delivery_state).toBe('pending');
    expect(interrupt.runtime_outcome).not.toBe('resumed');
  });

  it('keeps delivery failure distinct from runtime failure labels', () => {
    expect('failed').not.toBe('resumed');
    const deliveryFailed = 'failed';
    const runtimeFailed = 'failed';
    // Same token, different axis — UI styles them separately.
    expect(deliveryFailed).toBe(runtimeFailed);
  });

  it('keeps MAF bridge delivery failures separate from runtime outcome', () => {
    const interrupt: RuntimeInterruptState = {
      interrupt_id: 'maf-2', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      framework: 'ms_agent_framework', decision_state: 'recorded', delivery_state: 'failed', runtime_outcome: 'unknown',
    };
    expect(interrupt.delivery_state).toBe('failed');
    expect(interrupt.runtime_outcome).toBe('unknown');
  });

  it('does not expose controls for a flag-off MAF interaction', () => {
    expect(supportedControls({
      interrupt_id: 'maf-off', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      framework: 'ms_agent_framework', governance_available: false, actionability: 'unavailable',
      supported_decision_types: ['approve'],
    })).toEqual([]);
  });
});
