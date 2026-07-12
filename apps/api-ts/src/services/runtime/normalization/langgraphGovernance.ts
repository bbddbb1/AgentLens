import { AgentAttributes, AgentEvents, type OtlpSpan } from '@agentlens/protocol';

type NativeIdentity = Record<string, string | undefined>;

export interface LangGraphOutcomeFact {
  interruptId: string;
  outcome: 'failed' | 'rejected_or_terminated' | 'continued_with_input' | 'resumed';
  deliveryId?: string;
  explicitlyCorrelated: boolean;
}

export interface LangGraphInteractionFact {
  interruptId: string;
  framework: 'langgraph';
  agentId?: string;
  reason: string;
  resumeUrl?: string;
  resumeToken?: string;
  safePrompt?: string;
  requestType: string;
  supportedDecisionTypes: string[];
  timeoutAt?: string;
  nativeIdentity: NativeIdentity;
  publicAttributes: Record<string, unknown>;
}

function attributeValue(attrs: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = attrs?.[key];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(',') : String(value);
}

function isLangGraph(attrs: Record<string, unknown>): boolean {
  return Object.keys(attrs).some((key) => key.startsWith('agentlens.langgraph.'));
}

function supportedDecisions(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Captured legacy values may be comma-separated; retain their explicit meaning.
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

export function langGraphOutcomeFact(event: NonNullable<OtlpSpan['events']>[number]): LangGraphOutcomeFact | null {
  if (event.name !== 'agent.interrupt.resumed' && event.name !== AgentEvents.INTERRUPT_RESUMED) return null;
  const attrs = event.attributes ?? {};
  const interruptId =
    attributeValue(attrs, AgentAttributes.INTERRUPT_ID) ??
    attributeValue(attrs, 'agentlens.langgraph.interrupt_request_id') ??
    attributeValue(attrs, 'agentlens.langgraph.resume_of_interrupt_id');
  if (!interruptId) return null;
  const resumeOf = attributeValue(attrs, 'agentlens.langgraph.resume_of_interrupt_id');
  const deliveryId = attributeValue(attrs, 'agentlens.langgraph.delivery_id');
  const failed = attributeValue(attrs, 'agentlens.langgraph.runtime_failure') === 'true'
    || attributeValue(attrs, 'gen_ai.error.type') !== undefined;
  const continued = attributeValue(attrs, 'agentlens.langgraph.continued_with_input') === 'true';
  const rejected = attributeValue(attrs, 'agentlens.langgraph.rejected_or_terminated') === 'true';
  return {
    interruptId,
    outcome: failed ? 'failed' : rejected ? 'rejected_or_terminated' : continued ? 'continued_with_input' : 'resumed',
    deliveryId,
    explicitlyCorrelated:
      Boolean(attributeValue(attrs, AgentAttributes.INTERRUPT_ID))
      || Boolean(attributeValue(attrs, 'agentlens.langgraph.interrupt_request_id'))
      || Boolean(resumeOf)
      || Boolean(deliveryId),
  };
}

export function langGraphInteractionFact(
  span: OtlpSpan,
  event: NonNullable<OtlpSpan['events']>[number],
  missionId: string,
  branchId: string,
): LangGraphInteractionFact | null {
  const attrs = { ...(span.attributes ?? {}), ...(event.attributes ?? {}) } as Record<string, unknown>;
  if (!isLangGraph(attrs) && event.name !== AgentEvents.INTERRUPT_REQUESTED) return null;
  const interruptId =
    attributeValue(event.attributes, AgentAttributes.INTERRUPT_ID) ??
    attributeValue(span.attributes, AgentAttributes.INTERRUPT_ID) ??
    attributeValue(attrs, 'agentlens.langgraph.interrupt_request_id') ??
    `${span.span_id}:interrupt`;
  const resumeToken = attributeValue(event.attributes, AgentAttributes.RESUME_TOKEN);
  const scrubbedAttrs = { ...(event.attributes ?? {}) } as Record<string, unknown>;
  delete scrubbedAttrs[AgentAttributes.RESUME_TOKEN];
  delete scrubbedAttrs['gen_ai.agent.resume.token'];
  return {
    interruptId,
    framework: 'langgraph',
    agentId: attributeValue(span.attributes, AgentAttributes.ID),
    reason: attributeValue(event.attributes, AgentAttributes.INTERRUPT_REASON) ?? 'Human input required',
    resumeUrl: attributeValue(event.attributes, AgentAttributes.INTERRUPT_RESUME_URL),
    resumeToken,
    safePrompt: attributeValue(attrs, 'agentlens.langgraph.interrupt_prompt')
      ?? attributeValue(attrs, AgentAttributes.INTERRUPT_REASON),
    requestType: attributeValue(attrs, 'agentlens.langgraph.interrupt_request_type') ?? 'interrupt',
    supportedDecisionTypes: supportedDecisions(attributeValue(attrs, 'agentlens.langgraph.supported_decisions')),
    timeoutAt: attributeValue(event.attributes, AgentAttributes.TIMEOUT_AT),
    nativeIdentity: {
      framework: 'langgraph',
      thread_id: attributeValue(attrs, 'agentlens.langgraph.thread_id'),
      run_id: attributeValue(attrs, 'agentlens.langgraph.run_id'),
      parent_run_id: attributeValue(attrs, 'agentlens.langgraph.parent_run_id'),
      interrupt_request_id: attributeValue(attrs, 'agentlens.langgraph.interrupt_request_id') ?? interruptId,
      checkpoint_id: attributeValue(attrs, 'agentlens.langgraph.checkpoint_id'),
      checkpoint_ns: attributeValue(attrs, 'agentlens.langgraph.checkpoint_ns'),
      activity_correlation_id: attributeValue(attrs, 'agentlens.langgraph.activity_correlation_id'),
      native_execution_key: attributeValue(attrs, 'agentlens.native_execution_key'),
      mission_id: missionId,
      branch_id: branchId,
    },
    publicAttributes: scrubbedAttrs,
  };
}
