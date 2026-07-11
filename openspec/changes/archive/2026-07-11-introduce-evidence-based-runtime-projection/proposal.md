## Why

AgentLens has a characterized span-backed projection baseline, but its only framework adapter still lacks a code- and fixture-backed account of which LangGraph-native runtime facts are observable and how faithfully those facts reach replay, graph, and runtime explanation. Iteration 2 should establish LangGraph as the reference integration and close verified observability gaps before a second framework justifies any public framework-neutral evidence protocol.

## What Changes

- Add a code- and fixture-backed LangGraph runtime-observability capability matrix covering Agent, LLM, Tool, Retrieval, thread/run identity, failure, interrupt/resume observation, explicitly recorded handoff, token usage, checkpoint references, activity correlation, and source traceability.
- Complete the iteration when every required matrix row is honestly assessed and fixture-backed; rows may remain `partial` or `not_observable` when LangGraph does not expose the fact, without adding inference or broader framework-state access to improve coverage.
- Make expected LangGraph-native facts declared by each real adapter-produced fixture the primary correctness oracle.
- Extend the current LangGraph adapter only where required to preserve native facts that are explicitly observable through callbacks, metadata, results, or errors.
- Preserve stable observational native identifiers for a later governance bridge: framework identity, run/thread identity, interrupt/request identity, activity correlation, checkpoint reference where observable, and an optional AgentLens-derived `native_execution_key`. A later bridge defines any adapter-owned executable control reference separately.
- Centralize LangGraph-specific and supported telemetry-convention translation outside generic replay/graph construction.
- Introduce only a small private normalized-fact structure required by the current production projector; do not create a public `runtime_evidence.v1` contract or generalized framework profile.
- Continue using and incrementally refactoring the existing `span_projection.v1` production path where it is sufficient; do not build or version a second replay/graph projector.
- Keep adapter-produced LangGraph OTLP fixtures and end-to-end semantic tests for success, failure, identity, relationships, interrupts, token usage, checkpoint references, unknown telemetry, and traceability.
- Use comparison with legacy output only as a secondary regression aid. A mismatch against native fixture facts cannot be excused solely because legacy projection behaved the same way.
- Preserve evidence-first safety: explicit failure is never success, unresolved targets create no edge, overlap alone creates no causality, unknown telemetry degrades safely, and projected semantics remain traceable to source telemetry.

## Capabilities

### New Capabilities

- `langgraph-runtime-observability`: Defines the smallest private normalized runtime-fact and observational native-identity structure needed by the LangGraph reference integration.
- `langgraph-telemetry-translation`: Defines deterministic translation of LangGraph, OpenTelemetry, GenAI, and current AgentLens telemetry conventions outside generic projection construction.
- `langgraph-projection-integration`: Defines how the current production replay/graph projector consumes normalized LangGraph facts, preserves native identifiers and safety rules, and remains the only production projection path.
- `langgraph-observability-conformance`: Defines the capability matrix, adapter-produced fixture corpus, native-fact oracle, and end-to-end LangGraph observability acceptance.

### Modified Capabilities

None. The repository has no archived main OpenSpec capability specs; this change builds on the completed runtime-observability baseline without changing its authority or persistence model.

## Impact

- `packages/sdk-langgraph/agentlens_langgraph/instrumentor.py` and its tests gain targeted native-fact capture for matrix gaps, without approval/resume control or checkpoint payload capture.
- `apps/api-ts/src/services/runtime/` gains a private normalization seam and the existing projector is refactored only as needed to consume normalized facts rather than LangGraph/convention keys.
- Existing `span_projection.v1` responses remain the production contract. Stable native runtime references are carried additively through existing event/node/edge metadata where applicable.
- Adapter-produced OTLP fixtures, native-fact expectations, and capability-matrix assertions live under existing LangGraph/API test areas.
- Focused documentation records coverage, partial/unsupported facts, fixture provenance, and limitations; it is not a generalized capability product model.
- Deferred: public RuntimeEvidence, generalized profile/capability frameworks, a second evidence projector, another framework adapter, production cutover, UI capability surfaces, and governance control actions.
- No new database tables, durable evidence format, event ledger, dynamic plugin system, checkpoint/state payload persistence, or broad UI redesign.
