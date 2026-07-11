import type { NormalizedActivityKind } from './types.js';
import { genAiModel, genAiToolName } from './otelGenAi.js';

export function activityKindFromCompat(
  attrs: Record<string, any>,
  operationName?: string,
): NormalizedActivityKind {
  const spanKind = attrs['agent.span.kind'] ?? attrs['agentlens.node.type'];
  if (spanKind === 'invoke_agent' || spanKind === 'agent' || spanKind === 'agent.orchestration') return 'agent';
  if (spanKind === 'execute_tool' || spanKind === 'tool' || genAiToolName(attrs)) return 'tool';
  if (operationName === 'llm.call' || genAiModel(attrs) || attrs['gen_ai.system'] !== undefined) return 'llm';
  if (
    operationName === 'retrieval.search' ||
    attrs['retrieval.backend'] !== undefined ||
    attrs['search.query'] !== undefined
  ) {
    return 'retrieval';
  }
  return 'unknown';
}

export function originFrameworkFromAttrs(attrs: Record<string, any>): string | undefined {
  const value =
    attrs['agentlens.origin_framework'] ??
    attrs.origin_framework ??
    attrs['gen_ai.agent.framework'];
  return value === undefined || value === null ? undefined : String(value);
}

export function handoffTarget(attrs: Record<string, any>): string | undefined {
  const value =
    attrs['gen_ai.agent.handoff.target'] ??
    attrs.target_agent_id ??
    attrs['gen_ai.agent.delegation.target'];
  return value === undefined || value === null ? undefined : String(value);
}

export function isCompatibilityHandoff(eventName: string): boolean {
  return eventName === 'agent.handoff.requested' || eventName === 'agent.delegation';
}
