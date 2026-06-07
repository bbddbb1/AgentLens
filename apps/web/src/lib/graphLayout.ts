import type { GraphEdge, GraphNode } from '@agentlens/protocol';

const SPACING_X = 300;
const SPACING_Y = 220;
const SATELLITE_GAP_X = 240;
const SATELLITE_GAP_Y = 160;

const SATELLITE_TYPES = new Set(['tool', 'memory', 'artifact', 'task']);
const SATELLITE_EDGE_TYPES = new Set(['uses', 'dependency', 'data_flow', 'produces']);

function cloneNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
  }));
}

function positionAgentLayer(nodes: GraphNode[], edges: GraphEdge[]): void {
  const children = new Map<string, string[]>();
  const hasParent = new Set<string>();

  for (const edge of edges) {
    if (edge.type !== 'delegation' && edge.type !== 'member_of') continue;
    const list = children.get(edge.source) ?? [];
    list.push(edge.target);
    children.set(edge.source, list);
    hasParent.add(edge.target);
  }

  const agentLike = nodes.filter((node) => !SATELLITE_TYPES.has(node.type));
  let roots = agentLike.filter((node) => !hasParent.has(node.id)).map((node) => node.id);
  if (roots.length === 0 && agentLike.length > 0) {
    roots = [agentLike[0].id];
  }

  const levels = new Map<string, number>();
  const queue: Array<{ id: string; level: number }> = roots.map((id) => ({ id, level: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    levels.set(current.id, current.level);
    for (const childId of children.get(current.id) ?? []) {
      if (!visited.has(childId)) {
        queue.push({ id: childId, level: current.level + 1 });
      }
    }
  }

  const levelCounts = new Map<number, number>();
  for (const node of agentLike) {
    const level = levels.get(node.id) ?? 0;
    const index = levelCounts.get(level) ?? 0;
    levelCounts.set(level, index + 1);
    node.position = {
      x: index * SPACING_X,
      y: level * SPACING_Y,
    };
  }

  const levelWidths = new Map<number, number>();
  for (const [level, count] of levelCounts) {
    levelWidths.set(level, (count - 1) * SPACING_X);
  }
  const maxWidth = Math.max(0, ...levelWidths.values());

  for (const node of agentLike) {
    const level = levels.get(node.id) ?? 0;
    const width = levelWidths.get(level) ?? 0;
    node.position.x += (maxWidth - width) / 2;
  }
}

function positionSatellites(nodes: GraphNode[], edges: GraphEdge[]): void {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const satellitesByParent = new Map<string, GraphNode[]>();

  for (const edge of edges) {
    if (!SATELLITE_EDGE_TYPES.has(edge.type)) continue;
    const satellite = nodesById.get(edge.target);
    if (!satellite || !SATELLITE_TYPES.has(satellite.type)) continue;

    const list = satellitesByParent.get(edge.source) ?? [];
    if (!list.some((node) => node.id === satellite.id)) {
      list.push(satellite);
      satellitesByParent.set(edge.source, list);
    }
  }

  for (const [, satellites] of satellitesByParent) {
    const tasks = satellites.filter((node) => node.type === 'task');
    const others = satellites.filter((node) => node.type !== 'task');
    const parent = satellites[0]
      ? nodesById.get(
          edges.find((edge) => edge.target === satellites[0].id)?.source ?? '',
        )
      : undefined;

    if (!parent) continue;

    tasks.forEach((node, index) => {
      const offset = (index - (tasks.length - 1) / 2) * SATELLITE_GAP_X;
      node.position = {
        x: parent.position.x + offset,
        y: parent.position.y + SATELLITE_GAP_Y,
      };
    });

    others.forEach((node, index) => {
      const offset = (index - (others.length - 1) / 2) * SATELLITE_GAP_X;
      node.position = {
        x: parent.position.x + offset,
        y: parent.position.y + SATELLITE_GAP_Y * 2,
      };
    });
  }

  let orphanIndex = 0;
  for (const node of nodes) {
    if (!SATELLITE_TYPES.has(node.type)) continue;
    const hasParent = edges.some((edge) => edge.target === node.id);
    if (hasParent) continue;
    node.position = {
      x: orphanIndex * SATELLITE_GAP_X,
      y: SPACING_Y * 3,
    };
    orphanIndex += 1;
  }
}

export function applyClientLayout(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const laidOut = cloneNodes(nodes);
  if (laidOut.length === 0) return laidOut;

  positionAgentLayer(laidOut, edges);
  positionSatellites(laidOut, edges);
  return laidOut;
}
