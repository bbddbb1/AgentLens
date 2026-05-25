# agentlens-sdk-core

Core instrumentation SDK for AgentLens multi-agent observability.

## Overview

`agentlens-sdk-core` is the Python instrumentation layer that exports OpenTelemetry spans and events to the AgentLens control plane. It provides:

- **`AgentLens` client** — HTTP client for connecting to the AgentLens API with optional bearer-token auth.
- **`Mission` context manager** — Start and manage multi-agent missions.
- **`AgentInstrumentor`** — Record agent actions as typed spans: handoffs, critiques, tool calls, memory writes, escalations, interrupts, and more.
- **`OTLPSpanExporter`** — Batch-oriented OTLP exporter that pushes spans to `POST /v1/traces`.

## Quick Start

```python
from agentlens_sdk import AgentLens, Mission

lens = AgentLens(endpoint="http://localhost:8001")

with lens.mission("objective") as mission:
    with mission.agent("planner") as agent:
        agent.set_task("Plan the deployment")
        agent.set_confidence(0.9)
        agent.record_tool_call("jira_api", {"query": "..."}, {"tickets": [...]})
        agent.request_human_review("Production release requires approval")
```

## API Reference

See [docs/agent.md](../../docs/agent.md) for the full event model and semantic conventions.

## Dependencies

- `opentelemetry-api` / `opentelemetry-sdk` — Span creation and export
- `opentelemetry-exporter-otlp-proto-http` — OTLP/HTTP transport
- `httpx` — Async HTTP client
- `agentlens-otel-semconv` — Semantic convention constants

## Tests

```bash
uv run pytest packages/sdk-core/tests
```
