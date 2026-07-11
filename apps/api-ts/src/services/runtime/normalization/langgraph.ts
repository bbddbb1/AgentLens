import type { NativeRuntimeIdentity } from './types.js';

const PREFIX = 'agentlens.langgraph.';

export function hasLangGraphMarkers(attrs: Record<string, any>): boolean {
  return Object.keys(attrs).some((key) => key.startsWith(PREFIX));
}

export function isLangGraphRetrieval(attrs: Record<string, any>): boolean {
  return attrs['agentlens.langgraph.retrieval'] === 'true' || attrs['agentlens.langgraph.retrieval'] === true;
}

export function isExplicitLangGraphHandoff(attrs: Record<string, any>): boolean {
  return attrs['agentlens.langgraph.explicit_handoff'] === 'true' || attrs['agentlens.langgraph.explicit_handoff'] === true;
}

export function langGraphRunId(attrs: Record<string, any>): string | undefined {
  return stringAttr(attrs, 'agentlens.langgraph.run_id');
}

export function langGraphActivityCorrelationId(attrs: Record<string, any>): string | undefined {
  return stringAttr(attrs, 'agentlens.langgraph.activity_correlation_id');
}

export function nativeRuntimeIdentity(attrs: Record<string, any>): NativeRuntimeIdentity | undefined {
  const identity: NativeRuntimeIdentity = {
    framework: hasLangGraphMarkers(attrs) ? 'langgraph' : undefined,
    thread_id: stringAttr(attrs, 'agentlens.langgraph.thread_id'),
    run_id: langGraphRunId(attrs),
    parent_run_id: stringAttr(attrs, 'agentlens.langgraph.parent_run_id'),
    interrupt_request_id: stringAttr(attrs, 'agentlens.langgraph.interrupt_request_id'),
    resume_of_interrupt_id: stringAttr(attrs, 'agentlens.langgraph.resume_of_interrupt_id'),
    checkpoint_id: stringAttr(attrs, 'agentlens.langgraph.checkpoint_id'),
    checkpoint_ns: stringAttr(attrs, 'agentlens.langgraph.checkpoint_ns'),
    activity_correlation_id: langGraphActivityCorrelationId(attrs),
    native_execution_key: stringAttr(attrs, 'agentlens.native_execution_key'),
  };
  return Object.values(identity).some((value) => value !== undefined) ? identity : undefined;
}

function stringAttr(attrs: Record<string, any>, key: string): string | undefined {
  const value = attrs[key];
  return value === undefined || value === null ? undefined : String(value);
}
