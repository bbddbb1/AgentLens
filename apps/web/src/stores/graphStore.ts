/** Display state for the selected runtime graph projection. */

import { create } from 'zustand';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { EdgeType, GraphEdge, GraphNode, GraphSnapshot } from '@agentlens/protocol';
export type { GraphEdge, GraphNode, GraphSnapshot } from '@agentlens/protocol';

import { computeVisibleGraph, defaultEdgeVisibility, edgeVisibilityFromPreset, getZoomBand, type FocusDepth, type GraphDisplayPreset, type HiddenRecordedGraphContext, type MissingRelationshipContext } from '@/lib/graphVisibility';
import { applyClientLayout } from '@/lib/graphLayout';
import { EDGE_PRESENTATION } from '@/lib/graphPresentation';

interface GraphStore {
  nodes: Node[];
  edges: Edge[];
  baseNodes: GraphNode[];
  baseEdges: GraphEdge[];
  snapshots: GraphSnapshot[];
  selectedNodeId: string | null;
  highlightedNodeIds: string[];
  highlightedEdgeIds: string[];
  zoomLevel: number;
  zoomBand: 'overview' | 'standard' | 'detail';
  displayPreset: GraphDisplayPreset;
  edgeVisibility: Record<EdgeType, boolean>;
  showConnectedOnly: boolean;
  showActiveOnly: boolean;
  focusModeEnabled: boolean;
  focusDepth: FocusDepth;
  bundleEdges: boolean;
  showMinimap: boolean;
  visibleEdgeCount: number;
  renderedEdgeCount: number;
  totalEdgeCount: number;
  hiddenContext: HiddenRecordedGraphContext | null;
  relationshipContext: MissingRelationshipContext | null;
  layoutPositions: Record<string, { x: number; y: number }>;

  setSnapshots: (snapshots: GraphSnapshot[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setZoomLevel: (level: number) => void;
  setDisplayPreset: (preset: GraphDisplayPreset) => void;
  setEdgeTypeVisible: (type: EdgeType, visible: boolean) => void;
  setShowConnectedOnly: (value: boolean) => void;
  setShowActiveOnly: (value: boolean) => void;
  setFocusModeEnabled: (value: boolean) => void;
  setFocusDepth: (depth: FocusDepth) => void;
  setBundleEdges: (value: boolean) => void;
  setShowMinimap: (value: boolean) => void;
  toggleFocusMode: () => void;
  resetDisplay: () => void;
  setNodeLayoutPosition: (nodeId: string, position: { x: number; y: number }) => void;
  clearWorkspace: () => void;
  applySnapshot: (snapshot: GraphSnapshot) => void;
  recomputeDisplayGraph: () => void;
}

function mapNodeType(type: string): string {
  const mapping: Record<string, string> = {
    agent: 'agentNode',
    human: 'agentNode',
    team: 'agentNode',
    task: 'taskNode',
    tool: 'toolNode',
    memory: 'toolNode',
    artifact: 'toolNode',
  };
  return mapping[type] ?? 'default';
}

function graphNodesToFlowNodes(graphNodes: GraphNode[], layoutPositions: Record<string, { x: number; y: number }>, highlightedNodeIds: string[]): Node[] {
  return graphNodes.map((node) => ({
    id: node.id,
    type: mapNodeType(node.type),
    position: layoutPositions[node.id] ?? node.position,
    data: {
      label: node.label,
      nodeType: node.type,
      status: node.status,
      role: node.agent_role,
      metadata: node.metadata,
      durationMs: node.duration_ms,
      errorCount: node.error_count,
      activity: node.activity,
      highlighted: highlightedNodeIds.includes(node.id),
    },
  }));
}

function graphEdgesToFlowEdges(graphEdges: GraphEdge[], highlightedEdgeIds: string[]): Edge[] {
  const pairCounts = new Map<string, number>();

  return graphEdges.map((edge) => {
    const pairKey = JSON.stringify([edge.source, edge.target]);
    const offsetIndex = pairCounts.get(pairKey) ?? 0;
    pairCounts.set(pairKey, offsetIndex + 1);
    const presentation = EDGE_PRESENTATION[edge.type];
    const bundledEdgeIds = Array.isArray(edge.metadata?.bundledEdgeIds) ? edge.metadata.bundledEdgeIds.filter((id): id is string => typeof id === 'string') : [];
    const highlighted = highlightedEdgeIds.includes(edge.id) || bundledEdgeIds.some((id) => highlightedEdgeIds.includes(id));

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: 'bundledEdge',
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: presentation.stroke,
        width: 14,
        height: 14,
      },
      style: {
        stroke: presentation.stroke,
        strokeWidth: presentation.strokeWidth,
        strokeDasharray: presentation.strokeDasharray,
      },
      data: {
        edgeType: edge.type,
        status: edge.status,
        bundled: edge.metadata?.bundled === true,
        bundleCount: edge.metadata?.bundleCount as number | undefined,
        bundledEdgeIds,
        pathOffset: offsetIndex * 12,
        highlighted,
      },
    };
  });
}

function buildDisplayGraph(state: GraphStore): Pick<GraphStore, 'nodes' | 'edges' | 'visibleEdgeCount' | 'renderedEdgeCount' | 'totalEdgeCount' | 'zoomBand' | 'hiddenContext' | 'relationshipContext'> {
  const visibility = computeVisibleGraph({
    nodes: state.baseNodes,
    edges: state.baseEdges,
    edgeVisibility: state.edgeVisibility,
    showConnectedOnly: state.showConnectedOnly,
    showActiveOnly: state.showActiveOnly,
    zoomLevel: state.zoomLevel,
    focusModeEnabled: state.focusModeEnabled,
    focusDepth: state.focusDepth,
    selectedNodeId: state.selectedNodeId,
    bundleEdges: state.bundleEdges,
  });

  const flowNodes = graphNodesToFlowNodes(visibility.nodes, state.layoutPositions, state.highlightedNodeIds).map((node) => ({
    ...node,
    selected: node.id === state.selectedNodeId,
  }));
  const flowEdges = graphEdgesToFlowEdges(visibility.edges, state.highlightedEdgeIds);

  return {
    nodes: flowNodes,
    edges: flowEdges,
    visibleEdgeCount: visibility.visibleEdgeCount,
    renderedEdgeCount: visibility.renderedEdgeCount,
    totalEdgeCount: visibility.totalEdgeCount,
    zoomBand: visibility.zoomBand,
    hiddenContext: visibility.hiddenContext,
    relationshipContext: visibility.relationshipContext,
  };
}

let highlightTimeout: ReturnType<typeof setTimeout> | null = null;

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  baseNodes: [],
  baseEdges: [],
  snapshots: [],
  selectedNodeId: null,
  highlightedNodeIds: [],
  highlightedEdgeIds: [],
  zoomLevel: 1,
  zoomBand: 'standard',
  displayPreset: 'all',
  edgeVisibility: defaultEdgeVisibility(),
  showConnectedOnly: false,
  showActiveOnly: false,
  focusModeEnabled: false,
  focusDepth: 1,
  bundleEdges: true,
  showMinimap: false,
  visibleEdgeCount: 0,
  renderedEdgeCount: 0,
  totalEdgeCount: 0,
  hiddenContext: null,
  relationshipContext: null,
  layoutPositions: {},

  setSnapshots: (snapshots) => set({ snapshots, selectedNodeId: null }),
  setSelectedNodeId: (selectedNodeId) => {
    set({ selectedNodeId });
    get().recomputeDisplayGraph();
  },
  setZoomLevel: (zoomLevel) => {
    const previous = get().zoomLevel;
    const previousBand = getZoomBand(previous);
    const nextBand = getZoomBand(zoomLevel);
    if (Math.abs(previous - zoomLevel) < 0.001) return;
    set({ zoomLevel });
    if (previousBand !== nextBand) get().recomputeDisplayGraph();
  },
  setDisplayPreset: (displayPreset) => {
    if (displayPreset === 'custom') {
      set({ displayPreset });
    } else {
      set({
        displayPreset,
        edgeVisibility: edgeVisibilityFromPreset(displayPreset),
      });
    }
    get().recomputeDisplayGraph();
  },
  setEdgeTypeVisible: (type, visible) => {
    set({
      edgeVisibility: { ...get().edgeVisibility, [type]: visible },
      displayPreset: 'custom',
    });
    get().recomputeDisplayGraph();
  },
  setShowConnectedOnly: (showConnectedOnly) => {
    set({ showConnectedOnly });
    get().recomputeDisplayGraph();
  },
  setShowActiveOnly: (showActiveOnly) => {
    set({ showActiveOnly });
    get().recomputeDisplayGraph();
  },
  setFocusModeEnabled: (focusModeEnabled) => {
    set({ focusModeEnabled });
    get().recomputeDisplayGraph();
  },
  setFocusDepth: (focusDepth) => {
    set({ focusDepth });
    get().recomputeDisplayGraph();
  },
  setBundleEdges: (bundleEdges) => {
    set({ bundleEdges });
    get().recomputeDisplayGraph();
  },
  setShowMinimap: (showMinimap) => set({ showMinimap }),
  toggleFocusMode: () => {
    set({ focusModeEnabled: !get().focusModeEnabled });
    get().recomputeDisplayGraph();
  },
  resetDisplay: () => {
    set({
      displayPreset: 'all',
      edgeVisibility: defaultEdgeVisibility(),
      showConnectedOnly: false,
      showActiveOnly: false,
      focusModeEnabled: false,
      focusDepth: 1,
      bundleEdges: true,
      showMinimap: false,
    });
    get().recomputeDisplayGraph();
  },

  setNodeLayoutPosition: (nodeId, position) => {
    set({
      layoutPositions: { ...get().layoutPositions, [nodeId]: position },
      nodes: get().nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
    });
  },

  clearWorkspace: () => {
    if (highlightTimeout) {
      clearTimeout(highlightTimeout);
      highlightTimeout = null;
    }
    set({
      nodes: [],
      edges: [],
      baseNodes: [],
      baseEdges: [],
      snapshots: [],
      selectedNodeId: null,
      highlightedNodeIds: [],
      highlightedEdgeIds: [],
      visibleEdgeCount: 0,
      renderedEdgeCount: 0,
      totalEdgeCount: 0,
      hiddenContext: null,
      relationshipContext: null,
      layoutPositions: {},
    });
  },

  applySnapshot: (snapshot) => {
    const laidOutNodes = applyClientLayout(snapshot.nodes, snapshot.edges);
    const nodeIds = new Set(laidOutNodes.map((node) => node.id));
    const layoutPositions = Object.fromEntries(Object.entries(get().layoutPositions).filter(([id]) => nodeIds.has(id)));
    const highlightedNodeIds: string[] = [];
    const highlightedEdgeIds: string[] = [];
    const currentIndex = get().snapshots.findIndex((entry) => entry.id === snapshot.id);
    const previousSnapshot = currentIndex > 0 ? get().snapshots[currentIndex - 1] : null;

    if (previousSnapshot) {
      const previousNodeStatus = new Map(previousSnapshot.nodes.map((node) => [node.id, node.status]));
      for (const node of snapshot.nodes) {
        if (!previousNodeStatus.has(node.id) || previousNodeStatus.get(node.id) !== node.status) {
          highlightedNodeIds.push(node.id);
        }
      }
      const previousEdgeStatus = new Map(previousSnapshot.edges.map((edge) => [edge.id, edge.status]));
      for (const edge of snapshot.edges) {
        if (!previousEdgeStatus.has(edge.id) || previousEdgeStatus.get(edge.id) !== edge.status) {
          highlightedEdgeIds.push(edge.id);
        }
      }
    }

    if (highlightTimeout) clearTimeout(highlightTimeout);
    highlightTimeout = null;
    set({
      baseNodes: laidOutNodes,
      baseEdges: snapshot.edges,
      selectedNodeId: null,
      layoutPositions,
      highlightedNodeIds,
      highlightedEdgeIds,
    });
    get().recomputeDisplayGraph();

    if (highlightedNodeIds.length > 0 || highlightedEdgeIds.length > 0) {
      highlightTimeout = setTimeout(() => {
        set({ highlightedNodeIds: [], highlightedEdgeIds: [] });
        get().recomputeDisplayGraph();
        highlightTimeout = null;
      }, 2000);
    }
  },

  recomputeDisplayGraph: () => {
    const state = get();
    if (state.baseNodes.length === 0 && state.baseEdges.length === 0) {
      set({
        nodes: [],
        edges: [],
        visibleEdgeCount: 0,
        renderedEdgeCount: 0,
        totalEdgeCount: 0,
        zoomBand: getZoomBand(state.zoomLevel),
        hiddenContext: null,
        relationshipContext: null,
      });
      return;
    }
    set(buildDisplayGraph(state));
  },
}));
