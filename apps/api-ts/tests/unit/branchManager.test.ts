import { describe, expect, it } from 'vitest';
import { ReplayBranch, MissionEventRecord } from '@agentlens/protocol';
import { ROOT_BRANCH_ID } from '../../src/services/runtime/types.js';
import {
  buildBranchLineage,
  createDefaultBranch,
  createMissionEventRecord,
  selectEventsForBranch,
  selectInterruptsForBranch,
  selectSpanRevisionsForBranch,
} from '../../src/services/runtime/BranchManager.js';
import { projectReplayEvidence } from '../../src/services/runtime/projection.js';

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

  it('cuts parent lineage at each fork for nested branches', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: 'main-b1', mission_id: 'm1', name: 'B1', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 1, status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: 'main-b1-c1', mission_id: 'm1', name: 'C1', parent_branch_id: 'main-b1', forked_from_sequence_num: 3, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];
    const events: MissionEventRecord[] = [
      event('task.started', { task: 'root-0' }, { id: 'e0', branch_id: ROOT_BRANCH_ID, sequence_num: 0, branch_sequence_num: 0 }),
      event('task.completed', { task: 'root-1' }, { id: 'e1', branch_id: ROOT_BRANCH_ID, sequence_num: 1, branch_sequence_num: 1 }),
      event('task.started', { task: 'root-late' }, { id: 'e2', branch_id: ROOT_BRANCH_ID, sequence_num: 2, branch_sequence_num: 2 }),
      event('task.started', { task: 'b1-0' }, { id: 'e3', branch_id: 'main-b1', sequence_num: 3, branch_sequence_num: 0 }),
      event('task.completed', { task: 'b1-late' }, { id: 'e4', branch_id: 'main-b1', sequence_num: 4, branch_sequence_num: 1 }),
      event('task.started', { task: 'c1-0' }, { id: 'e5', branch_id: 'main-b1-c1', sequence_num: 5, branch_sequence_num: 0 }),
    ];

    const selected = selectEventsForBranch(events, branches, 'main-b1-c1');
    expect(selected.map((e) => e.id)).toEqual(['e0', 'e1', 'e3', 'e5']);
  });
});

describe('immutable span-backed branch inheritance', () => {
  it('freezes the parent admission prefix and scopes colliding source span ids', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: 'child', mission_id: 'm1', name: 'Child', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 1, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];
    const revisions = [
      {
        branch_id: ROOT_BRANCH_ID, admission_seq: 1, revision_num: 1,
        span_id: 'collision', trace_id: 'parent-trace', parent_span_id: null,
        operation_name: 'parent-A', start_time_unix_nano: '200', end_time_unix_nano: '250',
        status_code: 'OK', attributes: { revision: 'A' }, events: [],
      },
      {
        branch_id: ROOT_BRANCH_ID, admission_seq: 2, revision_num: 2,
        span_id: 'collision', trace_id: 'parent-trace', parent_span_id: null,
        operation_name: 'parent-B', start_time_unix_nano: '100', end_time_unix_nano: '260',
        status_code: 'OK', attributes: { revision: 'B' }, events: [],
      },
      {
        branch_id: 'child', admission_seq: 3, revision_num: 1,
        span_id: 'collision', trace_id: 'child-trace', parent_span_id: null,
        operation_name: 'child', start_time_unix_nano: '300', end_time_unix_nano: '350',
        status_code: 'OK', attributes: {}, events: [],
      },
    ];

    const selected = selectSpanRevisionsForBranch(revisions, branches, 'child');
    expect(selected.map((span) => [span.branch_id, span.admission_seq, span.operation_name])).toEqual([
      ['main', 1, 'parent-A'],
      ['child', 3, 'child'],
    ]);

    const replay = projectReplayEvidence('m1', 'child', selected);
    const nodes = replay.snapshots.at(-1)?.nodes ?? [];
    expect(nodes).toHaveLength(2);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(2);
    expect(nodes.map((node) => node.source_span_id)).toEqual(['collision', 'collision']);
    expect(replay.snapshots.map((snapshot) => snapshot.sequence_num)).toEqual([1, 3]);
  });

  it('rewinds ancestor interrupt lifecycle facts to the fork admission', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const branches: ReplayBranch[] = [
      { id: ROOT_BRANCH_ID, mission_id: 'm1', name: 'Main', status: 'active', metadata: {}, created_at: now, updated_at: now },
      { id: 'child', mission_id: 'm1', name: 'Child', parent_branch_id: ROOT_BRANCH_ID, forked_from_sequence_num: 2, status: 'active', metadata: {}, created_at: now, updated_at: now },
    ];
    const selected = selectInterruptsForBranch([{
      branch_id: ROOT_BRANCH_ID,
      interrupt_id: 'interrupt-1',
      status: 'resumed',
      decision: 'approve',
      decision_comment: 'later',
      decision_payload: { accepted: true },
      decision_state: 'recorded',
      delivery_state: 'delivered',
      runtime_outcome: 'resumed',
      requested_admission_seq: 2,
      decided_admission_seq: 3,
      resumed_admission_seq: 4,
    }], branches, 'child');

    expect(selected).toMatchObject([{
      interrupt_id: 'interrupt-1',
      status: 'pending',
      decision: null,
      decided_admission_seq: null,
      resumed_admission_seq: null,
      decision_state: 'none',
      delivery_state: 'not_requested',
    }]);
  });
});
