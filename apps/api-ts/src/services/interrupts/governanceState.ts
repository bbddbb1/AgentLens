import type {
  InterruptDecisionState,
  InterruptDeliveryState,
  InterruptRequestLifecycle,
  InterruptRuntimeOutcome,
} from '@agentlens/protocol';
import type { PoolClient } from 'pg';

export type GovernanceStateAxis = 'request' | 'decision' | 'delivery' | 'runtime';

export interface GovernanceStateTransition {
  transition_id: string;
  admission_seq: number;
  axis: GovernanceStateAxis;
  state: string;
  recorded_at: string;
  source: 'interrupt_request' | 'operator_decision' | 'delivery_attempt' | 'delivery_receipt' | 'runtime_telemetry' | 'legacy_resume';
  evidence_ref?: string;
}

export interface MaterializedGovernanceState {
  request_lifecycle: InterruptRequestLifecycle;
  decision_state: InterruptDecisionState;
  delivery_state: InterruptDeliveryState;
  runtime_outcome: InterruptRuntimeOutcome;
  governance_diagnostics: string[];
}

const AXIS_ORDER: Record<GovernanceStateAxis, number> = {
  request: 0,
  decision: 1,
  delivery: 2,
  runtime: 3,
};

const VALID_STATES: Record<GovernanceStateAxis, ReadonlySet<string>> = {
  request: new Set(['pending', 'resolved', 'expired', 'stale', 'unsupported']),
  decision: new Set(['none', 'recorded']),
  delivery: new Set(['not_requested', 'pending', 'accepted', 'failed', 'stale', 'unknown']),
  runtime: new Set(['awaiting_interaction', 'resumed', 'continued_with_input', 'rejected_or_terminated', 'failed', 'unknown']),
};

function validTransition(value: unknown): value is GovernanceStateTransition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GovernanceStateTransition>;
  return typeof candidate.transition_id === 'string'
    && Number.isSafeInteger(candidate.admission_seq)
    && Number(candidate.admission_seq) > 0
    && typeof candidate.axis === 'string'
    && candidate.axis in AXIS_ORDER
    && typeof candidate.state === 'string'
    && typeof candidate.recorded_at === 'string'
    && typeof candidate.source === 'string';
}

export function parseGovernanceStateHistory(value: unknown): GovernanceStateTransition[] {
  if (!Array.isArray(value)) return [];
  return value.filter(validTransition).sort((left, right) =>
    left.admission_seq - right.admission_seq
    || AXIS_ORDER[left.axis] - AXIS_ORDER[right.axis]
    || left.transition_id.localeCompare(right.transition_id),
  );
}

export function mergeGovernanceStateHistory(
  current: unknown,
  additions: readonly GovernanceStateTransition[],
): GovernanceStateTransition[] {
  const byId = new Map(parseGovernanceStateHistory(current).map((entry) => [entry.transition_id, entry]));
  for (const addition of additions) {
    if (!validTransition(addition)) throw new Error('Invalid governance state transition');
    const prior = byId.get(addition.transition_id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(addition)) {
      throw new Error(`Governance transition identity conflict: ${addition.transition_id}`);
    }
    byId.set(addition.transition_id, addition);
  }
  return parseGovernanceStateHistory([...byId.values()]);
}

function fallbackState(axis: GovernanceStateAxis): string {
  if (axis === 'request') return 'pending';
  if (axis === 'decision') return 'none';
  if (axis === 'delivery') return 'unknown';
  return 'unknown';
}

export function materializeGovernanceState(
  historyValue: unknown,
  cutoff = Number.MAX_SAFE_INTEGER,
): MaterializedGovernanceState {
  const state: MaterializedGovernanceState = {
    request_lifecycle: 'pending',
    decision_state: 'none',
    delivery_state: 'not_requested',
    runtime_outcome: 'unknown',
    governance_diagnostics: [],
  };
  const atCutoff = parseGovernanceStateHistory(historyValue).filter((entry) => entry.admission_seq <= cutoff);
  const grouped = new Map<string, GovernanceStateTransition[]>();
  for (const entry of atCutoff) {
    if (!VALID_STATES[entry.axis].has(entry.state)) {
      state.governance_diagnostics.push(`invalid_governance_state:${entry.axis}:${entry.state}`);
      continue;
    }
    const key = `${entry.admission_seq}:${entry.axis}`;
    const entries = grouped.get(key) ?? [];
    entries.push(entry);
    grouped.set(key, entries);
  }
  for (const entries of grouped.values()) {
    const first = entries[0];
    const distinct = [...new Set(entries.map((entry) => entry.state))];
    const value = distinct.length === 1 ? distinct[0] : fallbackState(first.axis);
    if (distinct.length > 1) {
      state.governance_diagnostics.push(
        `conflicting_governance_state:${first.axis}:${first.admission_seq}:${distinct.sort().join('|')}`,
      );
    }
    if (first.axis === 'request') state.request_lifecycle = value as InterruptRequestLifecycle;
    if (first.axis === 'decision') state.decision_state = value as InterruptDecisionState;
    if (first.axis === 'delivery') state.delivery_state = value as InterruptDeliveryState;
    if (first.axis === 'runtime') state.runtime_outcome = value as InterruptRuntimeOutcome;
  }
  return state;
}

export async function appendGovernanceStateHistory(
  client: PoolClient,
  input: { missionId: string; branchId: string; interruptId: string; transitions: readonly GovernanceStateTransition[] },
): Promise<GovernanceStateTransition[]> {
  const current = await client.query(
    `SELECT governance_state_history FROM interrupts
     WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
     FOR UPDATE`,
    [input.missionId, input.branchId, input.interruptId],
  );
  if (!current.rows[0]) return [];
  const merged = mergeGovernanceStateHistory(current.rows[0].governance_state_history, input.transitions);
  await client.query(
    `UPDATE interrupts SET governance_state_history = $4::jsonb, updated_at = NOW()
     WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3`,
    [input.missionId, input.branchId, input.interruptId, JSON.stringify(merged)],
  );
  return merged;
}

export function governanceTransition(
  input: Omit<GovernanceStateTransition, 'transition_id'> & { transition_id?: string },
): GovernanceStateTransition {
  return {
    ...input,
    transition_id: input.transition_id
      ?? `${input.axis}:${input.admission_seq}:${input.state}:${input.evidence_ref ?? input.source}`,
  };
}
