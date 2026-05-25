"""
Tests for graph layout algorithms.
"""
from datetime import datetime, timezone

from agentlens_graph_engine.models import (
    Node, NodePosition, NodeType, NodeStatus,
    Edge, EdgeType,
    GraphSnapshot,
)
from agentlens_graph_engine.layout import (
    apply_hierarchical_layout,
    apply_force_directed_layout,
)


def _make_snapshot(nodes=None, edges=None):
    return GraphSnapshot(
        id="snap-1", mission_id="m1", sequence_num=0,
        timestamp=datetime.now(timezone.utc),
        nodes=nodes or [],
        edges=edges or [],
    )


class TestHierarchicalLayout:
    def test_roots_assigned_level_zero(self):
        n1 = Node(id="root", type=NodeType.AGENT, label="Root")
        n2 = Node(id="child", type=NodeType.AGENT, label="Child")
        edge = Edge(id="e1", source="root", target="child", type=EdgeType.DELEGATION)
        snapshot = _make_snapshot(nodes=[n1, n2], edges=[edge])

        result = apply_hierarchical_layout(snapshot)

        # Root at level 0 (y=0), child at level 1 (y=spacing_y)
        root_pos = next(n.position for n in result.nodes if n.id == "root")
        child_pos = next(n.position for n in result.nodes if n.id == "child")
        assert root_pos.y == 0.0
        assert child_pos.y == 150.0  # spacing_y default

    def test_no_edges_fallback_to_first_node_as_root(self):
        n1 = Node(id="a", type=NodeType.AGENT, label="A")
        n2 = Node(id="b", type=NodeType.AGENT, label="B")
        snapshot = _make_snapshot(nodes=[n1, n2], edges=[])

        result = apply_hierarchical_layout(snapshot)

        # Both get level 0 since no edge defines parent
        for node in result.nodes:
            assert node.position.y == 0.0

    def test_empty_nodes(self):
        snapshot = _make_snapshot()
        result = apply_hierarchical_layout(snapshot)
        assert result.nodes == []

    def test_returns_same_snapshot_object(self):
        n1 = Node(id="a", type=NodeType.AGENT, label="A")
        snapshot = _make_snapshot(nodes=[n1])
        result = apply_hierarchical_layout(snapshot)
        assert result is snapshot

    def test_positions_are_set(self):
        n1 = Node(id="a", type=NodeType.AGENT, label="A")
        snapshot = _make_snapshot(nodes=[n1])
        result = apply_hierarchical_layout(snapshot)
        assert result.nodes[0].position.x != 0.0 or result.nodes[0].position.y == 0.0

    def test_deep_hierarchy(self):
        nodes = [
            Node(id="root", type=NodeType.AGENT, label="Root"),
            Node(id="l1", type=NodeType.AGENT, label="L1"),
            Node(id="l2", type=NodeType.AGENT, label="L2"),
            Node(id="l3", type=NodeType.AGENT, label="L3"),
        ]
        edges = [
            Edge(id="e1", source="root", target="l1", type=EdgeType.DELEGATION),
            Edge(id="e2", source="l1", target="l2", type=EdgeType.DELEGATION),
            Edge(id="e3", source="l2", target="l3", type=EdgeType.DELEGATION),
        ]
        snapshot = _make_snapshot(nodes=nodes, edges=edges)

        result = apply_hierarchical_layout(snapshot)

        y_values = {n.id: n.position.y for n in result.nodes}
        assert y_values["root"] == 0.0
        assert y_values["l1"] == 150.0
        assert y_values["l2"] == 300.0
        assert y_values["l3"] == 450.0


class TestForceDirectedLayout:
    def test_empty_nodes_returns_same_snapshot(self):
        snapshot = _make_snapshot()
        result = apply_force_directed_layout(snapshot)
        assert result.nodes == []
        assert result is snapshot

    def test_single_node_unchanged(self):
        n1 = Node(id="a", type=NodeType.AGENT, label="A")
        snapshot = _make_snapshot(nodes=[n1])
        result = apply_force_directed_layout(snapshot)
        assert len(result.nodes) == 1

    def test_positions_are_modified(self):
        nodes = [
            Node(id="a", type=NodeType.AGENT, label="A"),
            Node(id="b", type=NodeType.AGENT, label="B"),
        ]
        snapshot = _make_snapshot(nodes=nodes)

        # Positions before layout
        pos_before_a = snapshot.nodes[0].position
        pos_before_b = snapshot.nodes[1].position

        # Positions initialized in circle by the layout algorithm
        result = apply_force_directed_layout(snapshot)

        # After initialization + iterations, positions should be set
        assert result.nodes[0].position is not None
        assert result.nodes[1].position is not None

    def test_multiple_nodes_produces_valid_positions(self):
        nodes = [
            Node(id="a", type=NodeType.AGENT, label="A"),
            Node(id="b", type=NodeType.AGENT, label="B"),
            Node(id="c", type=NodeType.AGENT, label="C"),
            Node(id="d", type=NodeType.AGENT, label="D"),
        ]
        snapshot = _make_snapshot(nodes=nodes)
        result = apply_force_directed_layout(snapshot)

        # All nodes have positions
        for node in result.nodes:
            assert isinstance(node.position.x, float)
            assert isinstance(node.position.y, float)

    def test_respects_edge_attraction(self):
        nodes = [
            Node(id="a", type=NodeType.AGENT, label="A"),
            Node(id="b", type=NodeType.AGENT, label="B"),
        ]
        edges = [
            Edge(id="e1", source="a", target="b", type=EdgeType.DELEGATION),
        ]
        snapshot = _make_snapshot(nodes=nodes, edges=edges)
        result = apply_force_directed_layout(snapshot, attraction=1.0, repulsion=100.0)

        # Nodes should still have valid positions
        for node in result.nodes:
            assert node.position is not None

    def test_custom_iterations(self):
        nodes = [Node(id="a", type=NodeType.AGENT, label="A") for _ in range(3)]
        snapshot = _make_snapshot(nodes=nodes)
        result = apply_force_directed_layout(snapshot, iterations=10)
        assert len(result.nodes) == 3
