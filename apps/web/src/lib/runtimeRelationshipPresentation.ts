import type {
  RuntimeExplanationEvidenceRef,
  RuntimeExplanationProjection,
  RuntimeExplanationRelationBasis,
} from '@agentlens/protocol';

export interface RuntimeRelationshipView {
  id: string;
  label: string;
  basis: RuntimeExplanationRelationBasis | 'unresolved';
  direction: 'incoming' | 'outgoing' | 'unresolved';
  relatedActivityId?: string;
  relatedTitle?: string;
  evidenceRefs: RuntimeExplanationEvidenceRef[];
}

function relationshipLabel(
  basis: RuntimeExplanationRelationBasis,
  direction: 'incoming' | 'outgoing',
): string {
  const labels: Record<RuntimeExplanationRelationBasis, { incoming: string; outgoing: string }> = {
    trigger_reference: { incoming: 'Triggered by', outgoing: 'Triggered' },
    decision_reference: { incoming: 'Decision for', outgoing: 'Recorded decision' },
    parent_span: { incoming: 'Parent span', outgoing: 'Child span' },
    explicit_link: { incoming: 'Recorded link from', outgoing: 'Recorded link to' },
  };
  return labels[basis][direction];
}

function unresolvedLabel(code: string): string | undefined {
  switch (code) {
    case 'dangling_trigger_reference':
      return 'Unresolved trigger reference';
    case 'dangling_decision_reference':
      return 'Unresolved decision reference';
    case 'dangling_parent_span':
      return 'Unresolved parent span';
    default:
      return undefined;
  }
}

export function runtimeRelationshipViews(
  explanation: RuntimeExplanationProjection,
  activityId: string,
): RuntimeRelationshipView[] {
  const activities = new Map(explanation.activities.map((activity) => [activity.id, activity]));
  const resolved = explanation.relations.flatMap((relation): RuntimeRelationshipView[] => {
    const direction = relation.target_activity_id === activityId
      ? 'incoming'
      : relation.source_activity_id === activityId
        ? 'outgoing'
        : undefined;
    if (!direction) return [];
    const relatedActivityId = direction === 'incoming'
      ? relation.source_activity_id
      : relation.target_activity_id;
    return [{
      id: relation.id,
      label: relationshipLabel(relation.basis, direction),
      basis: relation.basis,
      direction,
      relatedActivityId,
      relatedTitle: activities.get(relatedActivityId)?.title,
      evidenceRefs: relation.evidence_refs,
    }];
  });
  const unresolved = explanation.consistency_flags.flatMap((flag): RuntimeRelationshipView[] => {
    if (flag.activity_id !== activityId) return [];
    const label = unresolvedLabel(flag.code);
    if (!label) return [];
    return [{
      id: `unresolved:${flag.code}:${activityId}`,
      label,
      basis: 'unresolved',
      direction: 'unresolved',
      evidenceRefs: flag.evidence_refs,
    }];
  });
  return [...resolved, ...unresolved].sort((left, right) => left.id.localeCompare(right.id));
}
