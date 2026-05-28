/**
 * Deterministic agent color assignment
 */

export const AGENT_PALETTE = [
  '#818cf8', // indigo-400
  '#f472b6', // pink-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#67e8f9', // cyan-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#4ade80', // green-400
];

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

export function getAgentColorRgb(agentId: string): string {
  const hex = getAgentColor(agentId);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}
