import type {
  MissionAggregate,
  RuntimeExplanationEvidenceRef,
  RuntimeExplanationProjection,
  RuntimeFrame,
  SemanticSummaryResult,
} from '@agentlens/protocol';

/** Internal cache discriminator; not a public RuntimeExplanation protocol version. */
export const SEMANTIC_PRESENTATION_AUTHORITY_VERSION = 'causal_bounded.v1';

function dedupeEvidenceRefs(
  refs: RuntimeExplanationEvidenceRef[],
): RuntimeExplanationEvidenceRef[] {
  const deduped = new Map<string, RuntimeExplanationEvidenceRef>();
  for (const ref of refs) {
    deduped.set(`${ref.branch_id ?? ''}:${ref.sequence_num}:${ref.event_id}`, ref);
  }
  return [...deduped.values()];
}

function countBy<T extends string>(values: T[]): Array<[T, number]> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function formatCounts(counts: Array<[string, number]>): string {
  return counts.map(([label, count]) => `${count} ${label}`).join(', ');
}

function explanationFrame(explanation: RuntimeExplanationProjection): RuntimeFrame {
  return explanation.frame ?? {
    mission_id: explanation.mission_id,
    branch_id: explanation.branch_id,
    sequence_num: explanation.as_of_sequence_num,
    as_of_timestamp: explanation.as_of_timestamp ?? new Date(0).toISOString(),
    projection_version: explanation.projection_version,
  };
}

export interface WhyThisStateContext {
  explanation: RuntimeExplanationProjection;
}

/**
 * L2 presentation over one exact canonical explanation frame. It deliberately
 * summarizes counts and recorded relationship bases without inferring hidden
 * causes, blocking dependencies, planned next steps, or business meaning.
 */
export async function generateWhyThisState(
  ctx: WhyThisStateContext,
): Promise<SemanticSummaryResult> {
  const { explanation } = ctx;
  const frame = explanationFrame(explanation);
  const status = explanation.run_status ?? explanation.run_outcome;
  const phase = explanation.runtime_phase?.label ?? 'Unknown';
  const parts = [
    `At frame ${frame.sequence_num}, RuntimeExplanation reports run status ${status} and runtime phase ${phase}.`,
  ];

  if (explanation.activities.length === 0) {
    parts.push('No runtime activities are observable at this frame.');
  } else {
    parts.push(
      `The frame contains ${explanation.activities.length} runtime activities (${formatCounts(countBy(explanation.activities.map((activity) => activity.status)))}).`,
    );
  }

  const relationCounts = countBy(explanation.relations.map((relation) => relation.basis));
  if (relationCounts.length > 0) {
    const labels: Record<string, string> = {
      trigger_reference: 'explicit trigger reference',
      decision_reference: 'decision reference',
      parent_span: 'structural parent-span relationship',
      explicit_link: 'recorded explicit link',
    };
    parts.push(`Relationship evidence includes ${relationCounts
      .map(([basis, count]) => `${count} ${labels[basis] ?? 'recorded relationship'}${count === 1 ? '' : 's'}`)
      .join(', ')}.`);
  }

  const unresolved = explanation.consistency_flags.filter((flag) =>
    flag.code === 'dangling_trigger_reference'
    || flag.code === 'dangling_decision_reference'
    || flag.code === 'dangling_parent_span');
  if (unresolved.length > 0) {
    parts.push(`${unresolved.length} relationship reference${unresolved.length === 1 ? ' is' : 's are'} unresolved at this frame.`);
  }

  const consistencyRecords = explanation.consistency_flags.map((flag) => ({
    code: flag.code,
    severity: flag.severity,
    message: flag.message,
    activity_id: flag.activity_id,
    relation_id: flag.relation_id,
    evidence_refs: flag.evidence_refs,
  }));
  const evidence_refs = dedupeEvidenceRefs([
    ...(explanation.run_outcome_provenance?.evidence_refs ?? []),
    ...(explanation.runtime_phase?.evidence_refs ?? []),
    ...explanation.activities.flatMap((activity) => activity.evidence_refs),
    ...explanation.relations.flatMap((relation) => relation.evidence_refs),
    ...explanation.consistency_flags.flatMap((flag) => flag.evidence_refs),
  ]);

  return {
    summary: parts.join(' '),
    conflicts: consistencyRecords.filter((record) => record.severity === 'error'),
    anomalies: consistencyRecords.filter((record) => record.severity !== 'error'),
    frame,
    evidence_refs,
  };
}

/**
 * Legacy mission summary is retained as neutral L2 snapshot presentation. It
 * reports recorded container, node, and edge states without causal diagnosis.
 */
export async function generateMissionSummary(
  missionData: MissionAggregate,
): Promise<SemanticSummaryResult> {
  const latest = missionData.snapshots[missionData.snapshots.length - 1];
  if (!latest) {
    return {
      summary: `Mission container status is ${missionData.mission.status}; no execution snapshot is recorded.`,
      conflicts: [],
      anomalies: [],
    };
  }

  const nodeCounts = countBy(latest.nodes.map((node) => node.status));
  const edgeCounts = countBy(latest.edges.map((edge) => edge.type));
  const parts = [
    `Latest recorded graph snapshot is frame ${latest.sequence_num}.`,
    latest.nodes.length > 0
      ? `Recorded node states: ${formatCounts(nodeCounts)}.`
      : 'No graph nodes are recorded in that snapshot.',
    latest.edges.length > 0
      ? `Recorded graph relationships: ${formatCounts(edgeCounts)}.`
      : 'No graph relationships are recorded in that snapshot.',
  ];

  return {
    summary: parts.join(' '),
    conflicts: [],
    anomalies: [],
  };
}
