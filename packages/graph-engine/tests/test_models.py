"""
Tests for graph-engine data models.
"""
from datetime import datetime, timezone

import pytest

from agentlens_graph_engine.models import (
    Node,
    Edge,
    NodePosition,
    NodeType,
    NodeStatus,
    EdgeType,
    EdgeStatus,
    GraphSnapshot,
    GraphDiff,
    DiffEntry,
    TemporalGraph,
)


def _make_node(node_id="n1", **overrides):
    return Node(
        id=node_id,
        type=overrides.get("type", NodeType.AGENT),
        label=overrides.get("label", "Test Agent"),
        status=overrides.get("status", NodeStatus.IDLE),
        **{k: v for k, v in overrides.items() if k not in ("type", "label", "status")},
    )


def _make_edge(edge_id="e1", source="n1", target="n2", **overrides):
    return Edge(
        id=edge_id,
        source=source,
        target=target,
        type=overrides.get("type", EdgeType.DELEGATION),
        **{k: v for k, v in overrides.items() if k != "type"},
    )


def _make_snapshot(snapshot_id="snap-1", mission_id="m1", sequence_num=0, **overrides):
    base = {
        "timestamp": datetime.now(timezone.utc),
        "nodes": [],
        "edges": [],
    }
    for key in ("timestamp", "nodes", "edges", "event_type", "event_description", "phase"):
        if key in overrides:
            base[key] = overrides.pop(key)
    base.update(overrides)
    return GraphSnapshot(
        id=snapshot_id,
        mission_id=mission_id,
        sequence_num=sequence_num,
        **base,
    )


class TestNodeType:
    def test_all_node_types(self):
        assert NodeType.AGENT == "agent"
        assert NodeType.HUMAN == "human"
        assert NodeType.TASK == "task"
        assert NodeType.TOOL == "tool"
        assert NodeType.MEMORY == "memory"
        assert NodeType.TEAM == "team"
        assert NodeType.ARTIFACT == "artifact"


class TestEdgeType:
    def test_all_edge_types(self):
        assert EdgeType.DELEGATION == "delegation"
        assert EdgeType.CRITIQUE == "critique"
        assert EdgeType.DEPENDENCY == "dependency"
        assert EdgeType.REVIEW == "review"
        assert EdgeType.ESCALATION == "escalation"
        assert EdgeType.DATA_FLOW == "data_flow"
        assert EdgeType.PRODUCES == "produces"
        assert EdgeType.USES == "uses"


class TestNode:
    def test_default_position(self):
        node = _make_node()
        assert node.position.x == 0.0
        assert node.position.y == 0.0

    def test_default_status(self):
        node = Node(id="n1", type=NodeType.AGENT, label="Agent")
        assert node.status == NodeStatus.IDLE

    def test_default_metadata(self):
        node = _make_node()
        assert node.metadata == {}

    def test_optional_fields_none_by_default(self):
        node = _make_node()
        assert node.agent_id is None
        assert node.agent_role is None
        assert node.agent_team is None
        assert node.confidence is None
        assert node.summary is None
        assert node.detail is None

    def test_can_set_optional_fields(self):
        node = _make_node(
            agent_id="agent-42",
            agent_role="researcher",
            agent_team="search",
            confidence=0.95,
            summary="Research agent",
            detail={"skills": ["search", "analyze"]},
        )
        assert node.agent_id == "agent-42"
        assert node.agent_role == "researcher"
        assert node.confidence == 0.95

    def test_position_can_be_set(self):
        node = _make_node(position=NodePosition(x=100.0, y=200.0))
        assert node.position.x == 100.0
        assert node.position.y == 200.0

    def test_node_types(self):
        for nt in NodeType:
            node = Node(id="n", type=nt, label=str(nt))
            assert node.type == nt


class TestEdge:
    def test_default_status(self):
        edge = _make_edge()
        assert edge.status == EdgeStatus.PENDING

    def test_default_weight(self):
        edge = _make_edge()
        assert edge.weight == 1.0

    def test_label_is_optional(self):
        edge = _make_edge(label=None)
        assert edge.label is None

    def test_label_can_be_set(self):
        edge = _make_edge(label="delegates to")
        assert edge.label == "delegates to"


class TestGraphSnapshot:
    def test_snapshot_creation(self):
        node = _make_node()
        edge = _make_edge()
        ts = datetime.now(timezone.utc)
        snapshot = GraphSnapshot(
            id="snap-1", mission_id="m1", sequence_num=0,
            timestamp=ts, nodes=[node], edges=[edge],
        )
        assert snapshot.id == "snap-1"
        assert snapshot.mission_id == "m1"
        assert snapshot.sequence_num == 0
        assert len(snapshot.nodes) == 1
        assert len(snapshot.edges) == 1

    def test_optional_metadata_fields(self):
        snapshot = _make_snapshot(
            event_type="agent.registered",
            event_description="New agent joined",
            phase="executing",
        )
        assert snapshot.event_type == "agent.registered"
        assert snapshot.event_description == "New agent joined"
        assert snapshot.phase == "executing"

    def test_empty_nodes_and_edges(self):
        snapshot = _make_snapshot()
        assert snapshot.nodes == []
        assert snapshot.edges == []


class TestDiffEntry:
    def test_addition_entry(self):
        entry = DiffEntry(action="added", entity_type="node", entity_id="n1")
        assert entry.action == "added"
        assert entry.entity_id == "n1"

    def test_modification_entry(self):
        entry = DiffEntry(
            action="modified", entity_type="node", entity_id="n1",
            field="status", old_value="idle", new_value="active",
        )
        assert entry.field == "status"
        assert entry.old_value == "idle"
        assert entry.new_value == "active"

    def test_removal_entry(self):
        entry = DiffEntry(action="removed", entity_type="edge", entity_id="e1")
        assert entry.action == "removed"


class TestGraphDiff:
    def _make_diff(self, changes=None):
        return GraphDiff(
            from_snapshot="snap-1",
            to_snapshot="snap-2",
            changes=changes or [],
        )

    def test_additions_property(self):
        diff = self._make_diff([
            DiffEntry(action="added", entity_type="node", entity_id="n1"),
            DiffEntry(action="added", entity_type="node", entity_id="n2"),
            DiffEntry(action="removed", entity_type="node", entity_id="n3"),
        ])
        assert len(diff.additions) == 2

    def test_removals_property(self):
        diff = self._make_diff([
            DiffEntry(action="added", entity_type="node", entity_id="n1"),
            DiffEntry(action="removed", entity_type="node", entity_id="n3"),
        ])
        assert len(diff.removals) == 1

    def test_modifications_property(self):
        diff = self._make_diff([
            DiffEntry(action="modified", entity_type="node", entity_id="n1", field="status"),
            DiffEntry(action="added", entity_type="node", entity_id="n2"),
        ])
        assert len(diff.modifications) == 1


class TestTemporalGraph:
    def _make_temporal(self, mission_id="m1", num_snapshots=3):
        snapshots = []
        base_time = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for i in range(num_snapshots):
            snapshots.append(GraphSnapshot(
                id=f"snap-{i}", mission_id=mission_id, sequence_num=i,
                timestamp=base_time.replace(hour=i),
                nodes=[], edges=[],
            ))
        return TemporalGraph(mission_id=mission_id, snapshots=snapshots)

    def test_total_frames(self):
        tg = self._make_temporal(num_snapshots=5)
        assert tg.total_frames == 5

    def test_total_frames_empty(self):
        tg = self._make_temporal(num_snapshots=0)
        assert tg.total_frames == 0

    def test_duration_returns_none_for_few_snapshots(self):
        tg = self._make_temporal(num_snapshots=1)
        assert tg.duration is None

    def test_duration_computes_seconds(self):
        tg = TemporalGraph(mission_id="m1", snapshots=[
            GraphSnapshot(
                id="snap-0", mission_id="m1", sequence_num=0,
                timestamp=datetime(2026, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
                nodes=[], edges=[],
            ),
            GraphSnapshot(
                id="snap-1", mission_id="m1", sequence_num=1,
                timestamp=datetime(2026, 1, 1, 1, 0, 0, tzinfo=timezone.utc),
                nodes=[], edges=[],
            ),
        ])
        assert tg.duration == 3600.0

    def test_snapshot_at_valid_index(self):
        tg = self._make_temporal(num_snapshots=3)
        snap = tg.snapshot_at(1)
        assert snap is not None
        assert snap.id == "snap-1"

    def test_snapshot_at_negative_index(self):
        tg = self._make_temporal(num_snapshots=3)
        assert tg.snapshot_at(-1) is None

    def test_snapshot_at_out_of_bounds(self):
        tg = self._make_temporal(num_snapshots=3)
        assert tg.snapshot_at(5) is None

    def test_snapshots_between_time_range(self):
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        tg = TemporalGraph(mission_id="m1", snapshots=[
            GraphSnapshot(id="s0", mission_id="m1", sequence_num=0,
                          timestamp=base.replace(hour=0), nodes=[], edges=[]),
            GraphSnapshot(id="s1", mission_id="m1", sequence_num=1,
                          timestamp=base.replace(hour=1), nodes=[], edges=[]),
            GraphSnapshot(id="s2", mission_id="m1", sequence_num=2,
                          timestamp=base.replace(hour=2), nodes=[], edges=[]),
        ])

        result = tg.snapshots_between(
            start=base.replace(hour=0, minute=30),
            end=base.replace(hour=1, minute=30),
        )
        assert len(result) == 1
        assert result[0].id == "s1"

    def test_diff_between_snapshots(self):
        tg = TemporalGraph(mission_id="m1", snapshots=[
            GraphSnapshot(
                id="snap-0", mission_id="m1", sequence_num=0,
                timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
                nodes=[_make_node("n1", label="Original")],
                edges=[],
            ),
            GraphSnapshot(
                id="snap-1", mission_id="m1", sequence_num=1,
                timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc),
                nodes=[
                    _make_node("n1", label="Modified"),
                    _make_node("n2", label="New"),
                ],
                edges=[],
            ),
        ])

        diff = tg.diff(0, 1)
        assert diff is not None
        assert diff.from_snapshot == "snap-0"
        assert diff.to_snapshot == "snap-1"
        assert len(diff.additions) >= 1  # n2 added
        assert len(diff.modifications) >= 1  # n1 label changed

    def test_diff_same_snapshot_no_changes(self):
        node = _make_node("n1")
        snap = GraphSnapshot(
            id="snap-0", mission_id="m1", sequence_num=0,
            timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
            nodes=[node], edges=[],
        )
        tg = TemporalGraph(mission_id="m1", snapshots=[snap, snap])
        diff = tg.diff(0, 1)
        assert diff is not None
        assert len(diff.changes) == 0

    def test_diff_null_for_invalid_indices(self):
        tg = self._make_temporal(num_snapshots=1)
        assert tg.diff(0, 5) is None


class TestEdgeStatus:
    def test_all_statuses(self):
        assert EdgeStatus.PENDING == "pending"
        assert EdgeStatus.ACTIVE == "active"
        assert EdgeStatus.COMPLETED == "completed"
        assert EdgeStatus.FAILED == "failed"


class TestNodeStatus:
    def test_all_statuses(self):
        assert NodeStatus.IDLE == "idle"
        assert NodeStatus.ACTIVE == "active"
        assert NodeStatus.COMPLETED == "completed"
        assert NodeStatus.FAILED == "failed"
        assert NodeStatus.WAITING == "waiting"
        assert NodeStatus.REVIEWING == "reviewing"
