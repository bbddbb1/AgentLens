import { describe, expect, it } from 'vitest';
import { ReplayBranch, MissionEventRecord } from '@agentlens/protocol';
import { ROOT_BRANCH_ID } from '../../src/services/runtime/types.js';
import {
  buildBranchLineage,
  createDefaultBranch,
  createMissionEventRecord,
  selectEventsForBranch,
} from '../../src/services/runtime/BranchManager.js';

function event(
  type: string,
  payload: Record<string, unknown> = {},
  extra: Partial<MissionEventRecord> = {},
): MissionEventRecord {
  return {
    id: `e-${type}`,
    mission_id: 'm1',
    branch_id: ROOT_BRANCH_ID,
    sequence_num: 0,
    branch_sequence_num: 0,
    event_type: type,
    timestamp: '2026-01-01T00:00:00.000Z',
    payload,
    metadata: {},
    ...extra,
  };
}

describe('buildBranchLineage', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const branches: ReplayBranch[] = [
    { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
    { id: 'main-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 5, status: 'active', metadata: {}, created_at: now, updated_at: now },
    { id: 'main-b1-c1', mission_id: 'm1', name: 'C1', parent_branch_id: 'main-b1', forked_from_sequence_num: 10, status: 'active', metadata: {}, created_at: now, updated_at: now },
    { id: 'orphan', mission_id: 'm1', name: 'Orphan', parent_branch_id: 'nonexistent', status: 'active', metadata: {}, created_at: now, updated_at: now },
  ];

  it('returns root-to-leaf lineage', () => {
    const lineage = buildBranchLineage(branches, 'main-b1-c1');
    expect(lineage.map((b) => b.id)).toEqual([ROOT_BRANCH_ID, 'main-b1', 'main-b1-c1']);
  });

  it('returns just root for main branch', () => {
    const lineage = buildBranchLineage(branches, ROOT_BRANCH_ID);
    expect(lineage.map((b) => b.id)).toEqual([ROOT_BRANCH_ID]);
  });

  it('returns empty if branch not found', () => {
    const lineage = buildBranchLineage(branches, 'nonexistent');
    expect(lineage).toEqual([]);
  });

  it('returns orphan branch only', () => {
    const lineage = buildBranchLineage(branches, 'orphan');
    expect(lineage.map((b) => b.id)).toEqual(['orphan']);
  });
});

describe('createDefaultBranch', () => {
  it('creates a main branch for the given mission', () => {
    const branch = createDefaultBranch('m1');
    expect(branch.id).toBe(ROOT_BRANCH_ID);
    expect(branch.mission_id).toBe('m1');
    expect(branch.name).toBe('Main');
    expect(branch.status).toBe('active');
    expect(branch.metadata).toEqual({});
  });
});

describe('createMissionEventRecord', () => {
  it('assigns a UUID if no id provided', () => {
    const record = createMissionEventRecord({
      mission_id: 'm1',
      branch_id: ROOT_BRANCH_ID,
      event_type: 'task.started',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
    expect(record.id).toBeDefined();
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses provided id', () => {
    const record = createMissionEventRecord({
      id: 'my-custom-id',
      mission_id: 'm1',
      branch_id: ROOT_BRANCH_ID,
      event_type: 'task.started',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { key: 'val' },
      metadata: { meta: 'data' },
    });
    expect(record.id).toBe('my-custom-id');
    expect(record.payload).toEqual({ key: 'val' });
    expect(record.metadata).toEqual({ meta: 'data' });
  });

  it('defaults empty payload and metadata', () => {
    const record = createMissionEventRecord({
      mission_id: 'm1',
      branch_id: ROOT_BRANCH_ID,
      event_type: 'task.started',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(record.payload).toEqual({});
    expect(record.metadata).toEqual({});
  });
});

describe('selectEventsForBranch', () => {
  it('includes events on the branch itself after fork', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: ROOT_BRANCH_ID + '-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 2, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];

    const events: MissionEventRecord[] = [
      event('task.started', { task: 'T1', task_id: 't1' }, { id: 'e0', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 0, branch_sequence_num: 0 }),
      event('task.completed', { task: 'T1', task_id: 't1' }, { id: 'e1', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 1, branch_sequence_num: 1 }),
      event('task.started', { task: 'T2', task_id: 't2' }, { id: 'e2', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 2, branch_sequence_num: 2 }),
      event('task.started', { task: 'TB1', task_id: 'tb1' }, { id: 'e3', agent_id: 'a1', branch_id: ROOT_BRANCH_ID + '-b1', sequence_num: 3, branch_sequence_num: 0 }),
    ];

    const selected = selectEventsForBranch(events, branches, ROOT_BRANCH_ID + '-b1');
    // Should include root events up to fork point (seq <= 2) plus branch events
    expect(selected.map((e) => e.id)).toEqual(['e0', 'e1', 'e2', 'e3']);
  });

  it('includes only root events for root branch', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: ROOT_BRANCH_ID + '-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 1, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];

    const events: MissionEventRecord[] = [
      event('task.started', { task: 'T1', task_id: 't1' }, { id: 'e0', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 0, branch_sequence_num: 0 }),
      event('task.completed', { task: 'T1', task_id: 't1' }, { id: 'e1', agent_id: 'a1', branch_id: ROOT_BRANCH_ID, sequence_num: 1, branch_sequence_num: 1 }),
      event('task.started', { task: 'TB1', task_id: 'tb1' }, { id: 'e2', agent_id: 'a1', branch_id: ROOT_BRANCH_ID + '-b1', sequence_num: 2, branch_sequence_num: 0 }),
    ];

    const selected = selectEventsForBranch(events, branches, ROOT_BRANCH_ID);
    // Root branch events that are before the fork at seq 1
    expect(selected.map((e) => e.id)).toEqual(['e0', 'e1']);
  });
});
