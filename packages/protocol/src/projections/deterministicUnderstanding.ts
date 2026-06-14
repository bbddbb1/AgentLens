import type { NodeProjectionFacts } from '../types.js';

/**
 * Deterministic current_understanding from facts only — no business ontology.
 */
export function buildDeterministicUnderstanding(facts: NodeProjectionFacts, agentName: string): string {
  const parts: string[] = [];

  switch (facts.status) {
    case 'completed':
      parts.push(`${agentName} has completed its assigned work.`);
      break;
    case 'failed':
      parts.push(`${agentName} encountered a failure and may need recovery.`);
      break;
    case 'waiting':
      parts.push(`${agentName} is waiting before it can continue.`);
      break;
    case 'reviewing':
      parts.push(`${agentName} is in a review cycle.`);
      break;
    case 'active':
      parts.push(`${agentName} is actively executing.`);
      break;
    default:
      parts.push(`${agentName} is idle.`);
      break;
  }

  if (facts.produced_outputs.length > 0) {
    const names = facts.produced_outputs.slice(0, 3).map((o) => o.name).join(', ');
    const suffix = facts.produced_outputs.length > 3 ? ` and ${facts.produced_outputs.length - 3} more` : '';
    parts.push(`Produced ${facts.produced_outputs.length} output(s): ${names}${suffix}.`);
  }

  if (facts.next_transition) {
    const verb = facts.next_transition.kind === 'handoff' ? 'Handoff' : 'Delegation';
    parts.push(`${verb} to ${facts.next_transition.target} is recorded.`);
  }

  if (facts.pending) {
    parts.push(`Pending: ${facts.pending}`);
  } else if (facts.requires_human) {
    parts.push('Human intervention is required.');
  }

  if (facts.warnings.length > 0) {
    parts.push(`${facts.warnings.length} warning(s) recorded.`);
  }

  return parts.join(' ');
}
