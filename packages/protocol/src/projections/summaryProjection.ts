import type {
  EventEnvelope,
  MissionEventRecord,
  ProjectRuntimeSummaryInput,
  RuntimeActivity,
  RuntimeExplanationProjection,
  RuntimePhaseLabel,
  RuntimePhaseSummary,
  RuntimeSummary,
  RuntimeSummaryAction,
  RuntimeSummaryArtifact,
  RuntimeSummaryDecision,
  RuntimeSummaryEvidence,
  RuntimeSummaryInterrupt,
  RuntimeSummaryObservation,
  RuntimeSummaryPendingWork,
  RuntimeSummaryProgressEntry,
  RuntimeSummaryWarning,
} from '../types.js';
import { eventsThroughCursor } from './runtimeProjection.js';
import { projectAllNodeStates } from './nodeStateProjection.js';
import { projectRuntimeExplanation } from './explanationProjection.js';
import { payloadString } from './projectionScratch.js';

const CONCISE_STORY_LIMIT = 5;

type RuntimePhaseBasis = 'recorded' | 'derived' | 'unknown';

function phaseLabelFromMissionPhase(phase: string | undefined): RuntimePhaseLabel {
  switch (phase) {
    case 'planning':
      return 'Queued';
    case 'executing':
      return 'Active Work';
    case 'reviewing':
      return 'Converging';
    case 'waiting_for_human':
      return 'Waiting';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Unknown';
  }
}

function buildEvidenceRef(event: MissionEventRecord) {
  return {
    event_id: event.id,
    sequence_num: event.sequence_num,
    timestamp: event.timestamp,
    branch_id: event.branch_id,
    span_id: event.span_id,
    source_event_id: event.source_event_id,
  };
}

function buildPhaseSummary(
  label: RuntimePhaseLabel,
  basis: RuntimePhaseBasis,
  event: MissionEventRecord,
): RuntimePhaseSummary {
  return {
    id: `${basis}:${label}:${event.sequence_num}`,
    label,
    basis,
    start_sequence_num: event.sequence_num,
    end_sequence_num: event.sequence_num,
    evidence_refs: [buildEvidenceRef(event)],
  };
}

function collectPhaseHistory(events: readonly MissionEventRecord[]): RuntimePhaseSummary[] {
  const phases: RuntimePhaseSummary[] = [];

  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const phaseValue =
      event.event_type === 'mission.phase_changed' ||
      (event.event_type === 'mission.updated' && payload.phase !== undefined)
        ? payloadString(payload, 'phase') ?? payloadString(payload, 'status')
        : undefined;
    if (!phaseValue) continue;

    const normalizedPhase = phaseLabelFromMissionPhase(phaseValue);
    const last = phases[phases.length - 1];
    if (last && last.label === normalizedPhase) {
      last.end_sequence_num = event.sequence_num;
      last.evidence_refs.push(buildEvidenceRef(event));
      continue;
    }

    phases.push(buildPhaseSummary(normalizedPhase, 'recorded', event));
  }

  return phases;
}

function buildCurrentPhase(
  inputPhase: string,
  events: readonly MissionEventRecord[],
  asOfSequenceNum: number,
  asOfTimestamp: string,
): RuntimePhaseSummary {
  const phaseHistory = collectPhaseHistory(events);
  const lastExplicit = phaseHistory[phaseHistory.length - 1];
  if (lastExplicit) return lastExplicit;

  const derivedLabel = phaseLabelFromMissionPhase(inputPhase);
  const basis: RuntimePhaseBasis = inputPhase ? 'derived' : 'unknown';
  return {
    id: `${basis}:${derivedLabel}:${asOfSequenceNum}`,
    label: derivedLabel,
    basis,
    start_sequence_num: asOfSequenceNum,
    end_sequence_num: asOfSequenceNum,
    evidence_refs:
      basis === 'unknown'
        ? []
        : [
            {
              event_id: `frame:${asOfSequenceNum}`,
              sequence_num: asOfSequenceNum,
              timestamp: asOfTimestamp,
              branch_id: 'main',
            },
          ],
  };
}

function compareStoryActivities(left: RuntimeActivity, right: RuntimeActivity): number {
  const priority = (activity: RuntimeActivity): number => {
    if (activity.status === 'failed') return 0;
    if (activity.status === 'waiting') return 1;
    if (activity.kind === 'human') return 2;
    if (activity.kind === 'artifact') return 3;
    if ((activity.duration_ms ?? 0) > 0) return 4;
    return 5;
  };

  const leftPriority = priority(left);
  const rightPriority = priority(right);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;

  const leftDuration = left.duration_ms;
  const rightDuration = right.duration_ms;
  const leftKnown = typeof leftDuration === 'number' && Number.isFinite(leftDuration);
  const rightKnown = typeof rightDuration === 'number' && Number.isFinite(rightDuration);
  if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
  if (leftKnown && rightKnown && leftDuration !== rightDuration) {
    return rightDuration - leftDuration;
  }

  const leftSeq = left.sequence_num ?? Number.POSITIVE_INFINITY;
  const rightSeq = right.sequence_num ?? Number.POSITIVE_INFINITY;
  if (leftSeq !== rightSeq) return leftSeq - rightSeq;

  return left.id.localeCompare(right.id);
}

function buildStoryActivities(activities: RuntimeActivity[]): RuntimeActivity[] {
  return [...activities].sort(compareStoryActivities).slice(0, CONCISE_STORY_LIMIT);
}

function toCompatibilityActivity(activity: import('../types.js').RuntimeExplanationActivity): RuntimeActivity {
  return {
    id: activity.id,
    kind: activity.kind,
    label: activity.title,
    title: activity.title,
    subtitle: activity.subtitle,
    action: activity.action,
    outcome: activity.outcome ?? 'Unknown',
    status: activity.status === 'waiting' ? 'waiting' : activity.status,
    sequence_num: activity.sequence_num,
    timestamp: activity.started_at ?? activity.ended_at,
    duration_ms: activity.duration_ms,
    actor: activity.actor,
    source_span_id: activity.source_span_id,
    parent_span_id: activity.parent_span_id,
    invocation_id: activity.invocation_id,
    semantic_provenance: activity.semantic_provenance,
    operator_facing_record: activity.operator_facing_record,
    provenance: 'projection',
  };
}

function buildDeterministicNarrative(summary: Omit<RuntimeSummary, 'narrative' | 'source'>): string {
  const lines: string[] = [summary.headline];
  const recentProgress = summary.progress.slice(-5);
  if (recentProgress.length > 0) {
    lines.push(`Activities observed at this frame: ${recentProgress.map((entry) => entry.text).join('; ')}`);
  }
  if (summary.pending_work.length > 0) {
    lines.push(`Pending: ${summary.pending_work[0].text}`);
  }
  return lines.join('. ') + '.';
}

export { getRuntimeNodeProjection, getRuntimeAgentSummary } from './nodeStateProjection.js';

function statusLabel(status: import('../types.js').RuntimeExplanationRunOutcome): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'waiting':
      return 'waiting';
    case 'unknown':
      return 'unknown';
    default:
      return 'active';
  }
}

function progressText(activity: import('../types.js').RuntimeExplanationActivity): string {
  return `${activity.title} | ${activity.action} | ${statusLabel(activity.status)}`;
}

function headlineFromExplanation(
  explanation: import('../types.js').RuntimeExplanationProjection,
): string {
  if (explanation.run_outcome === 'waiting') return 'Waiting for human intervention';
  if (explanation.run_outcome === 'failed') return 'Execution failed';
  if (explanation.run_outcome === 'completed') return 'Execution completed';
  if (explanation.run_outcome === 'unknown') return 'Execution outcome unknown';
  const active = explanation.activities.find((activity) => activity.status === 'active')
    ?? explanation.activities[explanation.activities.length - 1];
  return active ? `${active.title} active` : 'Execution active';
}

function extractStringValue(value: import('../types.js').RuntimeExplanationValue | undefined): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function summaryPendingWork(
  explanation: import('../types.js').RuntimeExplanationProjection,
): RuntimeSummaryPendingWork[] {
  const pending: RuntimeSummaryPendingWork[] = [];
  for (const activity of explanation.activities) {
    if (activity.status === 'waiting') {
      const reason = extractStringValue(activity.inputs?.reason);
      pending.push({
        kind: activity.kind === 'human' ? 'interrupt' : 'waiting',
        text: reason ? `Human decision required: ${reason}` : `${activity.title} waiting`,
      });
    }
    // Failure is reported in warnings. It does not, by itself, establish that
    // another activity or the run is blocked.
  }
  return pending;
}

export function projectRuntimeSummary(input: ProjectRuntimeSummaryInput): RuntimeSummary {
  const explanation = projectRuntimeExplanation({
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    events: input.events as EventEnvelope[],
    as_of_sequence_num: input.up_to_sequence_num,
  });
  return projectRuntimeSummaryFromExplanation(input, explanation);
}

/** Compatibility summary derived from one already-canonical explanation. */
export function projectRuntimeSummaryFromExplanation(
  input: ProjectRuntimeSummaryInput,
  explanation: RuntimeExplanationProjection,
): RuntimeSummary {
  const events = eventsThroughCursor(input.events, input.up_to_sequence_num);

  const progress: RuntimeSummaryProgressEntry[] = explanation.activities.map((activity) => ({
    sequence_num: activity.sequence_num ?? 0,
    timestamp: activity.started_at ?? activity.ended_at ?? explanation.as_of_timestamp ?? new Date(0).toISOString(),
    event_type: activity.kind,
    actor: activity.actor,
    text: progressText(activity),
  }));
  const observations: RuntimeSummaryObservation[] = explanation.consistency_flags
    .filter((flag) => flag.severity === 'info')
    .map((flag) => ({
      text: flag.message,
      sequence_num: flag.evidence_refs[0]?.sequence_num,
    }));
  const decisions: RuntimeSummaryDecision[] = [];
  for (const activity of explanation.activities) {
    if (activity.kind !== 'human') continue;
    const decision = extractStringValue(activity.outputs?.decision);
    if (!decision) continue;
    decisions.push({
      text: `${activity.title} | ${decision}`,
      sequence_num: activity.sequence_num,
      actor: activity.actor,
    });
  }
  const evidence: RuntimeSummaryEvidence[] = explanation.relations.map((relation) => ({
    text: `${relation.basis} | ${relation.source_activity_id} -> ${relation.target_activity_id}`,
    source: relation.basis,
    sequence_num: relation.evidence_refs[0]?.sequence_num,
  }));
  const actions: RuntimeSummaryAction[] = explanation.activities.map((activity) => ({
    text: `${activity.title} | ${activity.action}`,
    sequence_num: activity.sequence_num,
    actor: activity.actor,
    status: activity.status,
  }));
  const warnings: RuntimeSummaryWarning[] = [
    ...explanation.activities
      .filter((activity) => activity.status === 'failed')
      .map((activity) => ({ text: `${activity.title} failed`, severity: 'high' as const })),
    ...explanation.consistency_flags
      .filter((flag) => flag.severity !== 'info')
      .map((flag) => ({
        text: flag.message,
        severity: flag.severity === 'error' ? 'high' as const : 'medium' as const,
      })),
  ];
  const artifacts: RuntimeSummaryArtifact[] = explanation.activities
    .filter((activity) => activity.kind === 'artifact' || (activity.artifacts?.length ?? 0) > 0)
    .map((activity) => ({
      name: activity.title,
      type: activity.kind,
      sequence_num: activity.sequence_num,
    }));
  const interrupts: RuntimeSummaryInterrupt[] = explanation.activities
    .filter((activity) => activity.kind === 'human')
    .map((activity) => ({
      interrupt_id: activity.id.startsWith('human:') ? activity.id.slice('human:'.length) : activity.id,
      status: activity.status === 'completed' ? 'resolved' : 'pending',
      reason: extractStringValue(activity.inputs?.reason),
      agent_id: activity.actor,
    }));

  const pending_work = summaryPendingWork(explanation);
  const requires_human = explanation.run_outcome === 'waiting';
  // No canonical RuntimeExplanation fact currently establishes blocking.
  const is_blocked = false;
  const sequence_num = explanation.as_of_sequence_num;
  const frameTimestamp = explanation.as_of_timestamp ?? events[events.length - 1]?.timestamp ?? new Date(0).toISOString();
  const frame = {
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    sequence_num,
    as_of_timestamp: frameTimestamp,
    projection_version: explanation.projection_version,
  };

  const nodes = projectAllNodeStates({
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    events: input.events,
    up_to_sequence_num: input.up_to_sequence_num,
    phase: input.phase,
  });
  const activities = explanation.activities.map(toCompatibilityActivity);
  const storyActivities = buildStoryActivities(activities);
  const majorPhases = collectPhaseHistory(events);
  const currentPhase = explanation.runtime_phase
    ?? buildCurrentPhase(input.phase, events, sequence_num, frameTimestamp);
  const projectedStatus =
    explanation.run_outcome === 'waiting'
      ? 'waiting'
      : explanation.run_outcome;
  const authoritativePhase = currentPhase;
  const progressMarkers = explanation.progress_markers ?? progress.map((entry) => ({
    sequence_num: entry.sequence_num,
    timestamp: entry.timestamp,
    kind: entry.event_type,
    actor: entry.actor,
    text: entry.text,
  }));

  const base = {
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    sequence_num,
    generated_at: frameTimestamp,
    frame,
    objective: input.objective,
    status: projectedStatus,
    run_status: explanation.run_status,
    run_outcome_provenance: explanation.run_outcome_provenance,
    run_status_provenance: explanation.run_status_provenance,
    phase: authoritativePhase.label,
    current_phase: currentPhase,
    runtime_phase: authoritativePhase,
    major_phases: majorPhases.length > 0 ? majorPhases : [currentPhase],
    headline: headlineFromExplanation(explanation),
    progress,
    progress_markers: progressMarkers,
    activities,
    story_activities: storyActivities,
    selected_activity_id:
      explanation.selected_activity_state?.kind === 'selected'
        ? explanation.selected_activity_state.activity_id
        : undefined,
    selected_activity_state: explanation.selected_activity_state,
    observations,
    decisions,
    evidence,
    actions,
    pending_work,
    warnings,
    artifacts,
    interrupts,
    agents: nodes,
    nodes,
    is_blocked,
    requires_human,
    background_work: {
      collapsed: activities.length > storyActivities.length,
      visible_activity_count: storyActivities.length,
      hidden_activity_count: Math.max(0, activities.length - storyActivities.length),
      total_activity_count: activities.length,
      disclosure:
        activities.length > storyActivities.length
          ? `${activities.length - storyActivities.length} background activities collapsed`
          : 'No background work collapsed',
    },
  };

  return {
    ...base,
    source: 'deterministic',
    narrative: buildDeterministicNarrative(base),
  };
}
