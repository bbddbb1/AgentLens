import type { Edge, Node } from '@xyflow/react';
import type { EdgeType, GraphEdge, GraphNode } from '@agentlens/protocol';

export const ALL_EDGE_TYPES: EdgeType[] = [
  'dependency',
  'uses',
  'delegation',
  'critique',
  'review',
  'escalation',
  'data_flow',
  'approval',
  'member_of',
  'produces',
];

export type EdgeLayerPreset = 'orchestration' | 'execution' | 'data' | 'all';
export type TracePreset = 'none' | 'orchestration' | 'execution' | 'data';
export type ZoomBand = 'overview' | 'standard' | 'detail';
export type FocusDepth = 1 | 2;

export interface HiddenGraphContext {
  kind: 'hidden_recorded_context' | 'missing_relationship_evidence';
  reason: 'overview_zoom' | 'standard_zoom' | 'focus_mode' | 'none';
  hiddenNodeCount: number;
  hiddenEdgeCount: number;
  disclosure: string;
  inspectHint?: string;
}

export const EDGE_PRESET_TYPES: Record<EdgeLayerPreset, EdgeType[]> = {
  orchestration: ['delegation', 'review', 'critique', 'escalation', 'approval', 'member_of'],
  execution: ['dependency', 'uses'],
  data: ['data_flow', 'produces'],
  all: ALL_EDGE_TYPES,
};

export const TRACE_EDGE_TYPES: Record<Exclude<TracePreset, 'none'>, EdgeType[]> = {
  orchestration: ['delegation', 'review', 'critique', 'escalation', 'approval'],
  execution: ['dependency', 'uses'],
  data: ['data_flow', 'produces', 'uses'],
};

const SATELLITE_NODE_TYPES = new Set(['tool', 'memory', 'artifact']);
const OVERVIEW_NODE_TYPES = new Set(['agent', 'human', 'team']);
const STANDARD_NODE_TYPES = new Set(['agent', 'human', 'team', 'task']);

export function getZoomBand(zoomLevel: number): ZoomBand {
  if (zoomLevel < 0.5) return 'overview';
  if (zoomLevel < 1.2) return 'standard';
  return 'detail';
}

export function defaultEdgeVisibility(): Record<EdgeType, boolean> {
  return Object.fromEntries(ALL_EDGE_TYPES.map((type) => [type, true])) as Record<EdgeType, boolean>;
}

export function edgeVisibilityFromPreset(preset: EdgeLayerPreset): Record<EdgeType, boolean> {
  const allowed = new Set(EDGE_PRESET_TYPES[preset]);
  return Object.fromEntries(
    ALL_EDGE_TYPES.map((type) => [type, allowed.has(type)]),
  ) as Record<EdgeType, boolean>;
}

export function getFocusNeighborhood(
  nodeId: string,
  edges: Array<{ source: string; target: string }>,
  depth: FocusDepth,
): Set<string> {
  const neighborhood = new Set<string>([nodeId]);
  let frontier = new Set<string>([nodeId]);

  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.source)) next.add(edge.target);
      if (frontier.has(edge.target)) next.add(edge.source);
    }
    for (const id of next) neighborhood.add(id);
    frontier = next;
  }

  return neighborhood;
}

export interface BundleGroup {
  key: string;
  source: string;
  target: string;
  edgeType: string;
  edges: GraphEdge[];
  count: number;
}

export function groupEdgesForBundling(edges: GraphEdge[]): BundleGroup[] {
  const groups = new Map<string, BundleGroup>();

  for (const edge of edges) {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    const existing = groups.get(key);
    if (existing) {
      existing.edges.push(edge);
      existing.count += 1;
    } else {
      groups.set(key, {
        key,
        source: edge.source,
        target: edge.target,
        edgeType: edge.type,
        edges: [edge],
        count: 1,
      });
    }
  }

  return Array.from(groups.values());
}

export interface GraphVisibilityInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  edgeVisibility: Record<EdgeType, boolean>;
  tracePreset: TracePreset;
  showActiveOnly: boolean;
  zoomLevel: number;
  focusModeEnabled: boolean;
  focusDepth: FocusDepth;
  selectedNodeId: string | null;
  highlightedEdgeId: string | null;
  bundleEdges: boolean;
  disableParticles: boolean;
}

export interface GraphVisibilityResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  visibleEdgeCount: number;
  totalEdgeCount: number;
  zoomBand: ZoomBand;
  satelliteCounts: Record<string, { tools: number; memory: number; artifacts: number }>;
  hiddenContext: HiddenGraphContext | null;
}

export function computeVisibleGraph(input: GraphVisibilityInput): GraphVisibilityResult {
  const {
    nodes,
    edges,
    edgeVisibility,
    tracePreset,
    showActiveOnly,
    zoomLevel,
    focusModeEnabled,
    focusDepth,
    selectedNodeId,
    bundleEdges,
  } = input;

  const zoomBand = getZoomBand(zoomLevel);
  const satelliteCounts: GraphVisibilityResult['satelliteCounts'] = {};

  for (const node of nodes) {
    if (!OVERVIEW_NODE_TYPES.has(node.type)) continue;
    satelliteCounts[node.id] = { tools: 0, memory: 0, artifacts: 0 };
  }

  for (const edge of edges) {
    if (edge.type === 'uses') {
      satelliteCounts[edge.source] ??= { tools: 0, memory: 0, artifacts: 0 };
      satelliteCounts[edge.source].tools += 1;
    }
    if (edge.type === 'data_flow') {
      satelliteCounts[edge.source] ??= { tools: 0, memory: 0, artifacts: 0 };
      satelliteCounts[edge.source].memory += 1;
    }
    if (edge.type === 'produces') {
      satelliteCounts[edge.source] ??= { tools: 0, memory: 0, artifacts: 0 };
      satelliteCounts[edge.source].artifacts += 1;
    }
  }

  let filteredEdges = edges.filter((edge) => {
    if (!edgeVisibility[edge.type as EdgeType]) return false;
    if (showActiveOnly && edge.status !== 'active') return false;
    if (tracePreset !== 'none' && !TRACE_EDGE_TYPES[tracePreset].includes(edge.type as EdgeType)) {
      return false;
    }
    if (zoomBand === 'overview') {
      return ['delegation', 'review', 'critique', 'escalation', 'approval', 'member_of'].includes(edge.type);
    }
    if (zoomBand === 'standard') {
      return !['uses', 'data_flow', 'produces'].includes(edge.type);
    }
    return true;
  });

  let filteredNodes = nodes.filter((node) => {
    if (zoomBand === 'overview') return OVERVIEW_NODE_TYPES.has(node.type);
    if (zoomBand === 'standard') return STANDARD_NODE_TYPES.has(node.type);
    return true;
  });

  // Zoom is a presentation preference, never permission to erase an entire
  // recorded frame. Sparse frames may contain only tool, memory, or artifact
  // nodes, so fall back to their recorded nodes when the current zoom taxonomy
  // would otherwise produce an inaccessible empty canvas.
  if (filteredNodes.length === 0 && nodes.length > 0) {
    filteredNodes = nodes;
  }

  const zoomFilteredNodes = filteredNodes;
  const zoomFilteredEdges = filteredEdges;
  let hiddenContext: HiddenGraphContext | null = null;

  if (focusModeEnabled && selectedNodeId) {
    const neighborhood = getFocusNeighborhood(
      selectedNodeId,
      filteredEdges.map((e) => ({ source: e.source, target: e.target })),
      focusDepth,
    );

    filteredEdges = filteredEdges.filter(
      (edge) => neighborhood.has(edge.source) && neighborhood.has(edge.target),
    );
    filteredNodes = filteredNodes.filter((node) => neighborhood.has(node.id));

    const hiddenNodeCount = Math.max(0, zoomFilteredNodes.length - filteredNodes.length);
    const hiddenEdgeCount = Math.max(0, zoomFilteredEdges.length - filteredEdges.length);
    if (hiddenNodeCount > 0 || hiddenEdgeCount > 0) {
      hiddenContext = {
        kind: 'hidden_recorded_context',
        reason: 'focus_mode',
        hiddenNodeCount,
        hiddenEdgeCount,
        disclosure: `Recorded graph context hidden by selected-node focus: ${hiddenNodeCount} nodes, ${hiddenEdgeCount} edges`,
        inspectHint: 'Disable focus mode or widen focus depth to inspect hidden recorded neighbors.',
      };
    }
  } else if (tracePreset !== 'none') {
    const connected = new Set<string>();
    for (const edge of filteredEdges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    filteredNodes = filteredNodes.filter((node) => connected.has(node.id));
  }

  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  filteredEdges = filteredEdges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  if (!hiddenContext) {
    const hiddenNodeCount = Math.max(0, nodes.length - filteredNodes.length);
    const hiddenEdgeCount = Math.max(0, edges.length - filteredEdges.length);
    if (zoomBand === 'overview' && (hiddenNodeCount > 0 || hiddenEdgeCount > 0)) {
      hiddenContext = {
        kind: 'hidden_recorded_context',
        reason: 'overview_zoom',
        hiddenNodeCount,
        hiddenEdgeCount,
        disclosure: `Recorded graph context hidden by overview zoom: ${hiddenNodeCount} nodes, ${hiddenEdgeCount} edges`,
        inspectHint: 'Zoom in to inspect hidden dependency edges and satellite nodes.',
      };
    } else if (zoomBand === 'standard' && (hiddenNodeCount > 0 || hiddenEdgeCount > 0)) {
      hiddenContext = {
        kind: 'hidden_recorded_context',
        reason: 'standard_zoom',
        hiddenNodeCount,
        hiddenEdgeCount,
        disclosure: `Recorded graph context hidden by standard zoom: ${hiddenNodeCount} nodes, ${hiddenEdgeCount} edges`,
        inspectHint: 'Zoom in for tool, retrieval, memory, artifact, and edge-level execution detail.',
      };
    }
  }

  if (!hiddenContext && selectedNodeId) {
    const selectedHasRecordedRelationships = edges.some(
      (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
    );
    if (!selectedHasRecordedRelationships) {
      hiddenContext = {
        kind: 'missing_relationship_evidence',
        reason: 'none',
        hiddenNodeCount: 0,
        hiddenEdgeCount: 0,
        disclosure: 'No recorded relationship evidence for the selected node at this frame.',
      };
    }
  }

  let outputEdges = filteredEdges;
  if (bundleEdges) {
    const groups = groupEdgesForBundling(filteredEdges);
    outputEdges = groups.map((group) => {
      const primary = group.edges[0];
      return {
        ...primary,
        id: group.count > 1 ? `bundle:${group.key}` : primary.id,
        label: group.count > 1 ? `${group.edgeType} ×${group.count}` : primary.label,
        metadata: {
          ...(primary.metadata ?? {}),
          bundled: group.count > 1,
          bundleCount: group.count,
          bundledEdgeIds: group.edges.map((e) => e.id),
        },
      };
    });
  }

  return {
    nodes: filteredNodes,
    edges: outputEdges,
    visibleEdgeCount: outputEdges.length,
    totalEdgeCount: edges.length,
    zoomBand,
    satelliteCounts,
    hiddenContext,
  };
}

export function applyFocusStyling(
  nodes: Node[],
  edges: Edge[],
  selectedNodeId: string | null,
  focusModeEnabled: boolean,
  focusDepth: FocusDepth,
  highlightedEdgeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  if (!focusModeEnabled || !selectedNodeId) {
    if (!highlightedEdgeId) return { nodes, edges };

    return {
      nodes,
      edges: edges.map((edge) => {
        const bundledIds = (edge.data?.bundledEdgeIds as string[] | undefined) ?? [];
        const isHighlighted =
          edge.id === highlightedEdgeId ||
          bundledIds.includes(highlightedEdgeId);
        return {
          ...edge,
          style: {
            ...edge.style,
            opacity: isHighlighted ? 1 : 0.15,
          },
          animated: isHighlighted ? edge.animated : false,
          data: {
            ...edge.data,
            highlighted: isHighlighted,
            dimmed: !isHighlighted,
          },
        };
      }),
    };
  }

  const neighborhood = getFocusNeighborhood(
    selectedNodeId,
    edges.map((e) => ({ source: e.source, target: e.target })),
    focusDepth,
  );

  const hop1 = getFocusNeighborhood(
    selectedNodeId,
    edges.map((e) => ({ source: e.source, target: e.target })),
    1,
  );

  return {
    nodes: nodes.map((node) => {
      let opacity = 0.12;
      if (node.id === selectedNodeId) opacity = 1;
      else if (hop1.has(node.id)) opacity = 0.85;
      else if (neighborhood.has(node.id)) opacity = 0.5;

      return {
        ...node,
        style: { ...node.style, opacity, transition: 'opacity 200ms ease' },
        data: {
          ...node.data,
          focusOpacity: opacity,
          hideLabel: opacity < 0.3,
        },
      };
    }),
    edges: edges.map((edge) => {
      const bundledIds = (edge.data?.bundledEdgeIds as string[] | undefined) ?? [];
      const isHighlighted =
        highlightedEdgeId &&
        (edge.id === highlightedEdgeId || bundledIds.includes(highlightedEdgeId));
      const isRelevant =
        neighborhood.has(edge.source) && neighborhood.has(edge.target);

      if (!isRelevant) {
        return {
          ...edge,
          hidden: true,
          selectable: false,
          data: { ...edge.data, hidden: true },
        };
      }

      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: isHighlighted ? 1 : 1,
        },
        animated: edge.animated,
        data: {
          ...edge.data,
          highlighted: !!isHighlighted,
          traced: true,
        },
      };
    }),
  };
}

export function computeEdgeDensityHotspots(
  nodes: GraphNode[],
  edges: GraphEdge[],
  gridSize = 200,
): Array<{ x: number; y: number; density: number }> {
  const counts = new Map<string, number>();

  const nodePositions = new Map(nodes.map((n) => [n.id, n.position]));

  for (const edge of edges) {
    const source = nodePositions.get(edge.source);
    const target = nodePositions.get(edge.target);
    if (!source || !target) continue;

    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    const key = `${Math.floor(midX / gridSize)}:${Math.floor(midY / gridSize)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const threshold = Math.max(3, Math.ceil(edges.length * 0.15));
  const hotspots: Array<{ x: number; y: number; density: number }> = [];

  for (const [key, density] of counts) {
    if (density < threshold) continue;
    const [gx, gy] = key.split(':').map(Number);
    hotspots.push({
      x: gx * gridSize + gridSize / 2,
      y: gy * gridSize + gridSize / 2,
      density,
    });
  }

  return hotspots.sort((a, b) => b.density - a.density).slice(0, 6);
}

export function isSatelliteNodeType(nodeType: string): boolean {
  return SATELLITE_NODE_TYPES.has(nodeType);
}
