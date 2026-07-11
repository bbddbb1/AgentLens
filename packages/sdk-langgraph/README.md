# agentlens-sdk-langgraph

LangGraph instrumentation adapter for AgentLens.

## Overview

This package provides a callback handler that instruments [LangGraph](https://langchain-ai.github.io/langgraph/) graphs with AgentLens semantic conventions. Drop it into an existing LangGraph application and node transitions, tool/LLM/retriever calls, and explicit errors become observable events in the AgentLens control plane.

For the executable observability matrix, fixture provenance, coverage limitations, and the private normalization boundary, see [docs/capability-matrix.md](docs/capability-matrix.md).

## Quick Start

```python
from agentlens_langgraph import auto_instrument

lens, mission, handler = auto_instrument(
    "Research AI",
    endpoint="http://localhost:8001",
    api_key="optional-bearer-token",
)

graph = build_your_langgraph_graph()
result = graph.invoke(
    {"topic": "design a feature"},
    config={"callbacks": [handler]},
)
```

You can also construct `AgentLensLangGraphCallbackHandler(lens, mission)` when you already own an `AgentLens` client and mission.

## What Gets Instrumented

| LangGraph Callback | AgentLens Telemetry |
|---|---|
| `on_chain_start` / `on_chain_end` / `on_chain_error` | Agent span + native run/thread/checkpoint refs when present |
| Parent/child nesting | Correlation via `run_id` / `parent_run_id` (**not** handoff) |
| Explicit handoff metadata | `agent.handoff.requested` with `agentlens.langgraph.explicit_handoff=true` (not `goto`/routing) |
| `on_tool_*` | `agent.tool.call` with distinct run/correlation IDs |
| `on_llm_*` / `on_chat_model_*` | `gen_ai.call` (+ token usage when provider metadata exists) |
| `on_retriever_*` | Tool-like event marked `agentlens.langgraph.retrieval=true` |
| Explicit `__interrupt__` / resume markers | Interrupt request/resume **observation** only (no control actions) |

Framework-internal nodes (`LangGraph`, `RunnableSequence`, `RunnableParallel`, `StateGraph`) are automatically filtered out.

## Observational native identity

Stable identifiers (`run_id`, `thread_id`, checkpoint refs, optional `native_execution_key`) are observational provenance for a future governance bridge. They are **not** executable control references. Approval/resume controls and checkpoint payload capture are deferred.

## Dependencies

- `agentlens-sdk-core` — Uses the AgentLens client and exporter under the hood
- `langgraph` — The LangGraph framework being instrumented
- `langchain-core` — Base callback interfaces

## Tests

```bash
uv run pytest packages/sdk-langgraph/tests
```
