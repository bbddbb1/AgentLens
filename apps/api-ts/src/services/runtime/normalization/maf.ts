import type { NativeRuntimeIdentity } from './types.js';

const PREFIX = 'agentlens.maf.';

function stringAttr(attrs: Record<string, any>, key: string): string | undefined {
  const value = attrs[key];
  return value === undefined || value === null ? undefined : String(value);
}

/** MAF-only attribute and workflow/executor identity translation. */
export function hasMafMarkers(attrs: Record<string, any>): boolean {
  return Object.keys(attrs).some((key) => key.startsWith(PREFIX))
    || attrs['workflow.id'] !== undefined
    || attrs['executor.id'] !== undefined;
}

export function mafNativeRuntimeIdentity(attrs: Record<string, any>): NativeRuntimeIdentity | undefined {
  const identity: NativeRuntimeIdentity = {
    framework: hasMafMarkers(attrs) ? 'ms_agent_framework' : undefined,
    workflow_id: stringAttr(attrs, 'agentlens.maf.workflow_id') ?? stringAttr(attrs, 'workflow.id'),
    executor_id: stringAttr(attrs, 'agentlens.maf.executor_id') ?? stringAttr(attrs, 'executor.id'),
    request_id: stringAttr(attrs, 'agentlens.maf.request_id'),
    request_type: stringAttr(attrs, 'agentlens.maf.request_type'),
    response_type: stringAttr(attrs, 'agentlens.maf.response_type'),
    activity_correlation_id: stringAttr(attrs, 'agentlens.maf.activity_correlation_id'),
    native_execution_key: stringAttr(attrs, 'agentlens.native_execution_key'),
  };
  return Object.values(identity).some((value) => value !== undefined) ? identity : undefined;
}
