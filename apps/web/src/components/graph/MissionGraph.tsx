'use client';

/**
 * MissionGraph — The central organizational graph visualization.
 * Uses React Flow with custom nodes and semantic zoom.
 */

import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { useGraphStore } from '@/stores/graphStore';
import { useReviewStore } from '@/stores/reviewStore';
import { AgentNode } from './AgentNode';
import { TaskNode } from './TaskNode';
import { ToolNode } from './ToolNode';
import { AnimatedEdge } from './AnimatedEdge';
import { GraphLegend } from './GraphLegend';

const nodeTypes = {
  agentNode: AgentNode,
  taskNode: TaskNode,
  toolNode: ToolNode,
};

const edgeTypes = {
  animatedEdge: AnimatedEdge,
};

const minimapNodeColor = (node: Node) => {
  const typeColors: Record<string, string> = {
    agentNode: '#818cf8',
    taskNode: '#67e8f9',
    toolNode: '#fbbf24',
  };
  return typeColors[node.type || ''] || '#5d6180';
};

function MissionGraphInner() {
  const { nodes: storeNodes, edges: storeEdges, setSelectedNodeId } = useGraphStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const { setActiveCommentTarget } = useReviewStore();

  // Update nodes/edges when store changes
  useEffect(() => {
    setNodes(storeNodes);
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(storeEdges);
  }, [storeEdges, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      setSelectedNodeId(node.id);
      setActiveCommentTarget({ type: 'node', id: node.id });
    },
    [setSelectedNodeId, setActiveCommentTarget]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setActiveCommentTarget(null);
  }, [setSelectedNodeId, setActiveCommentTarget]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.1}
      maxZoom={2.5}
      defaultEdgeOptions={{
        type: 'smoothstep',
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
      />
      <GraphLegend />
    </ReactFlow>
  );
}

export function MissionGraph() {
  return (
    <ReactFlowProvider>
      <MissionGraphInner />
    </ReactFlowProvider>
  );
}
