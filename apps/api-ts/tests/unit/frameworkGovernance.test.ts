import { describe, expect, it } from 'vitest';
import { frameworkGovernanceFor } from '../../src/services/interrupts/frameworkGovernance.js';
import { mapInterruptRowToRecord } from '../../src/services/interrupts/publicSerializer.js';

describe('closed framework governance selection', () => {
  it('keeps MAF enabled independently from LangGraph public availability', () => {
    const env = {
      MAF_GOVERNANCE_ENABLED: 'true',
      LANGGRAPH_GOVERNANCE_ENABLED: 'false',
      AGENTLENS_SERVICE_TOKEN: 'service-token',
    } as NodeJS.ProcessEnv;

    expect(frameworkGovernanceFor('ms_agent_framework', env)?.controlAvailable).toBe(true);
    expect(frameworkGovernanceFor('langgraph', env)?.controlAvailable).toBe(false);
  });

  it.each([
    ['true', 'false', 'ms_agent_framework', true],
    ['true', 'false', 'langgraph', false],
    ['false', 'true', 'ms_agent_framework', false],
    ['false', 'true', 'langgraph', true],
  ])('fails closed in public output for MAF=%s LangGraph=%s and framework %s', (maf, langgraph, framework, available) => {
    const env = {
      MAF_GOVERNANCE_ENABLED: maf,
      LANGGRAPH_GOVERNANCE_ENABLED: langgraph,
      AGENTLENS_SERVICE_TOKEN: 'service-token',
    } as NodeJS.ProcessEnv;
    const governanceEnabled = frameworkGovernanceFor(framework, env)?.controlAvailable ?? false;
    const record = mapInterruptRowToRecord({
      id: 'row', mission_id: 'mission', branch_id: 'main', interrupt_id: 'request',
      status: 'pending', reason: 'review', framework, control_mode: 'framework_binding',
      request_lifecycle: 'pending', actionability: 'actionable',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }, { governanceEnabled });
    expect(record.governance_available).toBe(available);
    expect(record.actionability).toBe(available ? 'actionable' : 'unavailable');
  });
});
