import type { RuntimeExplanationActivity } from '@agentlens/protocol';

export interface RuntimeActivityInspectorView {
  id: string;
  title: string;
  kind: string;
  lifecycle: string;
  outcome: string;
  invocationId?: string;
  sourceSpanId?: string;
  evidenceSequences: number[];
  limitation?: string;
}

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

export function runtimeActivityInspectorView(
  activity: RuntimeExplanationActivity,
): RuntimeActivityInspectorView {
  return {
    id: activity.id,
    title: activity.title,
    kind: activity.kind.replace(/_/g, ' '),
    lifecycle: titleCase(activity.status),
    outcome: activity.outcome ?? 'Unknown',
    invocationId: activity.invocation_id,
    sourceSpanId: activity.source_span_id,
    evidenceSequences: activity.evidence_refs.map((reference) => reference.sequence_num),
    limitation: activity.story_critical_limitation,
  };
}
