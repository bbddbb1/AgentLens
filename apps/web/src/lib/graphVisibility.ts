import type { EdgeType, GraphEdge, GraphNode } from '@agentlens/protocol';

export const ALL_EDGE_TYPES: EdgeType[] = ['dependency', 'uses', 'delegation', 'critique', 'review', 'escalation', 'data_flow', 'approval', 'member_of', 'produces'];

export type GraphDisplayPreset = 'all' | 'orchestration' | 'execution' | 'data' | 'custom';
export type ZoomBand = 'overview' | 'standard' | 'detail';
export type FocusDepth = 1 | 2;
export type HiddenGraphReason = 'overview_zoom' | 'standard_zoom' | 'edge_filter' | 'active_filter' | 'connected_only' | 'focus_mode';

export interface HiddenRecordedGraphContext {
  kind: 'hidden_recorded_context';
  reasons: HiddenGraphReason[];
  hiddenNodeCount: number;
  hiddenEdgeCount: number;
  disclosure: string;
  inspectHint: string;
}

export interface MissingRelationshipContext {
  kind: 'missing_relationship_evidence';
  disclosure: string;
}

export type HiddenGraphContext = HiddenRecordedGraphContext | MissingRelationshipContext;

export const DISPLAY_PRESET_EDGE_TYPES: Record<Exclude<GraphDisplayPreset, 'custom'>, EdgeType[]> = {
  orchestration: ['delegation', 'review', 'critique', 'escalation', 'approval', 'member_of'],
  execution: ['dependency', 'uses'],
  data: ['data_flow', 'produces'],
  all: ALL_EDGE_TYPES,
};

const OVERVIEW_NODE_TYPES = new Set(['agent', 'human', 'team']);
const STANDARD_NODE_TYPES = new Set(['agent', 'human', 'team', 'task']);
const OVERVIEW_EDGE_TYPES = new Set(DISPLAY_PRESET_EDGE_TYPES.orchestration);
const STANDARD_HIDDEN_EDGE_TYPES = new Set<EdgeType>(['uses', 'data_flow', 'produces']);

export function getZoomBand(zoomLevel: number): ZoomBand {
  if (zoomLevel < 0.5) return 'overview';
  if (zoomLevel < 1.2) return 'standard';
  return 'detail';
}

export function defaultEdgeVisibility(): Record<EdgeType, boolean> {
  return Object.fromEntries(ALL_EDGE_TYPES.map((type) => [type, true])) as Record<EdgeType, boolean>;
}

export function edgeVisibilityFromPreset(preset: Exclude<GraphDisplayPreset, 'custom'>): Record<EdgeType, boolean> {
  const allowed = new Set(DISPLAY_PRESET_EDGE_TYPES[preset]);
  return Object.fromEntries(ALL_EDGE_TYPES.map((type) => [type, allowed.has(type)])) as Record<EdgeType, boolean>;
}

export function getFocusNeighborhood(nodeId: string, edges: Array<{ source: string; target: string }>, depth: FocusDepth): Set<string> {
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
  edgeType: EdgeType;
  edges: GraphEdge[];
  count: number;
}

export function groupEdgesForBundling(edges: GraphEdge[]): BundleGroup[] {
  const groups = new Map<string, BundleGroup>();

  for (const edge of edges) {
    // JSON encoding keeps arbitrary runtime ids unambiguous.
    const key = JSON.stringify([edge.source, edge.target, edge.type]);
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
  showConnectedOnly: boolean;
  showActiveOnly: boolean;
  zoomLevel: number;
  focusModeEnabled: boolean;
  focusDepth: FocusDepth;
  selectedNodeId: string | null;
  bundleEdges: boolean;
}

export interface GraphVisibilityResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Recorded edges that remain visible before optional path bundling. */
  visibleEdgeCount: number;
  /** Rendered paths after optional bundling. */
  renderedEdgeCount: number;
  totalEdgeCount: number;
  zoomBand: ZoomBand;
  hiddenContext: HiddenRecordedGraphContext | null;
  relationshipContext: MissingRelationshipContext | null;
}

const REASON_LABELS: Record<HiddenGraphReason, string> = {
  overview_zoom: 'overview zoom',
  standard_zoom: 'standard zoom',
  edge_filter: 'edge-type filters',
  active_filter: 'active-edge filtering',
  connected_only: 'connected-node filtering',
  focus_mode: 'selected-node focus',
};

function addReason(reasons: HiddenGraphReason[], reason: HiddenGraphReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function computeVisibleGraph(input: GraphVisibilityInput): GraphVisibilityResult {
  const { nodes, edges, edgeVisibility, showConnectedOnly, showActiveOnly, zoomLevel, focusModeEnabled, focusDepth, selectedNodeId, bundleEdges } = input;

  const zoomBand = getZoomBand(zoomLevel);
  const hiddenReasons: HiddenGraphReason[] = [];

  let filteredEdges = edges.filter((edge) => edgeVisibility[edge.type]);
  if (filteredEdges.length < edges.length) addReason(hiddenReasons, 'edge_filter');

  if (showActiveOnly) {
    const before = filteredEdges.length;
    filteredEdges = filteredEdges.filter((edge) => edge.status === 'active');
    if (filteredEdges.length < before) addReason(hiddenReasons, 'active_filter');
  }

  let filteredNodes = nodes;
  if (zoomBand === 'overview') {
    const beforeNodeCount = filteredNodes.length;
    const beforeEdgeCount = filteredEdges.length;
    filteredNodes = filteredNodes.filter((node) => OVERVIEW_NODE_TYPES.has(node.type));
    filteredEdges = filteredEdges.filter((edge) => OVERVIEW_EDGE_TYPES.has(edge.type));
    if (filteredNodes.length < beforeNodeCount || filteredEdges.length < beforeEdgeCount) {
      addReason(hiddenReasons, 'overview_zoom');
    }
  } else if (zoomBand === 'standard') {
    const beforeNodeCount = filteredNodes.length;
    const beforeEdgeCount = filteredEdges.length;
    filteredNodes = filteredNodes.filter((node) => STANDARD_NODE_TYPES.has(node.type));
    filteredEdges = filteredEdges.filter((edge) => !STANDARD_HIDDEN_EDGE_TYPES.has(edge.type));
    if (filteredNodes.length < beforeNodeCount || filteredEdges.length < beforeEdgeCount) {
      addReason(hiddenReasons, 'standard_zoom');
    }
  }

  // Zoom is a display preference, never permission to erase a sparse recorded
  // frame whose taxonomy contains only detail nodes.
  if (filteredNodes.length === 0 && nodes.length > 0) {
    filteredNodes = nodes;
  }

  // Semantic zoom may reduce context, but it must not make the operator's
  // current selection disappear. Keep the selected recorded node visible;
  // its filtered relationships remain disclosed as hidden context.
  if (selectedNodeId && !filteredNodes.some((node) => node.id === selectedNodeId) && nodes.some((node) => node.id === selectedNodeId)) {
    filteredNodes = nodes.filter((node) => node.id === selectedNodeId || filteredNodes.some((visible) => visible.id === node.id));
  }

  if (showConnectedOnly) {
    const connected = new Set<string>();
    for (const edge of filteredEdges) {
      connected.add(edge.source);
      connected.add(edge.target);
    }
    if (selectedNodeId && filteredNodes.some((node) => node.id === selectedNodeId)) {
      connected.add(selectedNodeId);
    }
    const before = filteredNodes.length;
    filteredNodes = filteredNodes.filter((node) => connected.has(node.id));
    if (filteredNodes.length < before) addReason(hiddenReasons, 'connected_only');
  }

  if (focusModeEnabled && selectedNodeId) {
    const neighborhood = getFocusNeighborhood(
      selectedNodeId,
      filteredEdges.map((edge) => ({
        source: edge.source,
        target: edge.target,
      })),
      focusDepth,
    );
    const beforeNodeCount = filteredNodes.length;
    const beforeEdgeCount = filteredEdges.length;
    filteredNodes = filteredNodes.filter((node) => neighborhood.has(node.id));
    filteredEdges = filteredEdges.filter((edge) => neighborhood.has(edge.source) && neighborhood.has(edge.target));
    if (filteredNodes.length < beforeNodeCount || filteredEdges.length < beforeEdgeCount) {
      addReason(hiddenReasons, 'focus_mode');
    }
  }

  const nodeIds = new Set(filteredNodes.map((node) => node.id));
  filteredEdges = filteredEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  const visibleEdgeCount = filteredEdges.length;
  let outputEdges = filteredEdges;
  if (bundleEdges) {
    outputEdges = groupEdgesForBundling(filteredEdges).map((group) => {
      const primary = group.edges[0];
      return {
        ...primary,
        id: group.count > 1 ? `bundle:${group.key}` : primary.id,
        label: group.count > 1 ? `${group.edgeType} ×${group.count}` : primary.label,
        metadata: {
          ...(primary.metadata ?? {}),
          bundled: group.count > 1,
          bundleCount: group.count,
          bundledEdgeIds: group.edges.map((edge) => edge.id),
        },
      };
    });
  }

  const hiddenNodeCount = Math.max(0, nodes.length - filteredNodes.length);
  const hiddenEdgeCount = Math.max(0, edges.length - visibleEdgeCount);
  const hiddenContext =
    hiddenNodeCount > 0 || hiddenEdgeCount > 0
      ? {
          kind: 'hidden_recorded_context' as const,
          reasons: hiddenReasons,
          hiddenNodeCount,
          hiddenEdgeCount,
          disclosure: `Recorded context hidden by ${hiddenReasons.map((reason) => REASON_LABELS[reason]).join(', ') || 'display configuration'}: ${hiddenNodeCount} nodes, ${hiddenEdgeCount} edges.`,
          inspectHint: 'Reveal all context to clear display filters and open the detail zoom band.',
        }
      : null;

  const selectedHasRecordedRelationships = selectedNodeId ? edges.some((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId) : true;
  const relationshipContext =
    selectedNodeId && !selectedHasRecordedRelationships
      ? {
          kind: 'missing_relationship_evidence' as const,
          disclosure: 'No recorded relationship evidence for the selected node at this frame.',
        }
      : null;

  return {
    nodes: filteredNodes,
    edges: outputEdges,
    visibleEdgeCount,
    renderedEdgeCount: outputEdges.length,
    totalEdgeCount: edges.length,
    zoomBand,
    hiddenContext,
    relationshipContext,
  };
}
