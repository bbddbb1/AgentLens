import { describe, expect, it } from 'vitest';
import type {
  GraphEdge,
  RuntimeExplanationProjection,
} from '@agentlens/protocol';
import { deriveRelationships } from '@/lib/rops/provenance';
import { runtimeRelationshipViews } from '@/lib/runtimeRelationshipPresentation';

const ref = {
  event_id: 'relationship-evidence',
  sequence_num: 4,
  timestamp: '2026-07-01T00:00:04.000Z',
  branch_id: 'main',
};

function explanation(
  basis: RuntimeExplanationProjection['relations'][number]['basis'],
): RuntimeExplanationProjection {
  return {
    mission_id: 'm1',
    branch_id: 'main',
    as_of_sequence_num: 4,
    projection_version: 'runtime_explanation.v1',
    run_outcome: 'active',
    activities: [
      {
        id: 'source', kind: 'workflow', title: 'Source', action: 'Workflow advanced',
        status: 'active', evidence_refs: [ref],
      },
      {
        id: 'target', kind: 'tool', title: 'Target', action: 'Tool called',
        status: 'active', evidence_refs: [ref],
      },
    ],
    relations: [{
      id: `${basis}:source->target`,
      source_activity_id: 'source',
      target_activity_id: 'target',
      basis,
      evidence_refs: [ref],
    }],
    parallel_groups: [],
    merge_groups: [],
    consistency_flags: [],
  };
}

describe('runtime relation presentation', () => {
  it.each([
    ['trigger_reference', 'Triggered by', 'Triggered'],
    ['decision_reference', 'Decision for', 'Recorded decision'],
    ['parent_span', 'Parent span', 'Child span'],
    ['explicit_link', 'Recorded link from', 'Recorded link to'],
  ] as const)('bounds %s wording to its recorded basis', (basis, incoming, outgoing) => {
    const projection = explanation(basis);
    const target = runtimeRelationshipViews(projection, 'target');
    const source = runtimeRelationshipViews(projection, 'source');

    expect(target).toEqual([
      expect.objectContaining({ label: incoming, relatedActivityId: 'source', evidenceRefs: [ref] }),
    ]);
    expect(source).toEqual([
      expect.objectContaining({ label: outgoing, relatedActivityId: 'target', evidenceRefs: [ref] }),
    ]);
  });

  it('keeps unresolved references neutral and evidence-linked', () => {
    const projection = explanation('trigger_reference');
    projection.relations = [];
    projection.consistency_flags = [{
      code: 'dangling_trigger_reference',
      severity: 'warning',
      message: 'Recorded trigger reference could not be resolved at this frame.',
      activity_id: 'target',
      evidence_refs: [ref],
    }];

    expect(runtimeRelationshipViews(projection, 'target')).toEqual([
      expect.objectContaining({
        label: 'Unresolved trigger reference',
        evidenceRefs: [ref],
      }),
    ]);
  });
});

describe('graph relationship presentation', () => {
  it('keeps a generic dependency generic in both directions', () => {
    const edges: GraphEdge[] = [{
      id: 'dependency', source: 'a', target: 'b', type: 'dependency', status: 'completed',
    }];

    expect(deriveRelationships('a', edges)).toEqual([
      expect.objectContaining({ label: 'Dependency', nodeIds: ['b'] }),
    ]);
    expect(deriveRelationships('b', edges)).toEqual([
      expect.objectContaining({ label: 'Dependency from', nodeIds: ['a'] }),
    ]);
    const wording = [...deriveRelationships('a', edges), ...deriveRelationships('b', edges)]
      .map((relationship) => relationship.label).join(' ');
    expect(wording).not.toMatch(/Called|Next|Triggered/);
  });

  it('presents parent-span metadata structurally', () => {
    const edges: GraphEdge[] = [{
      id: 'parent', source: 'a', target: 'b', type: 'dependency', status: 'completed',
      metadata: { relationship_basis: 'parent_span' },
    }];

    expect(deriveRelationships('a', edges)[0]?.label).toBe('Child span');
    expect(deriveRelationships('b', edges)[0]?.label).toBe('Parent span');
  });

  it('uses handoff wording only for an explicit handoff edge', () => {
    const explicitHandoff: GraphEdge[] = [{
      id: 'handoff', source: 'a', target: 'b', type: 'delegation', status: 'completed',
      metadata: { relationship_basis: 'explicit_handoff' },
    }];
    const similarTopology: GraphEdge[] = [{
      id: 'dependency', source: 'a', target: 'b', type: 'dependency', status: 'completed',
    }];

    expect(deriveRelationships('a', explicitHandoff)[0]?.label).toBe('Handed off to');
    expect(deriveRelationships('b', explicitHandoff)[0]?.label).toBe('Handoff from');
    expect(deriveRelationships('a', similarTopology)[0]?.label).toBe('Dependency');
  });
});
