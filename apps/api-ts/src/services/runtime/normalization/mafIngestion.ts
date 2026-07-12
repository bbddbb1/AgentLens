/** Private MAF-to-Core interaction facts. No MAF names leak beyond this boundary. */
import { isMafEnrichmentEvent, isMafRequestEvent, mafNativeRuntimeIdentity } from './maf.js';

function value(attrs: Record<string, any> | undefined, key: string): string | undefined {
  const raw = attrs?.[key];
  return raw === undefined || raw === null ? undefined : String(raw);
}

export interface MafInteractionFact {
  interruptId: string;
  framework: 'ms_agent_framework';
  nativeIdentity: Record<string, string | undefined>;
  requestType: string;
  supportedDecisionTypes: string[];
  publicAttributes: Record<string, string>;
}

export interface MafOutcomeFact {
  interruptId: string;
  deliveryId?: string;
  outcome: 'continued_with_input' | 'rejected_or_terminated' | 'failed';
}

/** Resolve workflow/request spans within MAF's private trace translation. */
export function mafTraceWorkflowIds(spans: readonly any[]): ReadonlyMap<string, string> {
  const workflowIds = new Map<string, string>();
  for (const span of spans) {
    const workflowId = value(span?.attributes, 'agentlens.maf.workflow_id') ?? value(span?.attributes, 'workflow.id');
    if (workflowId && span?.trace_id) workflowIds.set(String(span.trace_id), workflowId);
  }
  return workflowIds;
}

export function mafInteractionFact(
  span: any,
  event: any,
  workflowIds: ReadonlyMap<string, string> = new Map(),
): MafInteractionFact | undefined {
  if (!isMafRequestEvent(event?.name)) return undefined;
  const traceWorkflowId = span?.trace_id ? workflowIds.get(String(span.trace_id)) : undefined;
  const explicitWorkflowId = value(event?.attributes, 'agentlens.maf.workflow_id')
    ?? value(event?.attributes, 'workflow.id')
    ?? value(span?.attributes, 'agentlens.maf.workflow_id')
    ?? value(span?.attributes, 'workflow.id');
  // A request event must agree with its real workflow span. This protects the
  // boundary from a mixed or rewritten native event without teaching Core any
  // MAF event semantics beyond this private translation.
  if (traceWorkflowId && explicitWorkflowId && traceWorkflowId !== explicitWorkflowId) return undefined;
  const attrs = {
    ...(span?.attributes ?? {}),
    ...(traceWorkflowId ? { 'workflow.id': traceWorkflowId } : {}),
    ...(event?.attributes ?? {}),
  };
  const identity = mafNativeRuntimeIdentity(attrs);
  const requestId = identity?.request_id;
  if (!requestId || !identity?.workflow_id) return undefined;
  return {
    interruptId: requestId,
    framework: 'ms_agent_framework',
    nativeIdentity: {
      framework: 'ms_agent_framework', workflow_id: identity.workflow_id, executor_id: identity.executor_id,
      request_id: requestId, request_type: identity.request_type, response_type: identity.response_type,
      activity_correlation_id: identity.activity_correlation_id,
    },
    requestType: identity.request_type ?? 'request_info',
    supportedDecisionTypes: ['approve', 'reject', 'structured_response'],
    publicAttributes: {
      'agentlens.interaction.framework': 'ms_agent_framework',
      'agentlens.interaction.request_id': requestId,
      'agentlens.interaction.workflow_id': identity.workflow_id,
      ...(identity.executor_id ? { 'agentlens.interaction.executor_id': identity.executor_id } : {}),
      ...(identity.request_type ? { 'agentlens.interaction.request_type': identity.request_type } : {}),
      ...(identity.response_type ? { 'agentlens.interaction.response_type': identity.response_type } : {}),
    },
  };
}

export function mafOutcomeFact(event: any): MafOutcomeFact | undefined {
  if (!isMafEnrichmentEvent(event?.name) && event?.name !== 'agentlens.maf.delivery_accepted') return undefined;
  const attrs = event?.attributes ?? {};
  const requestId = value(attrs, 'agentlens.maf.request_id');
  const deliveryId = value(attrs, 'agentlens.maf.delivery_id');
  const terminal = value(attrs, 'agentlens.maf.terminal_outcome');
  if (!requestId || !deliveryId || !terminal) return undefined;
  return {
    interruptId: requestId,
    deliveryId,
    outcome: terminal === 'alternative' ? 'rejected_or_terminated' : terminal === 'failed' ? 'failed' : 'continued_with_input',
  };
}
