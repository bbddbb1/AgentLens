"""
Graph layout algorithms for automatic positioning of nodes.
"""

from __future__ import annotations

import math

from agentlens_graph_engine.models import Edge, GraphSnapshot, Node, NodePosition


def apply_hierarchical_layout(
    snapshot: GraphSnapshot,
    spacing_x: float = 250.0,
    spacing_y: float = 150.0,
) -> GraphSnapshot:
    """
    Apply a simple hierarchical (top-down) layout based on delegation depth.

    Roots are nodes with no incoming delegation edges.
    Each level is positioned further down.
    """
    nodes_by_id = {n.id: n for n in snapshot.nodes}
    edges = snapshot.edges

    # Build adjacency: source 鈫?[targets]
    children: dict[str, list[str]] = {}
    has_parent: set[str] = set()

    for edge in edges:
        children.setdefault(edge.source, []).append(edge.target)
        has_parent.add(edge.target)

    # Find root nodes (no incoming edges)
    roots = [n.id for n in snapshot.nodes if n.id not in has_parent]
    if not roots:
        # Fallback: use first node
        roots = [snapshot.nodes[0].id] if snapshot.nodes else []

    # BFS to assign levels
    levels: dict[str, int] = {}
    queue = [(r, 0) for r in roots]
    visited: set[str] = set()

    while queue:
        node_id, level = queue.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)
        levels[node_id] = level
        for child_id in children.get(node_id, []):
            if child_id not in visited:
                queue.append((child_id, level + 1))

    # Assign positions
    level_counts: dict[int, int] = {}
    for node in snapshot.nodes:
        level = levels.get(node.id, 0)
        count = level_counts.get(level, 0)
        level_counts[level] = count + 1

        node.position = NodePosition(
            x=count * spacing_x,
            y=level * spacing_y,
        )

    # Center each level horizontally
    level_widths: dict[int, float] = {}
    for level, count in level_counts.items():
        level_widths[level] = (count - 1) * spacing_x

    max_width = max(level_widths.values()) if level_widths else 0

    for node in snapshot.nodes:
        level = levels.get(node.id, 0)
        width = level_widths.get(level, 0)
        offset = (max_width - width) / 2
        node.position.x += offset

    return snapshot


def apply_force_directed_layout(
    snapshot: GraphSnapshot,
    iterations: int = 50,
    repulsion: float = 5000.0,
    attraction: float = 0.01,
    damping: float = 0.9,
) -> GraphSnapshot:
    """
    Simple force-directed layout for organic graph positioning.

    Uses repulsive forces between all nodes and attractive forces
    along edges, iterated to reach equilibrium.
    """
    if not snapshot.nodes:
        return snapshot

    # Initialize positions in a circle
    n = len(snapshot.nodes)
    radius = 300.0
    for i, node in enumerate(snapshot.nodes):
        angle = 2 * math.pi * i / n
        node.position = NodePosition(
            x=radius * math.cos(angle),
            y=radius * math.sin(angle),
        )

    nodes_by_id = {n.id: n for n in snapshot.nodes}
    velocities: dict[str, tuple[float, float]] = {
        n.id: (0.0, 0.0) for n in snapshot.nodes
    }

    for _ in range(iterations):
        forces: dict[str, tuple[float, float]] = {
            n.id: (0.0, 0.0) for n in snapshot.nodes
        }

        # Repulsive forces between all pairs
        for i, n1 in enumerate(snapshot.nodes):
            for n2 in snapshot.nodes[i + 1 :]:
                dx = n1.position.x - n2.position.x
                dy = n1.position.y - n2.position.y
                dist_sq = dx * dx + dy * dy + 1.0
                force = repulsion / dist_sq
                dist = math.sqrt(dist_sq)
                fx = force * dx / dist
                fy = force * dy / dist
                forces[n1.id] = (forces[n1.id][0] + fx, forces[n1.id][1] + fy)
                forces[n2.id] = (forces[n2.id][0] - fx, forces[n2.id][1] - fy)

        # Attractive forces along edges
        for edge in snapshot.edges:
            if edge.source in nodes_by_id and edge.target in nodes_by_id:
                n1 = nodes_by_id[edge.source]
                n2 = nodes_by_id[edge.target]
                dx = n2.position.x - n1.position.x
                dy = n2.position.y - n1.position.y
                dist = math.sqrt(dx * dx + dy * dy) + 1.0
                fx = attraction * dx
                fy = attraction * dy
                forces[n1.id] = (forces[n1.id][0] + fx, forces[n1.id][1] + fy)
                forces[n2.id] = (forces[n2.id][0] - fx, forces[n2.id][1] - fy)

        # Apply forces with damping
        for node in snapshot.nodes:
            vx, vy = velocities[node.id]
            fx, fy = forces[node.id]
            vx = (vx + fx) * damping
            vy = (vy + fy) * damping
            node.position.x += vx
            node.position.y += vy
            velocities[node.id] = (vx, vy)

    return snapshot
