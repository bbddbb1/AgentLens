/** Private normalization of framework-native telemetry for public projection. */
import { hasMafMarkers } from './maf.js';
import type { NativeRuntimeIdentity } from './types.js';

const FORBIDDEN_PUBLIC_KEY = /(^workflow\.(definition|id)$|workflow[_\.](definition|state|object)|executor[_\. ](id|state)|checkpoint|queue|control[_\. ]ref|token|secret)/i;

/** Return bounded public metadata; framework-native MAF bags never escape. */
export function publicTelemetryAttributes(attrs: Record<string, any> | undefined): Record<string, unknown> {
  const source = attrs ?? {};
  if (hasMafMarkers(source)) return {};
  return Object.fromEntries(Object.entries(source).filter(([key]) => !FORBIDDEN_PUBLIC_KEY.test(key)));
}

/** Replace framework-native operation/event names with public-neutral labels. */
export function publicTelemetryName(
  spanAttributes: Record<string, any> | undefined,
  name: string,
  eventAttributes?: Record<string, any> | undefined,
): string {
  if (hasMafMarkers({ ...(spanAttributes ?? {}), ...(eventAttributes ?? {}) })) {
    return eventAttributes ? 'framework.interaction' : 'framework.activity';
  }
  return name;
}

/** Preserve existing non-MAF metadata while keeping MAF native identity private. */
export function publicRuntimeIdentity(identity: NativeRuntimeIdentity | undefined): Record<string, unknown> {
  if (!identity) return {};
  if (identity.framework === 'ms_agent_framework') {
    return {
      native_runtime_identity: {
        framework: identity.framework,
        ...(identity.workflow_id ? { workflow_id: identity.workflow_id } : {}),
        ...(identity.executor_id ? { executor_id: identity.executor_id } : {}),
        ...(identity.request_id ? { request_id: identity.request_id } : {}),
      },
    };
  }
  return { native_runtime_identity: identity };
}
