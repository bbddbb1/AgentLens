import { describe, expect, it } from 'vitest';
import { computeVisibleGraph, defaultEdgeVisibility, edgeVisibilityFromPreset, getFocusNeighborhood, groupEdgesForBundling, type GraphVisibilityInput } from '../../src/lib/graphVisibility.js';
import type { GraphEdge, GraphNode } from '@agentlens/protocol';

const nodes: GraphNode[] = [
  {
    id: 'a1',
    type: 'agent',
    label: 'Planner',
    status: 'active',
    position: { x: 0, y: 0 },
  },
  {
    id: 'a2',
    type: 'agent',
    label: 'Researcher',
    status: 'active',
    position: { x: 250, y: 0 },
  },
  {
    id: 't1',
    type: 'tool',
    label: 'search',
    status: 'active',
    position: { x: 125, y: 300 },
  },
];

const edges: GraphEdge[] = [
  {
    id: 'e1',
    type: 'delegation',
    source: 'a1',
    target: 'a2',
    status: 'active',
  },
  { id: 'e2', type: 'uses', source: 'a2', target: 't1', status: 'active' },
  { id: 'e3', type: 'uses', source: 'a2', target: 't1', status: 'completed' },
];

function visibility(overrides: Partial<GraphVisibilityInput> = {}) {
  return computeVisibleGraph({
    nodes,
    edges,
    edgeVisibility: defaultEdgeVisibility(),
    showConnectedOnly: false,
    showActiveOnly: false,
    zoomLevel: 1.5,
    focusModeEnabled: false,
    focusDepth: 1,
    selectedNodeId: null,
    bundleEdges: true,
    ...overrides,
  });
}

describe('graphVisibility', () => {
  it('uses one coherent edge mapping for every primary display preset', () => {
    const orchestration = edgeVisibilityFromPreset('orchestration');
    expect(orchestration.delegation).toBe(true);
    expect(orchestration.member_of).toBe(true);
    expect(orchestration.uses).toBe(false);

    const execution = edgeVisibilityFromPreset('execution');
    expect(execution.dependency).toBe(true);
    expect(execution.uses).toBe(true);
    expect(execution.delegation).toBe(false);

    const data = edgeVisibilityFromPreset('data');
    expect(data.data_flow).toBe(true);
    expect(data.produces).toBe(true);
    expect(data.uses).toBe(false);
  });

  it('does not remove disconnected nodes unless connected-only is explicit', () => {
    const result = visibility({
      edgeVisibility: edgeVisibilityFromPreset('orchestration'),
    });
    expect(result.nodes.map((node) => node.id)).toEqual(['a1', 'a2', 't1']);
    expect(result.edges.map((edge) => edge.id)).toEqual(['e1']);
  });

  it('reports raw visible edges truthfully while retaining bundle member ids', () => {
    const result = visibility();
    expect(result.visibleEdgeCount).toBe(3);
    expect(result.renderedEdgeCount).toBe(2);
    expect(result.totalEdgeCount).toBe(3);
    const bundle = result.edges.find((edge) => edge.metadata?.bundled === true);
    expect(bundle?.metadata?.bundleCount).toBe(2);
    expect(bundle?.metadata?.bundledEdgeIds).toEqual(['e2', 'e3']);
  });

  it('bundles only exact directed source, target, and type tuples', () => {
    const ambiguousIds: GraphEdge[] = [
      { id: 'one', type: 'uses', source: 'a:b', target: 'c', status: 'active' },
      { id: 'two', type: 'uses', source: 'a', target: 'b:c', status: 'active' },
    ];
    expect(groupEdgesForBundling(ambiguousIds)).toHaveLength(2);
  });

  it('hides satellite nodes at overview zoom and discloses recorded context', () => {
    const result = visibility({ zoomLevel: 0.3 });
    expect(result.nodes.every((node) => node.type === 'agent')).toBe(true);
    expect(result.edges.every((edge) => edge.type === 'delegation')).toBe(true);
    expect(result.hiddenContext?.reasons).toContain('overview_zoom');
  });

  it('keeps sparse recorded nodes accessible when zoom taxonomy matches none', () => {
    const sparseNodes: GraphNode[] = [
      {
        id: 'tool-only',
        type: 'tool',
        label: 'lookup',
        status: 'completed',
        position: { x: 0, y: 0 },
      },
    ];
    const result = visibility({
      nodes: sparseNodes,
      edges: [],
      zoomLevel: 0.3,
    });
    expect(result.nodes.map((node) => node.id)).toEqual(['tool-only']);
  });

  it('keeps the selected detail node visible through semantic zoom and focus', () => {
    const result = visibility({
      zoomLevel: 0.3,
      selectedNodeId: 't1',
      focusModeEnabled: true,
    });

    expect(result.nodes.map((node) => node.id)).toEqual(['t1']);
    expect(result.hiddenContext?.reasons).toContain('overview_zoom');
  });

  it('discloses edge, active, and connected-node filtering reasons', () => {
    const result = visibility({
      edgeVisibility: edgeVisibilityFromPreset('orchestration'),
      showActiveOnly: true,
      showConnectedOnly: true,
    });
    expect(result.nodes.map((node) => node.id)).toEqual(['a1', 'a2']);
    expect(result.hiddenContext?.reasons).toContain('edge_filter');
    expect(result.hiddenContext?.reasons).toContain('connected_only');

    const active = visibility({ showActiveOnly: true });
    expect(active.hiddenContext?.reasons).toContain('active_filter');
  });

  it('supports one- and two-hop focus without changing recorded topology', () => {
    const chainNodes: GraphNode[] = ['a', 'b', 'c', 'd'].map((id, index) => ({
      id,
      type: 'agent',
      label: id,
      status: 'active',
      position: { x: index * 100, y: 0 },
    }));
    const chainEdges: GraphEdge[] = [
      {
        id: 'ab',
        type: 'dependency',
        source: 'a',
        target: 'b',
        status: 'active',
      },
      {
        id: 'bc',
        type: 'dependency',
        source: 'b',
        target: 'c',
        status: 'active',
      },
      {
        id: 'cd',
        type: 'dependency',
        source: 'c',
        target: 'd',
        status: 'active',
      },
    ];

    const oneHop = visibility({
      nodes: chainNodes,
      edges: chainEdges,
      selectedNodeId: 'b',
      focusModeEnabled: true,
      focusDepth: 1,
    });
    expect(oneHop.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(oneHop.hiddenContext?.reasons).toContain('focus_mode');

    const twoHop = visibility({
      nodes: chainNodes,
      edges: chainEdges,
      selectedNodeId: 'b',
      focusModeEnabled: true,
      focusDepth: 2,
    });
    expect(twoHop.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(getFocusNeighborhood('b', chainEdges, 2)).toEqual(new Set(['b', 'a', 'c', 'd']));
  });

  it('keeps hidden recorded context distinct from missing relationship evidence', () => {
    const result = visibility({
      nodes: [
        {
          id: 'solo',
          type: 'agent',
          label: 'Solo',
          status: 'active',
          position: { x: 0, y: 0 },
        },
        {
          id: 'tool',
          type: 'tool',
          label: 'Lookup',
          status: 'completed',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [],
      zoomLevel: 1,
      selectedNodeId: 'solo',
    });
    expect(result.hiddenContext).toMatchObject({
      kind: 'hidden_recorded_context',
    });
    expect(result.relationshipContext).toMatchObject({
      kind: 'missing_relationship_evidence',
    });
  });
});
