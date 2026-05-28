import { randomUUID } from 'node:crypto';
import { MissionEventRecord, ReplayBranch } from '@agentlens/protocol';
import { ROOT_BRANCH_ID } from './types.js';

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
    for (const event of events) {
      if (event.branch_id !== branch.id) continue;
      if (upperBound !== undefined && event.sequence_num > upperBound) continue;
      selected.push(event);
    }
  }

  return selected.sort((left, right) => left.sequence_num - right.sequence_num);
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
