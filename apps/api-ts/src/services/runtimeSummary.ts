import type {
  ProjectNodeStateInput,
  ProjectRuntimeSummaryInput,
  RuntimeNodeProjection,
  RuntimeSummary,
} from '@agentlens/protocol';
import {
  NODE_PROJECTION_VERSION,
  isNodeProjectionCacheValid,
  projectNodeState,
  projectRuntimeSummary,
  projectRuntimeSummaryFromExplanation,
} from '@agentlens/protocol/internal';
import type { RuntimeExplanationProjection } from '@agentlens/protocol';

export function buildRuntimeSummary(input: ProjectRuntimeSummaryInput): RuntimeSummary {
  return projectRuntimeSummary(input);
}

export function buildRuntimeSummaryFromExplanation(
  input: ProjectRuntimeSummaryInput,
  explanation: RuntimeExplanationProjection,
): RuntimeSummary {
  return projectRuntimeSummaryFromExplanation(input, explanation);
}

/**
 * Unbounded generated prose is quarantined for R0. The compatibility endpoint
 * remains callable but returns the deterministic, evidence-bounded summary.
 */
export async function enhanceRuntimeSummaryWithLlm(
  summary: RuntimeSummary,
): Promise<RuntimeSummary> {
  return summary;
}

export async function buildRuntimeSummaryWithOptionalLlm(
  input: ProjectRuntimeSummaryInput,
  useLlm = false,
): Promise<RuntimeSummary> {
  const summary = buildRuntimeSummary(input);
  return useLlm ? enhanceRuntimeSummaryWithLlm(summary) : summary;
}

export function buildNodeProjection(
  input: ProjectNodeStateInput,
): RuntimeNodeProjection | null {
  return projectNodeState(input);
}

/**
 * Node enhancement is likewise quarantined: callers receive canonical
 * deterministic generated text rather than an alternative semantic authority.
 */
export async function enhanceNodeProjectionWithLlm(
  projection: RuntimeNodeProjection,
): Promise<RuntimeNodeProjection> {
  return projection;
}

export { isNodeProjectionCacheValid };
export const NODE_PROJECTION_CACHE_VERSION = NODE_PROJECTION_VERSION;
