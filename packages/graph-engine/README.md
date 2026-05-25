# agentlens-graph-engine

Graph data model and algorithms for multi-agent organizational graphs.

## Overview

This package provides Pydantic models for representing multi-agent interaction graphs — agents, tasks, tools, memories, artifacts, and the edges between them. It is used by the TypeScript control plane's replay engine to ensure structural consistency across snapshots.

## Models

- **`GraphNode`** — A node in the mission graph (agent, task, tool, memory, artifact, human).
- **`GraphEdge`** — A directed edge between two nodes (delegation, critique, review, data_flow, produces, escalation).
- **`GraphSnapshot`** — A point-in-time capture of the full node + edge state.

## Usage

```python
from agentlens_graph_engine import GraphNode, GraphEdge, NodeType, EdgeType

node = GraphNode(
    id="planner-01",
    type=NodeType.AGENT,
    label="Planner",
    status="active",
)

edge = GraphEdge(
    id="edge-1",
    source="planner-01",
    target="task-deploy",
    type=EdgeType.DEPENDENCY,
    status="active",
)
```

## Dependencies

- `pydantic` (v2+) — Data validation and serialization

## Tests

```bash
uv run pytest packages/graph-engine/tests
```
