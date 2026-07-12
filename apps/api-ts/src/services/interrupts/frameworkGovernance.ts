/** Explicit private framework policy selection for shared Core governance. */
import { isLangGraphGovernanceControlAvailable, isLangGraphGovernanceEnabled, isMafGovernanceControlAvailable, isMafGovernanceEnabled } from '../../config/features.js';
import { LANGGRAPH_IDENTITY_POLICY, MAF_IDENTITY_POLICY, type GovernanceIdentityPolicy } from './identityMatch.js';

export interface FrameworkGovernanceConfig {
  framework: 'langgraph' | 'ms_agent_framework';
  controlAvailable: boolean;
  enabled: boolean;
  identityPolicy: GovernanceIdentityPolicy;
}

/**
 * This is deliberately a closed switch, not a public adapter or registry.
 * Core callers receive only framework-neutral governance mechanics.
 */
export function frameworkGovernanceFor(
  framework: unknown,
  env: NodeJS.ProcessEnv = process.env,
): FrameworkGovernanceConfig | undefined {
  if (framework === 'langgraph') {
    return {
      framework,
      controlAvailable: isLangGraphGovernanceControlAvailable(env),
      enabled: isLangGraphGovernanceEnabled(env),
      identityPolicy: LANGGRAPH_IDENTITY_POLICY,
    };
  }
  if (framework === 'ms_agent_framework') {
    return {
      framework,
      controlAvailable: isMafGovernanceControlAvailable(env),
      enabled: isMafGovernanceEnabled(env),
      identityPolicy: MAF_IDENTITY_POLICY,
    };
  }
  return undefined;
}
