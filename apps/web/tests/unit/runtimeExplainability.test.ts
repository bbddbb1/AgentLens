import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import type { GraphNode } from '@agentlens/protocol';
import { authoritativeRuntimePhase, authoritativeRuntimeStatus, selectedFrameAuthority } from '@/lib/runtimeAuthority';
import { computeVisibleGraph, defaultEdgeVisibility } from '@/lib/graphVisibility';
import {
  deriveRelationships,
  packEvidence,
  resolveRelationshipTargets,
} from '@/lib/rops/provenance';
import {
  MissingFieldsProvider,
  RopsFieldRow,
} from '@/components/rops/primitives';

describe('progressive missing-field disclosure', () => {
  it('hides absent optional rows by default', () => {
    const html = renderToString(createElement(
      MissingFieldsProvider,
      { showMissing: false },
      createElement(RopsFieldRow, {
        label: 'optional_model',
        field: packEvidence('optional_model', undefined),
      }),
      createElement(RopsFieldRow, {
        label: 'tool_name',
        field: packEvidence('tool_name', 'grep'),
      }),
    ));
    expect(html).toContain('tool_name');
    expect(html).not.toContain('optional_model');
    expect(html).not.toContain('not recorded');
  });

  it('shows genuinely absent fields only when requested', () => {
    const html = renderToString(createElement(
      MissingFieldsProvider,
      { showMissing: true },
      createElement(RopsFieldRow, {
        label: 'optional_model',
        field: packEvidence('optional_model', undefined),
      }),
    ));
    expect(html).toContain('optional_model');
    expect(html).toContain('not recorded');
  });
});
describe('readable causal relationships', () => {
  it('resolves raw ids to activity labels, types, and statuses', () => {
    const nodes: GraphNode[] = [
      {
        id: 'parent-id',
        type: 'agent',
        label: 'Agent · planner',
        status: 'completed',
        position: { x: 0, y: 0 },
      },
      {
        id: 'tool-id',
        type: 'tool',
        label: 'Tool · grep',
        status: 'failed',
        position: { x: 0, y: 0 },
      },
    ];
    const relationships = deriveRelationships('tool-id', [
      {
        id: 'edge-1',
        source: 'parent-id',
        target: 'tool-id',
        type: 'dependency',
        status: 'failed',
      },
    ]);
    const parent = relationships.find((relationship) => relationship.kind === 'parent');
    expect(parent).toBeDefined();
    expect(resolveRelationshipTargets(parent!.nodeIds, nodes)).toEqual([
      {
        id: 'parent-id',
        label: 'Agent · planner',
        type: 'agent',
        status: 'completed',
        resolved: true,
      },
    ]);
  });

  it('keeps unresolved ids honest for the Evidence layer', () => {
    expect(resolveRelationshipTargets(['opaque-id'], [])).toEqual([
      {
        id: 'opaque-id',
        label: 'opaque-id',
        type: undefined,
        status: undefined,
        resolved: false,
      },
    ]);
  });
});

describe('selected-frame authority helpers', () => {
  it('prefer selected-frame runtime summary authority over missing snapshot fields', () => {
    expect(authoritativeRuntimeStatus({
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 7,
      generated_at: '2026-06-29T00:00:07.000Z',
      objective: 'Investigate',
      status: 'completed',
      phase: 'executing',
      current_phase: {
        id: 'derived:Converging:7',
        label: 'Converging',
        basis: 'derived',
        evidence_refs: [],
      },
      headline: 'Execution completed',
      progress: [],
      observations: [],
      decisions: [],
      evidence: [],
      actions: [],
      pending_work: [],
      warnings: [],
      artifacts: [],
      interrupts: [],
      agents: [],
      is_blocked: false,
      requires_human: false,
      source: 'deterministic',
    })).toBe('Completed');
    expect(authoritativeRuntimePhase({
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 7,
      generated_at: '2026-06-29T00:00:07.000Z',
      objective: 'Investigate',
      status: 'completed',
      phase: 'executing',
      current_phase: {
        id: 'derived:Converging:7',
        label: 'Converging',
        basis: 'derived',
        evidence_refs: [],
      },
      headline: 'Execution completed',
      progress: [],
      observations: [],
      decisions: [],
      evidence: [],
      actions: [],
      pending_work: [],
      warnings: [],
      artifacts: [],
      interrupts: [],
      agents: [],
      is_blocked: false,
      requires_human: false,
      source: 'deterministic',
    })).toEqual({ label: 'Converging', basis: 'Derived' });
  });

  it('disclose missing authority instead of falling back to other runtime state', () => {
    expect(authoritativeRuntimeStatus(null)).toBeNull();
    expect(authoritativeRuntimePhase(null)).toBeNull();
  });

  it('report same-frame authority incompatibilities explicitly', () => {
    expect(selectedFrameAuthority({
      mission_id: 'm1',
      branch_id: 'main',
      sequence_num: 7,
      generated_at: '2026-06-29T00:00:07.000Z',
      objective: 'Investigate',
      status: 'active',
      phase: 'executing',
      current_phase: {
        id: 'recorded:completed:7',
        label: 'Completed',
        basis: 'recorded',
        evidence_refs: [],
      },
      headline: 'Execution completed',
      progress: [],
      observations: [],
      decisions: [],
      evidence: [],
      actions: [],
      pending_work: [],
      warnings: [],
      artifacts: [],
      interrupts: [],
      agents: [],
      is_blocked: false,
      requires_human: false,
      source: 'deterministic',
    }, {
      status: 'active',
      outcome: 'Completed',
    })).toEqual({
      status: 'Active',
      phase: { label: 'Completed', basis: 'Recorded' },
      incompatibilities: [
        'frame phase Completed conflicts with runtime status Active',
        'selected activity outcome Completed conflicts with lifecycle status active',
      ],
    });
  });
});

describe('graph hidden-context disclosure', () => {
  it('distinguishes hidden recorded context from missing relationship evidence', () => {
    const result = computeVisibleGraph({
      nodes: [
        { id: 'a1', type: 'agent', label: 'Planner', status: 'active', position: { x: 0, y: 0 } },
        { id: 't1', type: 'tool', label: 'Search', status: 'completed', position: { x: 200, y: 0 } },
      ],
      edges: [
        { id: 'e1', type: 'dependency', source: 'a1', target: 't1', status: 'completed' },
      ],
      edgeVisibility: defaultEdgeVisibility(),
      showConnectedOnly: false,
      showActiveOnly: false,
      zoomLevel: 0.3,
      focusModeEnabled: false,
      focusDepth: 1,
      selectedNodeId: null,
      bundleEdges: true,
    });

    expect(result.hiddenContext).toMatchObject({
      kind: 'hidden_recorded_context',
    });
    expect(result.hiddenContext?.reasons).toContain('overview_zoom');

    const missing = computeVisibleGraph({
      nodes: [
        { id: 'solo', type: 'agent', label: 'Solo', status: 'active', position: { x: 0, y: 0 } },
      ],
      edges: [],
      edgeVisibility: defaultEdgeVisibility(),
      showConnectedOnly: false,
      showActiveOnly: false,
      zoomLevel: 1,
      focusModeEnabled: true,
      focusDepth: 1,
      selectedNodeId: 'solo',
      bundleEdges: true,
    });

    expect(missing.relationshipContext).toMatchObject({
      kind: 'missing_relationship_evidence',
    });
  });
});
