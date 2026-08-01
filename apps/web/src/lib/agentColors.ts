/**
 * Deterministic agent color assignment
 */

export const AGENT_PALETTE = ['var(--color-agent-0)', 'var(--color-agent-1)', 'var(--color-agent-2)', 'var(--color-agent-3)', 'var(--color-agent-4)', 'var(--color-agent-5)', 'var(--color-agent-6)', 'var(--color-agent-7)'];

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

export function getAgentColor(agentId: string): string {
  if (!agentId) return AGENT_PALETTE[0];
  const hash = simpleHash(agentId);
  return AGENT_PALETTE[hash % AGENT_PALETTE.length];
}
