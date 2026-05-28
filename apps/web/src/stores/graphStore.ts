/**
 * Graph store 鈥?manages the organizational graph state for React Flow.
 */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

import type { GraphEdge, GraphNode, GraphSnapshot } from '@agentlens/protocol';
export type { GraphEdge, GraphNode, GraphSnapshot } from '@agentlens/protocol';

interface GraphStore {
  nodes: Node[];
  edges: Edge[];
  snapshots: GraphSnapshot[];
  currentSnapshotIndex: number;
  selectedNodeId: string | null;
  activeNodeId: string | null;
  hoveredNodeId: string | null;
  zoomLevel: number;

  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setSnapshots: (snapshots: GraphSnapshot[]) => void;
  setCurrentSnapshotIndex: (index: number) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveNodeId: (id: string | null) => void;
  setHoveredNodeId: (id: string | null) => void;
  setZoomLevel: (level: number) => void;

  applySnapshot: (snapshot: GraphSnapshot) => void;
}

// Map node types to React Flow node types
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

// Map edge types to visual styles
function mapEdgeStyle(type: string): Partial<Edge> {
  const styles: Record<string, Partial<Edge>> = {
    delegation: { type: 'animatedEdge', style: { stroke: '#818cf8', strokeWidth: 2 } },
    critique: { type: 'animatedEdge', style: { stroke: '#f87171', strokeWidth: 2, strokeDasharray: '5,5' } },
    review: { type: 'animatedEdge', style: { stroke: '#34d399', strokeWidth: 2 } },
    escalation: { type: 'animatedEdge', style: { stroke: '#fbbf24', strokeWidth: 2.5 }, animated: true },
    dependency: { type: 'animatedEdge', style: { stroke: '#5d6180', strokeWidth: 1.5 } },
    data_flow: { type: 'animatedEdge', style: { stroke: '#60a5fa', strokeWidth: 1.5, strokeDasharray: '3,3' } },
    uses: { type: 'animatedEdge', style: { stroke: '#fbbf24', strokeWidth: 1.5 } },
    approval: { type: 'animatedEdge', style: { stroke: '#34d399', strokeWidth: 2 } },
    produces: { type: 'animatedEdge', style: { stroke: '#fb923c', strokeWidth: 1.75 } },
  };
  return styles[type] || { type: 'animatedEdge', style: { stroke: '#5d6180', strokeWidth: 1 } };
}

function graphNodesToFlowNodes(graphNodes: GraphNode[]): Node[] {
  return graphNodes.map((gn) => ({
    id: gn.id,
    type: mapNodeType(gn.type),
    position: gn.position,
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
      hasPendingInterrupt: false, // Will be set during replay sync
    },
  }));
}

function graphEdgesToFlowEdges(graphEdges: GraphEdge[]): Edge[] {
  return graphEdges.map((ge) => ({
    id: ge.id,
    source: ge.source,
    target: ge.target,
    label: ge.label,
    animated: ge.animated,
    ...mapEdgeStyle(ge.type),
    data: { edgeType: ge.type, metadata: ge.metadata },
  }));
}

export const useGraphStore = create<GraphStore>((set) => ({
  nodes: [],
  edges: [],
  snapshots: [],
  currentSnapshotIndex: 0,
  selectedNodeId: null,
  activeNodeId: null,
  hoveredNodeId: null,
  zoomLevel: 1,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setSnapshots: (snapshots) => set({ snapshots }),
  setCurrentSnapshotIndex: (index) => set({ currentSnapshotIndex: index }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setActiveNodeId: (id) => set({ activeNodeId: id }),
  setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
  setZoomLevel: (level) => set({ zoomLevel: level }),

  applySnapshot: (snapshot) =>
    set({
      nodes: graphNodesToFlowNodes(snapshot.nodes),
      edges: graphEdgesToFlowEdges(snapshot.edges),
    }),
}));
