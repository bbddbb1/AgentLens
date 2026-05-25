# agentlens-sdk-langgraph

LangGraph instrumentation adapter for AgentLens.

## Overview

This package provides a zero-code callback handler that automatically instruments [LangGraph](https://langchain-ai.github.io/langgraph/) graphs with AgentLens semantic conventions. Drop it into an existing LangGraph application and every node transition, tool call, and error becomes an observable event in the AgentLens control plane.

## Quick Start

```python
from agentlens_langgraph import AgentLensLangGraphCallbackHandler

handler = AgentLensLangGraphCallbackHandler(
    endpoint="http://localhost:8001",
    api_key="optional-bearer-token",
)

graph = build_your_langgraph_graph()
result = graph.invoke(
    {"topic": "design a feature"},
    config={"callbacks": [handler]},
)
```

## What Gets Instrumented

| LangGraph Callback | AgentLens Event |
|---|---|
| `on_chain_start` | Agent span created (node name → `agent.name`) |
| Node → Node transition | `agent.handoff.requested` + `agent.handoff.accepted` |
| `on_chain_end` | Handoff completion + memory write (node output) |
| `on_chain_error` | Agent span failed + handoff rejected |
| `on_tool_start` / `on_tool_end` | `agent.tool.call` + `agent.tool.result` |
| `on_tool_error` | `agent.tool.error` |

Framework-internal nodes (`LangGraph`, `RunnableSequence`, `RunnableParallel`, `StateGraph`) are automatically filtered out.

## Dependencies

- `agentlens-sdk-core` — Uses the AgentLens client and exporter under the hood
- `langgraph` — The LangGraph framework being instrumented
- `langchain-core` — Base callback interfaces

## Tests

```bash
uv run pytest packages/sdk-langgraph/tests
```
