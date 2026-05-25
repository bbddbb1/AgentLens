# agentlens-otel-semconv

OpenTelemetry semantic conventions for multi-agent AI systems.

## Overview

This package defines the canonical attribute keys, event names, and span kind constants used by all AgentLens adapters and the control plane. It has no runtime dependencies beyond the Python standard library.

## Usage

```python
from agentlens_otel_semconv.attributes import AgentAttributes
from agentlens_otel_semconv.events import AgentEvents

span.set_attribute(AgentAttributes.AGENT_ID, "planner-01")
span.add_event(AgentEvents.HANDOFF_REQUESTED, {
    AgentAttributes.HANDOFF_TARGET: "reviewer-01",
    AgentAttributes.HANDOFF_REASON: "Needs architecture review",
})
```

## Exported Constants

See [`docs/semconv.md`](../../docs/semconv.md) for the full frozen reference.

### Attributes

`AgentAttributes` — All attribute keys (`agent.id`, `agent.name`, `agent.role`, `agent.task`, `agent.confidence`, `agent.tool.name`, `agent.interrupt.id`, `mission.id`, etc.)

### Events

`AgentEvents` — All event names (`agent.handoff.requested`, `agent.tool.call`, `agent.interrupt.requested`, `agent.review.approved`, etc.)

### Span Kinds

`SpanKind` — All span kind values (`mission`, `agent.task`, `agent.tool.call`, `agent.delegation`, `agent.review`, `agent.reflection`, etc.)

## Keeping in Sync

The TypeScript counterpart lives at `packages/protocol/src/semconv.ts`. Changes to attribute or event names must be mirrored in both packages.

## Tests

```bash
uv run pytest packages/otel-semconv/tests
```
