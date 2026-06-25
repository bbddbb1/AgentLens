/**
 * Graph store — manages the organizational graph state for React Flow.
 */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

import type { EdgeType, GraphEdge, GraphNode, GraphSnapshot } from '@agentlens/protocol';
export type { GraphEdge, GraphNode, GraphSnapshot } from '@agentlens/protocol';

import {
  applyFocusStyling,
  computeVisibleGraph,
  defaultEdgeVisibility,
  edgeVisibilityFromPreset,
  getZoomBand,
  type EdgeLayerPreset,
  type FocusDepth,
  type TracePreset,
} from '@/lib/graphVisibility';
import { applyClientLayout } from '@/lib/graphLayout';

const PARTICLE_EDGE_THRESHOLD = 40;

interface GraphStore {
  nodes: Node[];
  edges: Edge[];
  baseNodes: GraphNode[];
  baseEdges: GraphEdge[];
  snapshots: GraphSnapshot[];
  currentSnapshotIndex: number;
  selectedNodeId: string | null;
  activeNodeId: string | null;
  hoveredNodeId: string | null;
  highlightedEdgeId: string | null;
  zoomLevel: number;
  zoomBand: 'overview' | 'standard' | 'detail';
  edgeVisibility: Record<EdgeType, boolean>;
  edgeLayerPreset: EdgeLayerPreset;
  tracePreset: TracePreset;
  showActiveOnly: boolean;
  focusModeEnabled: boolean;
  focusDepth: FocusDepth;
  bundleEdges: boolean;
  visibleEdgeCount: number;
  totalEdgeCount: number;
  satelliteCounts: Record<string, { tools: number; memory: number; artifacts: number }>;
  layoutPositions: Record<string, { x: number; y: number }>;

  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSnapshots: (snapshots: GraphSnapshot[]) => void;
  setCurrentSnapshotIndex: (index: number) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveNodeId: (id: string | null) => void;
  setHoveredNodeId: (id: string | null) => void;
  setHighlightedEdgeId: (id: string | null) => void;
  setZoomLevel: (level: number) => void;
  setEdgeLayerPreset: (preset: EdgeLayerPreset) => void;
  setEdgeTypeVisible: (type: EdgeType, visible: boolean) => void;
  setTracePreset: (preset: TracePreset) => void;
  setShowActiveOnly: (value: boolean) => void;
  setFocusModeEnabled: (value: boolean) => void;
  setFocusDepth: (depth: FocusDepth) => void;
  setBundleEdges: (value: boolean) => void;
  toggleFocusMode: () => void;
  setNodeLayoutPosition: (nodeId: string, position: { x: number; y: number }) => void;

  applySnapshot: (snapshot: GraphSnapshot) => void;
  recomputeDisplayGraph: () => void;
}

function mapNodeType(type: string): string {
  const mapping: Record<string, string> = {
    agent: 'agentNode',
    human: 'agentNode',
    task: 'taskNode',
    tool: 'toolNode',
    memory: 'toolNode',
    team: 'agentNode',
    artifact: 'toolNode',
  };
  return mapping[type] || 'default';
}

function mapEdgeStyle(type: string): Partial<Edge> {
  const styles: Record<string, Partial<Edge>> = {
    delegation: { type: 'bundledEdge', style: { stroke: '#818cf8', strokeWidth: 2 } },
    critique: { type: 'bundledEdge', style: { stroke: '#f87171', strokeWidth: 2, strokeDasharray: '5,5' } },
    review: { type: 'bundledEdge', style: { stroke: '#34d399', strokeWidth: 2 } },
    escalation: { type: 'bundledEdge', style: { stroke: '#fbbf24', strokeWidth: 2.5 }, animated: true },
    dependency: { type: 'bundledEdge', style: { stroke: '#5d6180', strokeWidth: 1.5 } },
    data_flow: { type: 'bundledEdge', style: { stroke: '#60a5fa', strokeWidth: 1.5, strokeDasharray: '3,3' } },
    uses: { type: 'bundledEdge', style: { stroke: '#fbbf24', strokeWidth: 1.5 } },
    approval: { type: 'bundledEdge', style: { stroke: '#34d399', strokeWidth: 2 } },
    produces: { type: 'bundledEdge', style: { stroke: '#fb923c', strokeWidth: 1.75 } },
    member_of: { type: 'bundledEdge', style: { stroke: '#a78bfa', strokeWidth: 1.5, strokeDasharray: '4,4' } },
  };
  return styles[type] || { type: 'bundledEdge', style: { stroke: '#5d6180', strokeWidth: 1 } };
}

function graphNodesToFlowNodes(
  graphNodes: GraphNode[],
  satelliteCounts: Record<string, { tools: number; memory: number; artifacts: number }>,
  layoutPositions: Record<string, { x: number; y: number }>,
): Node[] {
  return graphNodes.map((gn) => ({
    id: gn.id,
    type: mapNodeType(gn.type),
    position: layoutPositions[gn.id] ?? gn.position,
    data: {
      label: gn.label,
      nodeType: gn.type,
      status: gn.status,
      role: gn.agent_role,
      team: gn.agent_team,
      confidence: gn.confidence,
      summary: gn.summary,
      metadata: gn.metadata,
      agentId: gn.agent_id,
      hasPendingInterrupt: false,
      satelliteCounts: satelliteCounts[gn.id],
    },
  }));
}

function graphEdgesToFlowEdges(graphEdges: GraphEdge[], pathOffsetById: Map<string, number>): Edge[] {
  const pairCounts = new Map<string, number>();

  return graphEdges.map((ge) => {
    const pairKey = `${ge.source}:${ge.target}`;
    const offsetIndex = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, offsetIndex + 1);

    return {
      id: ge.id,
      source: ge.source,
      target: ge.target,
      label: ge.label,
      animated: ge.animated,
      ...mapEdgeStyle(ge.type),
      data: {
        edgeType: ge.type,
        status: ge.status,
        metadata: ge.metadata,
        bundled: ge.metadata?.bundled === true,
        bundleCount: ge.metadata?.bundleCount as number | undefined,
        bundledEdgeIds: ge.metadata?.bundledEdgeIds as string[] | undefined,
        pathOffset: pathOffsetById.get(ge.id) ?? offsetIndex * 12,
      },
    };
  });
}

function buildDisplayGraph(state: GraphStore): Pick<
  GraphStore,
  | 'nodes'
  | 'edges'
  | 'visibleEdgeCount'
  | 'totalEdgeCount'
  | 'zoomBand'
  | 'satelliteCounts'
> {
  const visibility = computeVisibleGraph({
    nodes: state.baseNodes,
    edges: state.baseEdges,
    edgeVisibility: state.edgeVisibility,
    tracePreset: state.tracePreset,
    showActiveOnly: state.showActiveOnly,
    zoomLevel: state.zoomLevel,
    focusModeEnabled: state.focusModeEnabled,
    focusDepth: state.focusDepth,
    selectedNodeId: state.selectedNodeId,
    highlightedEdgeId: state.highlightedEdgeId,
    bundleEdges: state.bundleEdges,
    disableParticles: false,
  });

  const pathOffsetById = new Map<string, number>();
  const pairCounts = new Map<string, number>();
  for (const edge of visibility.edges) {
    const pairKey = `${edge.source}:${edge.target}`;
    const offsetIndex = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, offsetIndex + 1);
    pathOffsetById.set(edge.id, offsetIndex * 12);
  }

  const disableParticles = visibility.visibleEdgeCount > PARTICLE_EDGE_THRESHOLD;
  let flowNodes = graphNodesToFlowNodes(
    visibility.nodes,
    visibility.satelliteCounts,
    state.layoutPositions,
  );
  let flowEdges: Edge[] = graphEdgesToFlowEdges(visibility.edges, pathOffsetById).map((edge) => ({
    ...edge,
    data: {
      ...edge.data,
      disableParticles,
    },
  }));

  const styled = applyFocusStyling(
    flowNodes,
    flowEdges,
    state.selectedNodeId,
    state.focusModeEnabled,
    state.focusDepth,
    state.highlightedEdgeId,
  );

  flowNodes = styled.nodes.map((node) => ({
    ...node,
    selected: node.id === state.selectedNodeId,
  }));
  flowEdges = styled.edges as Edge[];

  return {
    nodes: flowNodes,
    edges: flowEdges,
    visibleEdgeCount: visibility.visibleEdgeCount,
    totalEdgeCount: visibility.totalEdgeCount,
    zoomBand: visibility.zoomBand,
    satelliteCounts: visibility.satelliteCounts,
  };
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  baseNodes: [],
  baseEdges: [],
  snapshots: [],
  currentSnapshotIndex: 0,
  selectedNodeId: null,
  activeNodeId: null,
  hoveredNodeId: null,
  highlightedEdgeId: null,
  zoomLevel: 1,
  zoomBand: 'standard',
  edgeVisibility: defaultEdgeVisibility(),
  edgeLayerPreset: 'all',
  tracePreset: 'none',
  showActiveOnly: false,
  focusModeEnabled: true,
  focusDepth: 1,
  bundleEdges: true,
  visibleEdgeCount: 0,
  totalEdgeCount: 0,
  satelliteCounts: {},
  layoutPositions: {},

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setSnapshots: (snapshots) => set({ snapshots }),
  setCurrentSnapshotIndex: (index) => {
    set({ currentSnapshotIndex: index });
    get().recomputeDisplayGraph();
  },
  setSelectedNodeId: (id) => {
    set({ selectedNodeId: id });
    get().recomputeDisplayGraph();
  },
  setActiveNodeId: (id) => set({ activeNodeId: id }),
  setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
  setHighlightedEdgeId: (id) => {
    set({ highlightedEdgeId: id });
    get().recomputeDisplayGraph();
  },
  setZoomLevel: (level) => {
    const state = get();
    const prevBand = getZoomBand(state.zoomLevel);
    const nextBand = getZoomBand(level);
    if (prevBand === nextBand && Math.abs(state.zoomLevel - level) < 0.001) {
      return;
    }
    set({ zoomLevel: level });
    if (prevBand !== nextBand) {
      get().recomputeDisplayGraph();
    }
  },
  setEdgeLayerPreset: (preset) => {
    set({
      edgeLayerPreset: preset,
      edgeVisibility: edgeVisibilityFromPreset(preset),
    });
    get().recomputeDisplayGraph();
  },
  setEdgeTypeVisible: (type, visible) => {
    const next = { ...get().edgeVisibility, [type]: visible };
    set({ edgeVisibility: next, edgeLayerPreset: 'all' });
    get().recomputeDisplayGraph();
  },
  setTracePreset: (preset) => {
    set({ tracePreset: preset });
    get().recomputeDisplayGraph();
  },
  setShowActiveOnly: (value) => {
    set({ showActiveOnly: value });
    get().recomputeDisplayGraph();
  },
  setFocusModeEnabled: (value) => {
    set({ focusModeEnabled: value });
    get().recomputeDisplayGraph();
  },
  setFocusDepth: (depth) => {
    set({ focusDepth: depth });
    get().recomputeDisplayGraph();
  },
  setBundleEdges: (value) => {
    set({ bundleEdges: value });
    get().recomputeDisplayGraph();
  },
  toggleFocusMode: () => {
    set({ focusModeEnabled: !get().focusModeEnabled });
    get().recomputeDisplayGraph();
  },

  setNodeLayoutPosition: (nodeId, position) => {
    const layoutPositions = { ...get().layoutPositions, [nodeId]: position };
    set({ layoutPositions });
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId ? { ...node, position } : node,
      ),
    });
  },

  applySnapshot: (snapshot) => {
    const laidOutNodes = applyClientLayout(snapshot.nodes, snapshot.edges);
    const nodeIds = new Set(laidOutNodes.map((node) => node.id));
    const layoutPositions = Object.fromEntries(
      Object.entries(get().layoutPositions).filter(([id]) => nodeIds.has(id)),
    );

    set({
      baseNodes: laidOutNodes,
      baseEdges: snapshot.edges,
      layoutPositions,
    });
    get().recomputeDisplayGraph();
  },

  recomputeDisplayGraph: () => {
    const state = get();
    if (state.baseNodes.length === 0 && state.baseEdges.length === 0) {
      set({
        nodes: [],
        edges: [],
        visibleEdgeCount: 0,
        totalEdgeCount: 0,
        zoomBand: getZoomBandFromLevel(state.zoomLevel),
        satelliteCounts: {},
      });
      return;
    }

    const display = buildDisplayGraph(state);
    set(display);
  },
}));

function getZoomBandFromLevel(zoomLevel: number): 'overview' | 'standard' | 'detail' {
  return getZoomBand(zoomLevel);
}
