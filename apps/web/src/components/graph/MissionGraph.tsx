'use client';

/**
 * MissionGraph — The central organizational graph visualization.
 * Uses React Flow with custom nodes, semantic zoom, and connection clarity controls.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
  type Node,
  type OnNodeDrag,
  ReactFlowProvider,
  useOnViewportChange,
} from '@xyflow/react';
import { useGraphStore } from '@/stores/graphStore';
import { useReviewStore } from '@/stores/reviewStore';
import { AgentNode } from './AgentNode';
import { TaskNode } from './TaskNode';
import { ToolNode } from './ToolNode';
import { BundledEdge } from './BundledEdge';
import { AnimatedEdge } from './AnimatedEdge';
import { GraphLegend } from './GraphLegend';
import { DensityHeatmap } from './DensityHeatmap';
import { GraphViewportController } from './GraphViewportController';

const nodeTypes = {
  agentNode: AgentNode,
  taskNode: TaskNode,
  toolNode: ToolNode,
};

const edgeTypes = {
  bundledEdge: BundledEdge,
  animatedEdge: AnimatedEdge,
};

const minimapNodeColor = (node: { type?: string }) => {
  const typeColors: Record<string, string> = {
    agentNode: '#818cf8',
    taskNode: '#67e8f9',
    toolNode: '#fbbf24',
  };
  return typeColors[node.type || ''] || '#5d6180';
};

function mergeStoreNodesWithLocalPositions(storeNodes: Node[], currentNodes: Node[]): Node[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return storeNodes.map((storeNode) => {
    const current = currentById.get(storeNode.id);
    if (current?.dragging) {
      return { ...storeNode, position: current.position, dragging: true };
    }
    return storeNode;
  });
}

function MissionGraphInner() {
  const storeNodes = useGraphStore((state) => state.nodes);
  const storeEdges = useGraphStore((state) => state.edges);
  const setSelectedNodeId = useGraphStore((state) => state.setSelectedNodeId);
  const setZoomLevel = useGraphStore((state) => state.setZoomLevel);
  const setNodeLayoutPosition = useGraphStore((state) => state.setNodeLayoutPosition);
  const toggleFocusMode = useGraphStore((state) => state.toggleFocusMode);

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const { setActiveCommentTarget } = useReviewStore();
  const lastZoomRef = useRef(storeNodes.length > 0 ? 1 : 1);

  useEffect(() => {
    setNodes((current) => mergeStoreNodesWithLocalPositions(storeNodes, current));
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(storeEdges);
  }, [storeEdges, setEdges]);

  useOnViewportChange({
    onChange: (viewport) => {
      if (Math.abs(viewport.zoom - lastZoomRef.current) < 0.001) {
        return;
      }
      lastZoomRef.current = viewport.zoom;
      setZoomLevel(viewport.zoom);
    },
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleFocusMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFocusMode]);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_, node) => {
      setNodeLayoutPosition(node.id, node.position);
    },
    [setNodeLayoutPosition],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      setSelectedNodeId(node.id);
      setActiveCommentTarget({ type: 'node', id: node.id });
    },
    [setSelectedNodeId, setActiveCommentTarget],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setActiveCommentTarget(null);
    useGraphStore.getState().setHighlightedEdgeId(null);
  }, [setSelectedNodeId, setActiveCommentTarget]);

  return (
    <div className="relative h-full w-full pt-[52px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={0.35}
        maxZoom={2.5}
        panOnScroll
        zoomOnScroll
        defaultEdgeOptions={{
          type: 'bundledEdge',
          style: { strokeWidth: 1.5 },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(255,255,255,0.03)"
        />
        <Controls
          showInteractive={false}
          position="bottom-left"
        />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(10, 11, 16, 0.85)"
          position="bottom-right"
          style={{ width: 140, height: 90 }}
          pannable
          zoomable
        />
        <GraphViewportController />
        <GraphLegend />
        <DensityHeatmap />
      </ReactFlow>
    </div>
  );
}

export function MissionGraph() {
  return (
    <ReactFlowProvider>
      <MissionGraphInner />
    </ReactFlowProvider>
  );
}
