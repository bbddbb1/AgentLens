import type { InterruptControlMode, InterruptSupportedDecisionType } from '@agentlens/protocol';
import { supportsStructuredDecisionSchema } from './structuredDecisionBounds.js';

export type GovernanceControlErrorCode =
  | 'control_unavailable'
  | 'control_unsupported'
  | 'not_actionable'
  | 'identity_conflict'
  | 'request_finalized'
  | 'idempotency_conflict'
  | 'invalid_decision';

export class GovernanceControlError extends Error {
  constructor(
    public readonly code: GovernanceControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GovernanceControlError';
  }
}

export function controlModeFromRow(row: Record<string, unknown>): InterruptControlMode {
  const stored = String(row.control_mode ?? '');
  if (stored === 'framework_binding' || stored === 'legacy_token' || stored === 'unavailable') {
    return stored;
  }
  // Missing pre-migration authority is never interpreted as legacy.
  return 'unavailable';
}

export function isExplicitLegacyControl(row: Record<string, unknown>): boolean {
  return controlModeFromRow(row) === 'legacy_token'
    && !row.framework
    && !row.native_identity;
}

export function effectiveFrameworkDecisionTypes(row: Record<string, unknown>): InterruptSupportedDecisionType[] {
  const declared = Array.isArray(row.supported_decision_types)
    ? row.supported_decision_types.map(String)
    : [];
  const schema = row.safe_input_schema && typeof row.safe_input_schema === 'object' && !Array.isArray(row.safe_input_schema)
    ? row.safe_input_schema as Record<string, unknown>
    : undefined;
  return declared.filter((value): value is InterruptSupportedDecisionType => {
    if (value === 'approve' || value === 'reject') return true;
    return value === 'structured_response' && supportsStructuredDecisionSchema(schema).ok;
  });
}

export function governanceErrorStatus(error: GovernanceControlError): number {
  if (error.code === 'control_unavailable') return 503;
  if (
    error.code === 'identity_conflict'
    || error.code === 'not_actionable'
    || error.code === 'request_finalized'
    || error.code === 'idempotency_conflict'
  ) return 409;
  if (error.code === 'control_unsupported' || error.code === 'invalid_decision') return 422;
  return 500;
}
