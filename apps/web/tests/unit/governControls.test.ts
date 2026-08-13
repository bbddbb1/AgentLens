import { describe, expect, it } from 'vitest';
import type { RuntimeInterruptState, RuntimeState } from '@agentlens/protocol';
import { isActionableInterrupt, isCurrentStateForSelectedFrame, supportedDecisions } from '@/components/layout/RightSidebar';

describe('Govern UI control filtering (remediation)', () => {
  it('never treats latest runtime state as authoritative for a historical frame', () => {
    const state = {
      mission_id: 'mission-1', branch_id: 'main', sequence_num: 9,
      status: 'active', phase: 'runtime', agents: {}, interrupts: {}, nodes: [], edges: [],
    } as RuntimeState;
    expect(isCurrentStateForSelectedFrame(state, 'mission-1', 'main', 4, false)).toBe(false);
    expect(isCurrentStateForSelectedFrame(state, 'mission-1', 'main', 4, true)).toBe(false);
    expect(isCurrentStateForSelectedFrame(state, 'mission-1', 'main', 9, true)).toBe(true);
  });

  it('hides controls when governance is unavailable', () => {
    expect(isActionableInterrupt({
      interrupt_id: 'i1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: false, actionability: 'actionable', framework: 'langgraph',
      control_mode: 'framework_binding', request_lifecycle: 'pending',
      supported_decision_types: ['approve'],
    })).toBe(false);
  });

  it('shows only declared supported_decision_types for LangGraph', () => {
    const interrupt: RuntimeInterruptState = {
      interrupt_id: 'i1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: true, actionability: 'actionable', framework: 'langgraph',
      control_mode: 'framework_binding', request_lifecycle: 'pending',
      supported_decision_types: ['approve'],
    };
    expect(supportedDecisions(interrupt)).toEqual(['approve']);
    expect(isActionableInterrupt(interrupt)).toBe(true);
  });

  it('uses the same declared-control behavior for MAF', () => {
    const interrupt: RuntimeInterruptState = {
      interrupt_id: 'maf-1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: true, actionability: 'actionable', framework: 'ms_agent_framework',
      control_mode: 'framework_binding', request_lifecycle: 'pending',
      supported_decision_types: ['approve', 'reject'],
    };
    expect(supportedDecisions(interrupt)).toEqual(['approve', 'reject']);
    expect(isActionableInterrupt(interrupt)).toBe(true);
  });

  it('shows no buttons when LangGraph supported list is empty', () => {
    expect(isActionableInterrupt({
      interrupt_id: 'i1', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      governance_available: true, actionability: 'actionable', framework: 'langgraph',
      control_mode: 'framework_binding', request_lifecycle: 'pending',
      supported_decision_types: [],
    })).toBe(false);
  });

  it('does not treat pending delivery as accepted or resumed', () => {
    const interrupt: RuntimeInterruptState = {
      interrupt_id: 'i1', status: 'approved', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      decision_state: 'recorded', delivery_state: 'pending', runtime_outcome: 'unknown',
    };
    expect(interrupt.delivery_state).toBe('pending');
    expect(interrupt.runtime_outcome).not.toBe('resumed');
  });

  it('keeps decision success separate from runtime resume', () => {
    const accepted = { decision_state: 'recorded', delivery_state: 'delivered', runtime_outcome: 'unknown' };
    expect(accepted.decision_state).toBe('recorded');
    expect(accepted.delivery_state).toBe('delivered');
    expect(accepted.runtime_outcome).toBe('unknown');
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
    expect(isActionableInterrupt({
      interrupt_id: 'maf-off', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      framework: 'ms_agent_framework', governance_available: false, actionability: 'unavailable',
      control_mode: 'framework_binding', request_lifecycle: 'pending',
      supported_decision_types: ['approve'],
    })).toBe(false);
  });

  it('never infers legacy controls from missing authority metadata', () => {
    const missing: RuntimeInterruptState = {
      interrupt_id: 'missing', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      request_lifecycle: 'pending', governance_available: true, actionability: 'actionable',
    };
    expect(supportedDecisions(missing)).toEqual([]);
    expect(isActionableInterrupt(missing)).toBe(false);
  });

  it('retains only explicitly declared legacy-token controls', () => {
    const legacy: RuntimeInterruptState = {
      interrupt_id: 'legacy', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      request_lifecycle: 'pending', governance_available: true, actionability: 'actionable', control_mode: 'legacy_token',
    };
    expect(supportedDecisions(legacy)).toEqual(['approve', 'reject', 'revise', 'resume']);
    expect(isActionableInterrupt(legacy)).toBe(true);
  });

  it('hides structured response because the UI cannot collect a typed value', () => {
    const structured: RuntimeInterruptState = {
      interrupt_id: 'structured', status: 'pending', reason: 'x', payload: {}, updated_at: new Date().toISOString(),
      request_lifecycle: 'pending', governance_available: true, actionability: 'actionable', control_mode: 'framework_binding',
      framework: 'langgraph', supported_decision_types: ['structured_response'], safe_input_schema: { type: 'object', properties: {} },
    };
    expect(supportedDecisions(structured)).toEqual([]);
    expect(isActionableInterrupt(structured)).toBe(false);
  });
});
