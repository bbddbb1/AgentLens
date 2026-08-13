import type { RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';

export interface RuntimeStoryFixture {
  id: 'corpus-a-bsops' | 'corpus-b-hitl' | 'corpus-c-sparse-conflict';
  label: string;
  summary: RuntimeSummary;
  explanation: RuntimeExplanationProjection;
}

function timestamp(sequenceNum: number): string {
  return `2026-06-29T00:00:${String(sequenceNum).padStart(2, '0')}.000Z`;
}

function baseSummary(
  id: RuntimeStoryFixture['id'],
  headline: string,
  phase: string,
  sequenceNum: number,
): RuntimeSummary {
  return {
    mission_id: `${id}-mission`,
    branch_id: 'main',
    sequence_num: sequenceNum,
    generated_at: timestamp(sequenceNum),
    objective: headline,
    status: phase === 'failed' ? 'failed' : phase === 'waiting_for_human' ? 'paused' : 'active',
    phase,
    headline,
    progress: [],
    activities: [],
    observations: [],
    decisions: [],
    evidence: [],
    actions: [],
    pending_work: [],
    warnings: [],
    artifacts: [],
    interrupts: [],
    agents: [],
    nodes: [],
    is_blocked: phase === 'failed',
    requires_human: phase === 'waiting_for_human',
    source: 'deterministic',
  };
}

function baseExplanation(
  id: RuntimeStoryFixture['id'],
  sequenceNum: number,
  runOutcome: RuntimeExplanationProjection['run_outcome'],
): RuntimeExplanationProjection {
  const provenance = { basis: 'unknown' as const, condition: 'not_recorded' as const, evidence_refs: [] };
  const status = runOutcome === 'active'
    ? 'Active'
    : runOutcome === 'waiting'
      ? 'Waiting'
      : runOutcome === 'completed'
        ? 'Completed'
        : runOutcome === 'failed'
          ? 'Failed'
          : 'Unknown';
  return {
    mission_id: `${id}-mission`,
    branch_id: 'main',
    as_of_sequence_num: sequenceNum,
    as_of_timestamp: timestamp(sequenceNum),
    projection_version: 'runtime_explanation.v1',
    run_outcome: runOutcome,
    run_outcome_provenance: provenance,
    frame: {
      mission_id: `${id}-mission`, branch_id: 'main', sequence_num: sequenceNum,
      as_of_timestamp: timestamp(sequenceNum), projection_version: 'runtime_explanation.v1',
    },
    run_status: status,
    run_status_provenance: provenance,
    runtime_phase: { id: `phase:${status}`, label: status === 'Active' ? 'Active Work' : status, basis: 'unknown', evidence_refs: [] },
    progress_markers: [],
    selected_activity_state: { kind: 'no_activity', reason: 'no_selectable_activity' },
    run_duration_provenance: provenance,
    activities: [],
    relations: [],
    parallel_groups: [],
    merge_groups: [],
    consistency_flags: [],
  };
}

export const runtimeStoryFixtures: RuntimeStoryFixture[] = [
  {
    id: 'corpus-a-bsops',
    label: 'Corpus A - BSOps update/diagnosis',
    summary: baseSummary('corpus-a-bsops', 'Execution completed', 'executing', 6),
    explanation: baseExplanation('corpus-a-bsops', 6, 'completed'),
  },
  {
    id: 'corpus-b-hitl',
    label: 'Corpus B - Generic HITL multi-agent',
    summary: baseSummary('corpus-b-hitl', 'Waiting for human intervention', 'waiting_for_human', 4),
    explanation: baseExplanation('corpus-b-hitl', 4, 'waiting'),
  },
  {
    id: 'corpus-c-sparse-conflict',
    label: 'Corpus C - Sparse/conflict-heavy',
    summary: baseSummary('corpus-c-sparse-conflict', 'Execution failed', 'failed', 3),
    explanation: baseExplanation('corpus-c-sparse-conflict', 3, 'failed'),
  },
];

export const runtimeStoryFixtureById = new Map(runtimeStoryFixtures.map((entry) => [entry.id, entry]));
