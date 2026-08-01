'use client';

/**
 * MissionGraph — The central organizational graph visualization.
 * Uses React Flow with custom nodes, semantic zoom, and connection clarity controls.
 */

import { useCallback, useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant, useNodesState, useEdgesState, type NodeMouseHandler, type Node, type OnNodeDrag, ReactFlowProvider, useOnViewportChange } from '@xyflow/react';
import { useGraphStore } from '@/stores/graphStore';
import { useReplayStore } from '@/stores/replayStore';
import { AgentNode } from './AgentNode';
import { TaskNode } from './TaskNode';
import { ToolNode } from './ToolNode';
import { BundledEdge } from './BundledEdge';
import { GraphViewportController } from './GraphViewportController';
import { CanvasToolbar, MINIMAP_NODE_THRESHOLD } from './CanvasToolbar';

const nodeTypes = {
  agentNode: AgentNode,
  taskNode: TaskNode,
  toolNode: ToolNode,
};

const edgeTypes = {
  bundledEdge: BundledEdge,
};

const minimapNodeColor = (node: Node) => {
  const typeColors: Record<string, string> = {
    agent: 'var(--color-node-agent)',
    human: 'var(--color-node-human)',
    team: 'var(--color-node-team)',
    task: 'var(--color-node-task)',
    tool: 'var(--color-node-tool)',
    memory: 'var(--color-node-memory)',
    artifact: 'var(--color-node-artifact)',
  };
  const nodeType = typeof node.data?.nodeType === 'string' ? node.data.nodeType : '';
  return typeColors[nodeType] ?? 'var(--color-text-muted)';
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
  const showMinimap = useGraphStore((state) => state.showMinimap);
  const baseNodeCount = useGraphStore((state) => state.baseNodes.length);
  const setSelectedActivityId = useReplayStore((state) => state.setSelectedActivityId);
  const setSelectedEventId = useReplayStore((state) => state.setSelectedEventId);

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const lastZoomRef = useRef(1);

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
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) {
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
      const activityId = typeof (node.data as Record<string, unknown>).activity === 'object' && (node.data as { activity?: { id?: string } }).activity?.id ? ((node.data as { activity?: { id?: string } }).activity?.id ?? null) : null;
      setSelectedActivityId(activityId);
    },
    [setSelectedActivityId, setSelectedNodeId],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedActivityId(null);
    setSelectedEventId(null);
  }, [setSelectedActivityId, setSelectedEventId, setSelectedNodeId]);

  return (
    <div className="relative h-full w-full">
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
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-border-subtle)" />
        <Controls showInteractive={false} position="bottom-left" orientation="horizontal" className="opacity-60 !shadow-none transition-opacity hover:opacity-100 focus-within:opacity-100" />
        {showMinimap && baseNodeCount >= MINIMAP_NODE_THRESHOLD && <MiniMap nodeColor={minimapNodeColor} maskColor="color-mix(in srgb, var(--color-bg-primary) 82%, transparent)" position="bottom-right" style={{ width: 132, height: 84 }} pannable zoomable />}
        <GraphViewportController />
        <CanvasToolbar />
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
