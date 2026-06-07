import { describe, expect, it } from 'vitest';
import {
  computeVisibleGraph,
  defaultEdgeVisibility,
  edgeVisibilityFromPreset,
  getFocusNeighborhood,
  groupEdgesForBundling,
} from '../../src/lib/graphVisibility.js';
import type { GraphEdge, GraphNode } from '@agentlens/protocol';

const nodes: GraphNode[] = [
  { id: 'a1', type: 'agent', label: 'Planner', status: 'active', position: { x: 0, y: 0 } },
  { id: 'a2', type: 'agent', label: 'Researcher', status: 'active', position: { x: 250, y: 0 } },
  { id: 't1', type: 'tool', label: 'search', status: 'active', position: { x: 125, y: 300 } },
];

const edges: GraphEdge[] = [
  { id: 'e1', type: 'delegation', source: 'a1', target: 'a2', status: 'active' },
  { id: 'e2', type: 'uses', source: 'a2', target: 't1', status: 'active' },
  { id: 'e3', type: 'uses', source: 'a2', target: 't1', status: 'completed' },
];

describe('graphVisibility', () => {
  it('filters to orchestration preset', () => {
    const visibility = edgeVisibilityFromPreset('orchestration');
    expect(visibility.delegation).toBe(true);
    expect(visibility.uses).toBe(false);
  });

  it('bundles parallel edges between the same nodes', () => {
    const groups = groupEdgesForBundling(edges.filter((edge) => edge.type === 'uses'));
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('hides satellite nodes at overview zoom', () => {
    const result = computeVisibleGraph({
      nodes,
      edges,
      edgeVisibility: defaultEdgeVisibility(),
      tracePreset: 'none',
      showActiveOnly: false,
      zoomLevel: 0.3,
      focusModeEnabled: false,
      focusDepth: 1,
      selectedNodeId: null,
      highlightedEdgeId: null,
      bundleEdges: true,
      disableParticles: false,
    });

    expect(result.nodes.every((node) => node.type === 'agent')).toBe(true);
    expect(result.edges.every((edge) => edge.type === 'delegation')).toBe(true);
  });

  it('computes focus neighborhood', () => {
    const neighborhood = getFocusNeighborhood('a1', edges, 1);
    expect(neighborhood.has('a1')).toBe(true);
    expect(neighborhood.has('a2')).toBe(true);
    expect(neighborhood.has('t1')).toBe(false);
  });
});
