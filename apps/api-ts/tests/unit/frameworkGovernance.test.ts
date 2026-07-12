import { describe, expect, it } from 'vitest';
import { frameworkGovernanceFor } from '../../src/services/interrupts/frameworkGovernance.js';

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
});
