# srsran-e2e Baseline — Projection Validation Reference

Captured **before** the Projection Model Refinement (P0/P1). This is the
"before" reference for validating:

- **P0** — no fabricated `confidence`; absence renders "not recorded".
- **P1** — each `projection_profile` renders its emitted fields as first-class
  (no "not recorded" for fields BSOps actually emits).

## Source

- Workload: `BSOps` `apps/e2e-tests/src/srsran-e2e.test.ts` (3 phases, 23.4 s).
- OTLP export: `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8001/v1/traces`.
- AgentLens API: `apps/api-ts` (tsx watch), Postgres/Redis/MinIO via
  `scripts/ensure-docker.js`.
- Machine-readable capture: `srsran-e2e-baseline.replay.json`
  (Phase 1 mission `744f914e-…`, `current_state` snapshot).
- Phase 3 mission `347597a0-…` used to confirm `llm.call` projection.

## Emitted span set → current (pre-refinement) projection

| operation_name (span) | NodeType assigned | profile signal (verbatim attrs) | key attributes |
|---|---|---|---|
| `mission.execute` / `mission.lifecycle` | `task` | (none — no `agent.span.kind`) | `basestation.aiops.mission.id`, `basestation.aiops.alarm.*` |
| `workflow.step` | `task` | (none) | `gen_ai.workflow.id`, `gen_ai.workflow.step.name`, `gen_ai.workflow.step.type` |
| `workflow.transition` | `task` | (none) | `gen_ai.workflow.transition`, from/to |
| `invoke_agent` | `agent` | `agent.span.kind=invoke_agent` | `gen_ai.agent.role`, `gen_ai.agent.framework`, `gen_ai.agent.id` |
| `execute_tool` | `tool` | `agent.span.kind=execute_tool` | `gen_ai.tool.name` (logs/metrics/topology/cmdb/config/code), `gen_ai.tool.input`, `gen_ai.tool.output`, `gen_ai.tool.status` |
| `retrieval.search` | `tool` | `agent.span.kind=execute_tool` | `retrieval.backend` (lancedb/zoekt/kuzu), `search.query`, `search.result_count` |
| `llm.call` | **`task`** | (none on node; detected via `gen_ai.system`/`gen_ai.request.model`) | `gen_ai.system=openai`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reason` |
| `runtime.checkpoint.save/load` | `task` | (none) | `gen_ai.workflow.id`, checkpoint id |

## Current projection behavior (the "before" state to fix)

1. **`llm.call` is typed `task`, not `tool`.** BSOps `llm.call` spans inherit
   `gen_ai.agent.id` from the active agent scope, so `classifySpan` promotes
   them to L3; with no `agent.span.kind` they fall through to the L3 `else`
   branch → `NodeType='task'`. The inspector reaches LLM rows only via the
   `isLlmCallNode()` heuristic on the `task` payload, and the object type
   label is `WorkflowStep` (wrong for an LLM call). The `gen_ai.*` LLM fields
   are NOT promoted to first-class Evidence rows for a `tool`-typed LLM node.

2. **`retrieval.search` is typed `tool`** and shares the generic tool
   inspector; `retrieval.backend` / `search.query` / `search.result_count`
   are surfaced only via the tool-evidence correlation, with no dedicated
   retrieval profile.

3. **No `projection_profile` exists** on `GraphNode`; inspector dispatch is
   by `node.type` alone, so `llm.call` (task) and `retrieval.search` (tool)
   have no profile-specific first-class field rows.

## P0 violation (fabricated confidence) — confirmed live

`runtime-summary` for every agent in the captured missions:

```
agent 'diagnosis'  | facts.confidence=1 | error_count=0 | warnings=0
agent 'report'     | facts.confidence=1 | error_count=0 | warnings=0
agent 'evidence'   | facts.confidence=1 | error_count=0 | warnings=0
agent 'planner'    | facts.confidence=1 | error_count=0 | warnings=0
```

None of these agents emitted a `gen_ai.agent.confidence` attribute on the
event payloads the scratch reads, yet every projection reports
`facts.confidence = 1`. That value is the fabricated fallback formula
`Math.max(0.1, 1.0 - 0.15*error_count - 0.05*warnings.length)` evaluated at
zero errors/warnings (`nodeStateProjection.ts:51-53`). This violates passive
observability.

**Expected after P0:** `facts.confidence === undefined` for these agents
(rendered "not recorded"); `confidence` is set only when the runtime emitted
`gen_ai.agent.confidence`.
