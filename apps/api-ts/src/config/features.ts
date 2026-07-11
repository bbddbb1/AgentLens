/**
 * Deployment feature flags for the LangGraph governance vertical slice.
 * Default off unless explicitly enabled for the reference deployment.
 *
 * Control-plane availability also requires configured service authentication.
 * Observability (span_projection.v1) is independent of this gate.
 */

export function getConfiguredServiceToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = (env.AGENTLENS_SERVICE_TOKEN ?? env.AGENTLENS_API_KEY ?? '').trim();
  return token || undefined;
}

export function isLangGraphGovernanceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.LANGGRAPH_GOVERNANCE_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function isMafGovernanceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (env.MAF_GOVERNANCE_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function isLangGraphGovernanceControlAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isLangGraphGovernanceEnabled(env) && Boolean(getConfiguredServiceToken(env));
}

export function isMafGovernanceControlAvailable(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isMafGovernanceEnabled(env) && Boolean(getConfiguredServiceToken(env));
}
