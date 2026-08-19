import { randomUUID } from 'node:crypto';
import type { MissionEventRecord, ReplayBranch } from '@agentlens/protocol';
import { eventsThroughCursor, orderFrameEvents } from '@agentlens/protocol/internal';
import { ROOT_BRANCH_ID } from './types.js';
import { materializeGovernanceState, parseGovernanceStateHistory } from '../interrupts/governanceState.js';

export function createDefaultBranch(missionId: string): ReplayBranch {
  const now = new Date().toISOString();
  return {
    id: ROOT_BRANCH_ID,
    mission_id: missionId,
    name: 'Main',
    status: 'active',
    metadata: {},
    created_at: now,
    updated_at: now,
  };
}

export function buildBranchLineage(branches: ReplayBranch[], branchId = ROOT_BRANCH_ID): ReplayBranch[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const lineage: ReplayBranch[] = [];
  let cursor = byId.get(branchId);
  while (cursor) {
    lineage.push(cursor);
    cursor = cursor.parent_branch_id ? byId.get(cursor.parent_branch_id) : undefined;
  }
  if (lineage.length === 0) return [];
  return lineage.reverse();
}

export function selectEventsForBranch(
  events: MissionEventRecord[],
  branches: ReplayBranch[],
  branchId = ROOT_BRANCH_ID,
): MissionEventRecord[] {
  const lineage = buildBranchLineage(branches, branchId);
  if (lineage.length === 0) return [];

  const selected: MissionEventRecord[] = [];
  for (let index = 0; index < lineage.length; index += 1) {
    const branch = lineage[index];
    const nextBranch = lineage[index + 1];
    const upperBound = nextBranch?.forked_from_sequence_num;
    const branchEvents = events.filter((event) => event.branch_id === branch.id);
    const visibleBranchEvents = upperBound === undefined
      ? orderFrameEvents(branchEvents)
      : eventsThroughCursor(branchEvents, upperBound);
    for (const event of visibleBranchEvents) {
      selected.push(event);
    }
  }

  return orderFrameEvents(selected);
}

type AdmittedBranchRecord = {
  branch_id?: string;
  admission_seq?: number;
};

/**
 * Select append-only span revisions admitted into an immutable branch lineage.
 * Ancestors are bounded by the exact cursor captured by the next fork.
 */
export function selectSpanRevisionsForBranch<T extends AdmittedBranchRecord>(
  spans: readonly T[],
  branches: ReplayBranch[],
  branchId = ROOT_BRANCH_ID,
): T[] {
  const lineage = buildBranchLineage(branches, branchId);
  if (lineage.length === 0) return [];

  const selected: T[] = [];
  for (let index = 0; index < lineage.length; index += 1) {
    const branch = lineage[index];
    const upperBound = lineage[index + 1]?.forked_from_sequence_num;
    for (const span of spans) {
      if ((span.branch_id ?? branchId) !== branch.id) continue;
      if (upperBound !== undefined && (span.admission_seq ?? Number.MAX_SAFE_INTEGER) > upperBound) continue;
      selected.push(span);
    }
  }

  return selected.sort((left, right) =>
    (left.admission_seq ?? 0) - (right.admission_seq ?? 0),
  );
}

type AdmittedInterruptRecord = Record<string, unknown> & {
  interrupt_id?: string;
  branch_id?: string;
  requested_admission_seq?: number | null;
  decided_admission_seq?: number | null;
  resumed_admission_seq?: number | null;
  governance_state_history?: unknown;
};

/** Apply the same immutable ancestor cutoff to persisted interrupt lifecycle facts. */
export function selectInterruptsForBranch<T extends AdmittedInterruptRecord>(
  interrupts: readonly T[],
  branches: ReplayBranch[],
  branchId = ROOT_BRANCH_ID,
): T[] {
  const lineage = buildBranchLineage(branches, branchId);
  if (lineage.length === 0) return [];
  const selected: T[] = [];

  for (let index = 0; index < lineage.length; index += 1) {
    const branch = lineage[index];
    const upperBound = lineage[index + 1]?.forked_from_sequence_num;
    for (const source of interrupts) {
      if ((source.branch_id ?? branchId) !== branch.id) continue;
      const requested = Number(source.requested_admission_seq ?? 0);
      if (upperBound !== undefined && requested > upperBound) continue;
      if (upperBound === undefined) {
        selected.push(source);
        continue;
      }

      const row = { ...source } as T;
      const history = parseGovernanceStateHistory(source.governance_state_history)
        .filter((transition) => transition.admission_seq <= upperBound);
      const axes = materializeGovernanceState(history, upperBound);
      Object.assign(row, {
        governance_state_history: history,
        request_lifecycle: axes.request_lifecycle,
        decision_state: axes.decision_state,
        delivery_state: axes.delivery_state,
        runtime_outcome: axes.runtime_outcome,
        governance_diagnostics: axes.governance_diagnostics,
      });
      const decided = Number(source.decided_admission_seq ?? 0);
      const resumed = Number(source.resumed_admission_seq ?? 0);
      if (decided > upperBound) {
        Object.assign(row, {
          status: 'pending',
          decision: null,
          decision_comment: null,
          decision_payload: {},
          decided_at: null,
          decided_admission_seq: null,
          resumed_at: null,
          resumed_admission_seq: null,
          decision_state: 'none',
          delivery_state: 'not_requested',
          runtime_outcome: 'awaiting_interaction',
        });
      } else if (resumed > upperBound) {
        Object.assign(row, {
          status: source.decision === 'approve' ? 'approved' : source.decision === 'reject' ? 'rejected' : 'pending',
          resumed_at: null,
          resumed_admission_seq: null,
        });
      }
      Object.assign(row, {
        request_lifecycle: axes.request_lifecycle,
        decision_state: axes.decision_state,
        delivery_state: axes.delivery_state,
        runtime_outcome: axes.runtime_outcome,
      });
      selected.push(row);
    }
  }
  const scopesByInterruptId = new Map<string, Set<string>>();
  for (const row of selected) {
    const interruptId = String(row.interrupt_id ?? '');
    if (!interruptId) continue;
    const scopes = scopesByInterruptId.get(interruptId) ?? new Set<string>();
    scopes.add(String(row.branch_id ?? branchId));
    scopesByInterruptId.set(interruptId, scopes);
  }
  return selected.map((row) => {
    const interruptId = String(row.interrupt_id ?? '');
    if (!interruptId || (scopesByInterruptId.get(interruptId)?.size ?? 0) <= 1) return row;
    return {
      ...row,
      source_interrupt_id: interruptId,
      interrupt_id: `${String(row.branch_id ?? branchId)}::${interruptId}`,
    } as T;
  });
}

export function createMissionEventRecord(
  input: Omit<MissionEventRecord, 'id'> & { id?: string },
): MissionEventRecord {
  return {
    id: input.id ?? randomUUID(),
    ...input,
    metadata: input.metadata ?? {},
    payload: input.payload ?? {},
  };
}
