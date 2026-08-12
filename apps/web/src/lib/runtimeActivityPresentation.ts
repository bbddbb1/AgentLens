import type { RuntimeExplanationActivity } from '@agentlens/protocol';

export interface RuntimeActivityInspectorView {
  id: string;
  title: string;
  kind: string;
  lifecycle: string;
  outcome: string;
  invocationId?: string;
  sourceSpanId?: string;
  evidenceRefs: RuntimeActivityEvidenceRefView[];
  lifecycleProvenance?: RuntimeActivityFieldProvenanceView;
  outcomeProvenance?: RuntimeActivityFieldProvenanceView;
  limitation?: string;
}

export interface RuntimeActivityFieldProvenanceView {
  basis: string;
  condition: string;
  evidenceRefs: RuntimeActivityEvidenceRefView[];
}

export interface RuntimeActivityEvidenceRefView {
  eventId: string;
  sequenceNum: number;
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
    evidenceRefs: activity.evidence_refs.map((reference) => ({
      eventId: reference.event_id,
      sequenceNum: reference.sequence_num,
    })),
    lifecycleProvenance: activity.semantic_provenance?.lifecycle && {
      basis: activity.semantic_provenance.lifecycle.basis,
      condition: activity.semantic_provenance.lifecycle.condition,
      evidenceRefs: activity.semantic_provenance.lifecycle.evidence_refs.map((reference) => ({
        eventId: reference.event_id,
        sequenceNum: reference.sequence_num,
      })),
    },
    outcomeProvenance: activity.semantic_provenance?.outcome && {
      basis: activity.semantic_provenance.outcome.basis,
      condition: activity.semantic_provenance.outcome.condition,
      evidenceRefs: activity.semantic_provenance.outcome.evidence_refs.map((reference) => ({
        eventId: reference.event_id,
        sequenceNum: reference.sequence_num,
      })),
    },
    limitation: activity.story_critical_limitation,
  };
}
