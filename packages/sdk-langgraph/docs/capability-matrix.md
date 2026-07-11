# LangGraph Runtime Observability Capability Matrix

This document describes the LangGraph reference integration’s **executable**
runtime-observability matrix. It is LangGraph-specific and test-focused. It is
**not** a generalized product capability model, TelemetryProfile framework, or
public RuntimeEvidence contract.

## Purpose

Answer: which LangGraph-native runtime facts AgentLens can observe today,
through which adapter telemetry, with which limitations, and where those facts
appear in the current `span_projection.v1` replay/graph path.

## Authority

| Layer | Role |
|-------|------|
| `packages/sdk-langgraph/tests/capability_matrix.py` | Executable matrix rows + statuses |
| `packages/sdk-langgraph/tests/fixtures/otlp/*` | Adapter-produced fixtures + native-fact oracle |
| `apps/api-ts/src/services/runtime/normalization/` | Private, unversioned normalized facts |
| `apps/api-ts/src/services/runtime/projection.ts` | Only production projector (`span_projection.v1`) |

Native fixture expectations are the **primary** correctness oracle. Legacy
projection comparison is secondary and non-authoritative.

## Fixture provenance

Fixtures are generated through the real `AgentLensLangGraphCallbackHandler`
(with a recording span stand-in that mirrors AgentLens agent span/event shape):

```text
LangGraph callback scenario
  -> AgentLensLangGraphCallbackHandler
  -> recorded spans/events (SDK exporter shape)
  -> packages/sdk-langgraph/tests/fixtures/otlp/<id>/spans.json
  -> expected_native_facts.json (primary oracle)
```

Regenerate / contract-check:

```bash
cd packages/sdk-langgraph
uv run pytest tests/test_generate_fixtures.py tests/test_capability_matrix.py -q
```

Each fixture records `adapter`, `library_versions`, and `generator` metadata.

## Matrix statuses

| Status | Meaning |
|--------|---------|
| `covered` | Explicit native source + adapter telemetry + fixture + projected surface |
| `partial` | Observable only conditionally / incompletely; limitation stated |
| `not_observable` | No explicit native source in the supported adapter/runtime version |
| `not_applicable` | Not meaningful for this adapter version |

Iteration completion does **not** require every row to be `covered`. Truthful
`partial` / `not_observable` rows with fixture-backed evidence are acceptable.
Inference and broader checkpoint/state access are not used to inflate coverage.

## Current coverage summary

| Capability | Status | Notes |
|------------|--------|-------|
| Agent | covered | Node/chain → agent span lifecycle |
| LLM | partial | Requires LLM/chat-model callbacks |
| Tool | covered | Distinct run/correlation IDs on tool events |
| Retrieval | partial | Only explicit retriever callbacks (`agentlens.langgraph.retrieval`) |
| Framework | covered | `gen_ai.agent.framework=langgraph` |
| Thread identity | partial | When `thread_id` present in metadata/configurable |
| Run / parent-run | covered | Preserved on spans/events |
| Activity correlation | covered | `activity_correlation_id` ← run_id |
| Failure | partial | Tool failure fixture-backed; chain/LLM/retrieval failure paths not all fixture-proven |
| Interrupt request | partial | Explicit `__interrupt__` / interrupt id only; no approval control |
| Resume observation | partial | Explicit resume marker only; never inferred |
| Explicit handoff | partial | Explicit metadata markers only; Command.goto/routing is **not** handoff |
| Token usage | partial | When provider usage metadata is present |
| Checkpoint reference | partial | id/ns only; **no payload/state** |
| `native_execution_key` | covered | AgentLens-derived observational key |

## Intentional legacy correction

Previously, ordinary parent→child chain nesting emitted `agent.handoff.*`
events. That misstated LangGraph-native facts. The adapter now:

- preserves parent/child via `run_id` / `parent_run_id` correlation
- emits handoff **only** from explicit handoff/delegation evidence
  (`langgraph_handoff`, `handoff_to`, `handoff_target`, etc.) with
  `agentlens.langgraph.explicit_handoff=true`
- does **not** treat `Command.goto`, output `goto`, node order, or workflow
  routing as Agent handoff

Fixture `parent_child_correlation` documents this under
`intentional_legacy_corrections`. Native oracle wins over legacy equality.

## Observational native identity (not control authority)

Projected activities may carry additive:

```json
{
  "native_runtime_identity": {
    "framework": "langgraph",
    "thread_id": "...",
    "run_id": "...",
    "parent_run_id": "...",
    "interrupt_request_id": "...",
    "checkpoint_id": "...",
    "activity_correlation_id": "...",
    "native_execution_key": "langgraph|thread:...|run:..."
  }
}
```

Rules:

- Evidence / provenance only — **not** authority to act.
- `native_execution_key` is AgentLens-derived observational correlation, not a
  framework-owned or executable control reference.
- No secrets, resume tokens, approval decisions, checkpoint payloads, or
  mutable framework state.
- A future governance bridge must define any **adapter-owned executable control
  reference** separately. Approval / resume **controls** are deferred.

## Private normalization / current projector boundary

```text
OTLP spans (durable)
  -> normalizeSpansToFacts()   [private, disposable]
  -> projectReplay() / projectTraceSnapshot()   [span_projection.v1]
  -> replay / graph / explanation inputs
```

- Normalization lives only under `apps/api-ts/src/services/runtime/normalization/`
- Unversioned, not exported from `@agentlens/protocol`, not persisted
- LangGraph-specific keys are interpreted in `normalization/langgraph.ts`
- Generic projection construction consumes normalized facts for matrix-covered
  semantics and does not independently re-parse `agentlens.langgraph.*`
- Runtime explanation continues to use derived replay/events
- There is **no** second projector, `evidence_projection.v1`, public
  RuntimeEvidence schema, or production cutover selector

## Deferred (explicitly out of scope)

- Public RuntimeEvidence / TelemetryProfile / capability product model
- Second framework adapter
- Approval, rejection, resume command paths
- Checkpoint/state payload capture
- New persistence / UI redesign / production cutover
