import type { InterruptRecord } from '@agentlens/protocol';
import { isLangGraphGovernanceControlAvailable, isMafGovernanceControlAvailable } from '../../config/features.js';
import { materializeGovernanceState, parseGovernanceStateHistory } from './governanceState.js';
import { controlModeFromRow, effectiveFrameworkDecisionTypes } from './controlAuthority.js';

const SENSITIVE_PAYLOAD_KEYS = new Set([
  'resume_token',
  'control_ref',
  'control_reference',
  'bridge_control_ref',
  'resumeToken',
  'claimed_at',
  'claiming_binding_id',
  'claim_deadline',
  'authorized_binding_id',
  'receipt_state',
  'control_ref_hash',
  'workflow.definition',
  'workflow_definition',
  'workflow_state',
  'workflow_object',
  'executor_state',
  'checkpoint',
  'queue',
]);

const PUBLIC_ATTRIBUTE_ALLOWLIST = new Set([
  'agentlens.maf.request_id',
  'agentlens.maf.request_type',
  'agentlens.maf.response_type',
  'agentlens.maf.safe_data_state',
  'agentlens.maf.terminal_outcome',
  'agentlens.maf.delivery_id',
]);

function scrubRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    if (SENSITIVE_PAYLOAD_KEYS.has(key)) continue;
    if (lowered.includes('token') || lowered.includes('secret')) continue;
    if (lowered.includes('control_ref') || lowered.includes('workflow.definition') || lowered.includes('workflow_state') || lowered.includes('checkpoint') || lowered.includes('queue')) continue;
    if (key.startsWith('agentlens.maf.') && !PUBLIC_ATTRIBUTE_ALLOWLIST.has(key)) continue;
    out[key] = entry;
  }
  // Nested span attribute bags often carry resume tokens.
  if (out.attributes && typeof out.attributes === 'object' && !Array.isArray(out.attributes)) {
    out.attributes = scrubRecord(out.attributes as Record<string, unknown>);
  }
  return out;
}

/**
 * Map a DB interrupt row into the public InterruptRecord shape without private
 * binding/claim/control fields. Legacy rows default to non-actionable observation.
 */
export function mapInterruptRowToRecord(
  row: Record<string, unknown>,
  options?: { governanceEnabled?: boolean },
): InterruptRecord & { branch_id?: string } {
  const framework = row.framework ? String(row.framework) : undefined;
  const controlMode = controlModeFromRow(row);
  const legacyControl = controlMode === 'legacy_token' && !framework && !row.native_identity;
  const frameworkDeploymentAvailable = options?.governanceEnabled ?? (
    framework === 'ms_agent_framework'
      ? isMafGovernanceControlAvailable()
      : framework === 'langgraph'
        ? isLangGraphGovernanceControlAvailable()
        : false
  );
  const governanceEnabled = legacyControl
    || (controlMode === 'framework_binding' && frameworkDeploymentAvailable);
  const governanceHistory = parseGovernanceStateHistory(row.governance_state_history);
  const historyState = governanceHistory.length > 0
    ? materializeGovernanceState(governanceHistory)
    : undefined;
  const decisionState = historyState?.decision_state
    ?? (row.decision_state ? String(row.decision_state) : undefined)
    ?? (row.decision || row.decision_id ? 'recorded' : 'none');
  const deliveryState = historyState?.delivery_state
    ?? (row.delivery_state ? String(row.delivery_state) : undefined)
    ?? 'not_requested';
  const runtimeOutcome = historyState?.runtime_outcome
    ?? (row.runtime_outcome ? String(row.runtime_outcome) : undefined)
    ?? 'unknown';
  const requestLifecycle = historyState?.request_lifecycle
    ?? (row.request_lifecycle ? String(row.request_lifecycle) : undefined)
    ?? 'pending';
  const legacyPending = requestLifecycle === 'pending'
    && !['resumed', 'expired', 'cancelled'].includes(String(row.status ?? ''))
    && (!row.expires_at || new Date(String(row.expires_at)).getTime() > Date.now());
  const actionability = legacyControl
    ? (legacyPending ? 'actionable' : 'unavailable')
    : (row.actionability ? String(row.actionability) : undefined) ?? 'observed_only';

  const record: InterruptRecord & { branch_id?: string } = {
    id: String(row.id),
    mission_id: String(row.mission_id),
    branch_id: row.branch_id ? String(row.branch_id) : undefined,
    interrupt_id: String(row.interrupt_id),
    agent_id: row.agent_id ? String(row.agent_id) : undefined,
    span_id: row.span_id ? String(row.span_id) : undefined,
    status: String(row.status),
    reason: String(row.reason),
    resume_url: row.resume_url ? String(row.resume_url) : undefined,
    payload: scrubRecord((row.payload as Record<string, unknown>) ?? {}),
    decision: row.decision ? String(row.decision) : undefined,
    decision_comment: row.decision_comment ? String(row.decision_comment) : undefined,
    // Prefer allowlisted summary; fall back to scrubbed legacy payload.
    decision_payload: scrubRecord(
      (row.decision_value_summary as Record<string, unknown>)
        ?? (row.decision_payload as Record<string, unknown>)
        ?? {},
    ),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
    expires_at: row.expires_at ? new Date(String(row.expires_at)).toISOString() : undefined,
    decided_at: row.decided_at ? new Date(String(row.decided_at)).toISOString() : undefined,
    resumed_at: row.resumed_at ? new Date(String(row.resumed_at)).toISOString() : undefined,
    request_lifecycle: requestLifecycle as InterruptRecord['request_lifecycle'],
    // Public controls must fail closed when this interaction's framework is
    // disabled, even if a historical row still stores actionable.
    actionability: (governanceEnabled ? actionability : 'unavailable') as InterruptRecord['actionability'],
    request_type: row.request_type ? String(row.request_type) : undefined,
    supported_decision_types: legacyControl
      ? []
      : effectiveFrameworkDecisionTypes(row),
    safe_prompt: row.safe_prompt ? String(row.safe_prompt) : undefined,
    safe_input_schema: (row.safe_input_schema as Record<string, unknown>) ?? undefined,
    decision_state: decisionState as InterruptRecord['decision_state'],
    decision_id: row.decision_id ? String(row.decision_id) : undefined,
    decision_actor: row.decision_actor ? String(row.decision_actor) : undefined,
    decision_type: row.decision_type ? String(row.decision_type) : undefined,
    decision_value_summary: scrubRecord((row.decision_value_summary as Record<string, unknown>) ?? {}),
    delivery_state: deliveryState as InterruptRecord['delivery_state'],
    delivery_id: row.delivery_id ? String(row.delivery_id) : undefined,
    runtime_outcome: runtimeOutcome as InterruptRecord['runtime_outcome'],
    governance_diagnostics: historyState?.governance_diagnostics.length
      ? historyState.governance_diagnostics
      : Array.isArray(row.governance_diagnostics)
        ? row.governance_diagnostics.map(String)
        : undefined,
    control_mode: controlMode,
    framework,
    governance_available: governanceEnabled,
  };

  return serializeInterruptPublic(record);
}

/**
 * Explicit public allowlist serializer. Strips resume tokens, control refs,
 * claim internals, and other private bridge fields.
 */
export function serializeInterruptPublic(
  interrupt: InterruptRecord & { branch_id?: string },
): InterruptRecord & { branch_id?: string } {
  return {
    id: interrupt.id,
    mission_id: interrupt.mission_id,
    branch_id: interrupt.branch_id,
    interrupt_id: interrupt.interrupt_id,
    agent_id: interrupt.agent_id,
    span_id: interrupt.span_id,
    status: interrupt.status,
    reason: interrupt.reason,
    resume_url: interrupt.resume_url,
    payload: scrubRecord(interrupt.payload),
    decision: interrupt.decision,
    decision_comment: interrupt.decision_comment,
    decision_payload: scrubRecord(interrupt.decision_payload),
    created_at: interrupt.created_at,
    updated_at: interrupt.updated_at,
    expires_at: interrupt.expires_at,
    decided_at: interrupt.decided_at,
    resumed_at: interrupt.resumed_at,
    request_lifecycle: interrupt.request_lifecycle,
    actionability: interrupt.actionability,
    request_type: interrupt.request_type,
    supported_decision_types: interrupt.supported_decision_types,
    safe_prompt: interrupt.safe_prompt,
    safe_input_schema: interrupt.safe_input_schema,
    decision_state: interrupt.decision_state,
    decision_id: interrupt.decision_id,
    decision_actor: interrupt.decision_actor,
    decision_type: interrupt.decision_type,
    decision_value_summary: scrubRecord(interrupt.decision_value_summary),
    delivery_state: interrupt.delivery_state,
    delivery_id: interrupt.delivery_id,
    runtime_outcome: interrupt.runtime_outcome,
    governance_diagnostics: interrupt.governance_diagnostics,
    control_mode: interrupt.control_mode,
    framework: interrupt.framework,
    governance_available: interrupt.governance_available === true,
  };
}
