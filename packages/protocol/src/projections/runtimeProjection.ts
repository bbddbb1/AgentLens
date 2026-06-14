/** Bump when any projection envelope shape changes. */
export const RUNTIME_PROJECTION_VERSION = 1;

export const NODE_PROJECTION_VERSION = 1;
export const NODE_GENERATED_PROJECTION_VERSION = 1;
export const DETERMINISTIC_PROMPT_VERSION = 'deterministic-v1';
export const NODE_LLM_PROMPT_VERSION = 'node-understanding-v1';

export function isNodeProjectionCacheValid(
  cached: { projection_version?: number; prompt_version?: string },
): boolean {
  return cached.projection_version === NODE_GENERATED_PROJECTION_VERSION
    && cached.prompt_version === NODE_LLM_PROMPT_VERSION;
}

/**
 * Base interface for all disposable runtime projections derived from EventEnvelope + replay.
 * Implementations: Node, Mission/Summary, Graph, Timeline, Policy, HITL (future).
 */
export interface RuntimeProjection {
  projection_version: number;
  mission_id: string;
  branch_id: string;
  sequence_num: number;
  generated_at: string;
}
