"""
Core graph data models for multi-agent organizational graphs.

Defines nodes, edges, snapshots, diffs, and temporal graph structures
that power the AgentLens visualization and replay system.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# 鈹€鈹€鈹€ Enums 鈹€鈹€鈹€


class NodeType(str, Enum):
    """Types of nodes in the organizational graph."""

    AGENT = "agent"
    HUMAN = "human"
    TASK = "task"
    TOOL = "tool"
    MEMORY = "memory"
    TEAM = "team"
    ARTIFACT = "artifact"


class EdgeType(str, Enum):
    """Types of edges (relationships) in the organizational graph."""

    DELEGATION = "delegation"
    CRITIQUE = "critique"
    DEPENDENCY = "dependency"
    REVIEW = "review"
    ESCALATION = "escalation"
    APPROVAL = "approval"
    DATA_FLOW = "data_flow"
    MEMBER_OF = "member_of"  # Agent 鈫?Team membership
    PRODUCES = "produces"  # Agent/Task 鈫?Artifact
    USES = "uses"  # Agent/Task 鈫?Tool


class NodeStatus(str, Enum):
    """Visual status of a node."""

    IDLE = "idle"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    WAITING = "waiting"
    REVIEWING = "reviewing"


class EdgeStatus(str, Enum):
    """Visual status of an edge."""

    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


# 鈹€鈹€鈹€ Core Models 鈹€鈹€鈹€


class NodePosition(BaseModel):
    """2D position for graph layout."""

    x: float = 0.0
    y: float = 0.0


class Node(BaseModel):
    """A node in the organizational graph."""

    id: str
    type: NodeType
    label: str
    status: NodeStatus = NodeStatus.IDLE

    # Position for rendering
    position: NodePosition = Field(default_factory=NodePosition)

    # Type-specific data
    agent_id: str | None = None
    agent_role: str | None = None
    agent_team: str | None = None
    confidence: float | None = None

    # Visual properties
    color: str | None = None
    icon: str | None = None
    size: float = 1.0

    # Semantic zoom levels
    summary: str | None = None  # Shown when zoomed out
    detail: dict[str, Any] | None = None  # Shown when zoomed in

    # Timestamps
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Metadata
    metadata: dict[str, Any] = Field(default_factory=dict)
    span_id: str | None = None
    trace_id: str | None = None


class Edge(BaseModel):
    """An edge (relationship) in the organizational graph."""

    id: str
    source: str  # Source node ID
    target: str  # Target node ID
    type: EdgeType
    label: str | None = None
    status: EdgeStatus = EdgeStatus.PENDING

    # Edge-specific data
    weight: float = 1.0
    animated: bool = False

    # Visual properties
    color: str | None = None
    style: str = "default"  # default, dashed, dotted

    # Timestamps
    created_at: datetime | None = None
    activated_at: datetime | None = None

    # Metadata
    metadata: dict[str, Any] = Field(default_factory=dict)
    span_id: str | None = None


class GraphSnapshot(BaseModel):
    """
    Immutable snapshot of the graph at a specific point in time.

    Used for replay: a mission's execution is represented as
    an ordered sequence of GraphSnapshots.
    """

    id: str
    mission_id: str
    sequence_num: int
    timestamp: datetime

    nodes: list[Node]
    edges: list[Edge]

    # Metadata about this snapshot
    event_type: str | None = None  # What triggered this snapshot
    event_description: str | None = None
    phase: str | None = None  # Mission phase at this point

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}


class DiffEntry(BaseModel):
    """A single change between two graph states."""

    action: str  # "added", "removed", "modified"
    entity_type: str  # "node" or "edge"
    entity_id: str
    field: str | None = None  # Which field changed (for modifications)
    old_value: Any | None = None
    new_value: Any | None = None


class GraphDiff(BaseModel):
    """Diff between two GraphSnapshots."""

    from_snapshot: str  # Snapshot ID
    to_snapshot: str  # Snapshot ID
    changes: list[DiffEntry]

    @property
    def additions(self) -> list[DiffEntry]:
        return [c for c in self.changes if c.action == "added"]

    @property
    def removals(self) -> list[DiffEntry]:
        return [c for c in self.changes if c.action == "removed"]

    @property
    def modifications(self) -> list[DiffEntry]:
        return [c for c in self.changes if c.action == "modified"]


class TemporalGraph(BaseModel):
    """
    A time-series of graph snapshots representing the full
    evolution of a mission's organizational graph.

    This is the primary data structure for the replay engine.
    """

    mission_id: str
    snapshots: list[GraphSnapshot] = Field(default_factory=list)

    @property
    def duration(self) -> float | None:
        """Duration in seconds from first to last snapshot."""
        if len(self.snapshots) < 2:
            return None
        first = self.snapshots[0].timestamp
        last = self.snapshots[-1].timestamp
        return (last - first).total_seconds()

    @property
    def total_frames(self) -> int:
        return len(self.snapshots)

    def snapshot_at(self, index: int) -> GraphSnapshot | None:
        """Get snapshot at a specific index."""
        if 0 <= index < len(self.snapshots):
            return self.snapshots[index]
        return None

    def snapshots_between(
        self, start: datetime, end: datetime
    ) -> list[GraphSnapshot]:
        """Get all snapshots within a time range."""
        return [
            s
            for s in self.snapshots
            if start <= s.timestamp <= end
        ]

    def diff(self, from_idx: int, to_idx: int) -> GraphDiff | None:
        """Compute diff between two snapshot indices."""
        from_snap = self.snapshot_at(from_idx)
        to_snap = self.snapshot_at(to_idx)
        if not from_snap or not to_snap:
            return None

        changes: list[DiffEntry] = []

        # Compare nodes
        from_nodes = {n.id: n for n in from_snap.nodes}
        to_nodes = {n.id: n for n in to_snap.nodes}

        for nid in to_nodes:
            if nid not in from_nodes:
                changes.append(
                    DiffEntry(
                        action="added", entity_type="node", entity_id=nid
                    )
                )
            elif to_nodes[nid] != from_nodes[nid]:
                # Find changed fields
                for field_name in to_nodes[nid].model_fields:
                    old_val = getattr(from_nodes[nid], field_name)
                    new_val = getattr(to_nodes[nid], field_name)
                    if old_val != new_val:
                        changes.append(
                            DiffEntry(
                                action="modified",
                                entity_type="node",
                                entity_id=nid,
                                field=field_name,
                                old_value=old_val,
                                new_value=new_val,
                            )
                        )

        for nid in from_nodes:
            if nid not in to_nodes:
                changes.append(
                    DiffEntry(
                        action="removed", entity_type="node", entity_id=nid
                    )
                )

        # Compare edges
        from_edges = {e.id: e for e in from_snap.edges}
        to_edges = {e.id: e for e in to_snap.edges}

        for eid in to_edges:
            if eid not in from_edges:
                changes.append(
                    DiffEntry(
                        action="added", entity_type="edge", entity_id=eid
                    )
                )

        for eid in from_edges:
            if eid not in to_edges:
                changes.append(
                    DiffEntry(
                        action="removed", entity_type="edge", entity_id=eid
                    )
                )

        return GraphDiff(
            from_snapshot=from_snap.id,
            to_snapshot=to_snap.id,
            changes=changes,
        )
