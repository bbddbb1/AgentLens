## Context

The completed runtime-observability baseline confirms that OTLP spans, span events, interrupts, and branch/control records are durable evidence while replay, graph, summary, and explanation are derived by the server. It versions the current production implementation as `span_projection.v1` and protects explicit-failure and no-fabricated-edge behavior.

`packages/sdk-langgraph/agentlens_langgraph/instrumentor.py` is the only framework integration in scope. It currently observes LangGraph chain and tool callbacks, resolves node names from `langgraph_node` metadata or graph-step tags, creates AgentLens agent spans, and emits tool/handoff events. It knows native `run_id` and `parent_run_id`, but does not consistently preserve them in exported telemetry; it has no LLM callback handling, no native interrupt/resume observation, and no checkpoint-reference contract. It also currently represents ordinary parent/child callback flow as handoff events, which is not sufficient proof of a native handoff.

`apps/api-ts/src/services/runtime/projection.ts` directly interprets OTel, GenAI, AgentLens compatibility, and workload keys while constructing replay/graph output. Iteration 2 needs a translation seam, but one framework is insufficient evidence for a public RuntimeEvidence protocol or a second full projector.

The primary stakeholder outcome is a trustworthy answer to: "Which LangGraph-native runtime facts can AgentLens observe today, through which telemetry, with which limitations, and where do those facts appear in the existing product projection?"

## Goals / Non-Goals

**Goals:**

- Establish LangGraph as a reference integration with an executable capability matrix.
- Cover Agent, LLM, Tool, Retrieval, native thread/run identity, failure, interrupt/resume observation, explicit handoff, token usage, checkpoint references, activity correlation, and an optional observational `native_execution_key`.
- Use real adapter-produced telemetry and expected native facts as the primary oracle.
- Centralize framework/convention translation outside generic projection construction.
- Use the existing production projection and add only the smallest private normalized structure required to keep raw framework keys out of generic logic.
- Preserve stable source and native identifiers for a later UI-to-runtime governance bridge without defining an executable control reference.
- Retain explicit-failure, explicit-relationship, no-overlap-causality, safe-unknown, and traceability rules.

**Non-Goals:**

- Public or versioned RuntimeEvidence, TelemetryProfile, framework profile, or capability product model.
- A second replay/graph projector, `evidence_projection.v1`, public projection selector, or production cutover.
- Microsoft Agent Framework, AutoGen, CrewAI, or another framework integration.
- Approval, rejection, resume, checkpoint editing, state mutation, or any governance control action.
- Complete LangGraph state/checkpoint payload capture, framework-native debugging, execution replay, or HITL redesign.
- Runtime-evidence persistence, durable EventEnvelope, event sourcing/CQRS, new databases, logs, metrics, or broad UI redesign.

## Decisions

### 1. Make a LangGraph capability matrix the iteration contract

Add one checked-in matrix owned by the LangGraph integration and exercised by tests. Each row records:

- native fact and native source (callback, metadata, result, error, interrupt, or checkpoint metadata);
- current observability status (`covered`, `partial`, `not_observable`, or `not_applicable` for this adapter version);
- adapter telemetry fields/events that preserve the fact;
- fixture scenario and expected native fact assertion;
- normalization mapping and current projected surface;
- stable native/source references and known limitation.

The required rows are Agent activity, LLM invocation, Tool invocation, Retrieval, thread identity, run/parent-run identity, activity correlation, failure, interrupt request, resume observation, explicit handoff, token usage, checkpoint reference, framework identity, and optional `native_execution_key`. These statuses exist only in code/tests and focused documentation; they are not a reusable product capability model.

The matrix must be truthful. Iteration completion does not require every row to become `covered`. A fact can remain `partial` or `not_observable` when LangGraph or the current callback does not expose enough information, provided fixture-backed evidence and the limitation are explicit. Acceptance requires every required row to be assessed and backed by evidence appropriate to its status; it is not achieved by adding inference, polling, or broader framework-state access merely to improve coverage.

Alternative considered: define a general adapter profile framework. Rejected until a second framework demonstrates common dimensions and differences.

### 2. Use fixture-declared native facts as the primary oracle

Checked-in scenarios start from telemetry produced through the real `AgentLensLangGraphCallbackHandler` and SDK exporter shape. Each scenario has a small expected-native-facts declaration derived from the LangGraph callback inputs/results/errors and documented native behavior. The end-to-end test validates:

```text
LangGraph native scenario
  -> adapter-produced OTLP
  -> private telemetry normalization
  -> current span_projection.v1 replay/graph/explanation inputs
  -> expected native facts and references
```

The oracle asserts facts rather than exact layout or presentation strings. It includes expected activity identities/types, lifecycle/outcome, native IDs, token usage, checkpoint/interrupt references, and explicit relationships. Source telemetry references must explain every projected semantic assertion.

Legacy before/after projection comparison remains useful for detecting accidental regressions, but it is secondary. If legacy behavior conflicts with explicit native facts (for example, classifying every parent-child callback as a handoff), the native oracle wins and the intentional correction is documented.

Alternative considered: make `span_projection.v1` parity the main acceptance target. Rejected because it would freeze existing adapter interpretation even when it misstates LangGraph-native facts.

### 3. Capture only observable native facts in the current adapter

Extend the current LangGraph callback narrowly:

- preserve framework identity and stable run/parent-run IDs already supplied to callbacks;
- preserve thread ID and checkpoint ID/namespace only when exposed in callback metadata/configuration;
- add LLM callback coverage and token usage only when reported by LangChain/LangGraph response metadata;
- distinguish Retrieval only when an explicit retriever callback or recorded retrieval marker identifies it, never from tool names alone;
- record failure from explicit callback errors/status;
- observe interrupt request/resume only when explicit LangGraph-native data identifies them; do not infer resume from later activity;
- record handoff only when explicit native command/metadata/event evidence says handoff/delegation, not from parent-child nesting;
- optionally derive an AgentLens observational `native_execution_key` from recorded native identity fields, without presenting it as framework-owned, embedding state/secrets/checkpoint payloads, or making it executable.

If a required fact is not observable through the current callback version, the matrix records the gap. This change does not add polling or direct checkpoint-store reads merely to force coverage.

Alternative considered: inspect complete LangGraph state/checkpoints after every callback. Rejected because it broadens authority, data exposure, and control scope.

### 4. Introduce a private normalized-fact seam, not RuntimeEvidence

Create an internal structure under `apps/api-ts/src/services/runtime/normalization/` (names may follow local conventions) that contains only fields consumed by current projection and matrix acceptance:

- activity kind/identity, lifecycle/outcome, timing, and display-safe recorded fields;
- trace/span/parent and invocation correlation;
- explicit resolved/unresolved relationship facts;
- framework, thread, run, parent-run, interrupt request, checkpoint, activity-correlation identifiers, and optional AgentLens-derived `native_execution_key`;
- token usage when recorded;
- source telemetry references and translation provenance;
- diagnostics for unknown, missing, or conflicting telemetry.

The structure is private to `apps/api-ts`, unversioned, not exported from `@agentlens/protocol`, and may evolve with the adapter work. It is not persisted and is not an event ledger. Only the narrow observational native identity that must survive to projected output is transported additively in existing metadata.

Alternative considered: publish `runtime_evidence.v1`. Rejected because one framework cannot validate a stable public abstraction.

### 5. Centralize convention translation and keep one projection path

Move the relevant OTel, GenAI, AgentLens compatibility, and LangGraph key/event interpretation into pure normalization helpers. LangGraph-specific rules are isolated from generic rules. The current `projectReplay()` and `projectTraceSnapshot()` remain the only production replay/graph constructors and consume normalized facts for the matrix-covered semantics.

This is an incremental refactor of `span_projection.v1`, not a parallel architecture. Existing behavior outside the matrix remains in place unless the refactor can safely route it through the same internal facts. No new public projection version is introduced solely for internal structure. If a fixture-backed native correction changes an externally meaningful result, its compatibility impact is documented and tested under the existing API contract.

Runtime explanation continues to consume the current derived replay/events. It must not inspect LangGraph keys independently.

Alternative considered: build `projectReplayFromEvidence()` beside the legacy projector. Rejected as duplicate architecture and premature cutover machinery.

### 6. Preserve narrow observational native identity for future governance

Matrix-covered projected activities/events carry additive `metadata.native_runtime_identity` when source telemetry provides native identity. The value contains only:

- `framework` (currently `langgraph`);
- optional `thread_id`, `run_id`, `parent_run_id`, `interrupt_request_id`, `checkpoint_id`, and `activity_correlation_id`;
- an optional stable `native_execution_key` derived by AgentLens from recorded identifiers for observational correlation.

The identity metadata is evidence/provenance, not authority to act, and `native_execution_key` is not a framework-owned reference. It contains no approval decision, resume command, resume URL/token, checkpoint payload, or mutable framework state. A future governance bridge must define any adapter-owned executable control reference separately; this change adds no endpoint or UI action that controls execution.

Alternative considered: defer all native references until governance work. Rejected because references lost during normalization cannot be reconstructed safely later.

### 7. Apply evidence-first safety at adapter, normalization, and projection boundaries

- Explicit error/failure evidence dominates completion or default success.
- Parent-child nesting remains parent-child; it is not handoff without explicit handoff evidence.
- Unresolved targets remain traceable diagnostics and never create graph edges or fabricated nodes.
- Timing overlap, naming similarity, graph layout, and LLM interpretation never establish causality.
- Unknown events/attributes do not crash processing or create authoritative facts.
- Every matrix-asserted projected fact points to source telemetry and translation provenance.

These rules are validated both in focused normalization tests and in adapter-produced end-to-end fixtures.

## Risks / Trade-offs

- **[The matrix becomes a hidden generalized capability framework]** -> Keep it LangGraph-owned, fixture-linked, non-product, and limited to the required rows.
- **[Native IDs expose sensitive runtime data]** -> Preserve identifiers and opaque references only; exclude state, payloads, secrets, tokens, and executable control data.
- **[Correcting automatic handoff labeling changes legacy output]** -> Make native facts primary, document the correction, and retain legacy comparison as a regression report.
- **[Thread/checkpoint/interrupt facts vary by LangGraph version]** -> Record fixture/library version and mark coverage partial when callback observability is conditional.
- **[Normalization grows into a public schema accidentally]** -> Keep types inside `apps/api-ts`, unversioned, unexported, and scoped to current projector inputs.
- **[Projection still contains scattered convention keys]** -> Add boundary/source tests for matrix-covered semantics and migrate those keys to normalization helpers.
- **[Unavailable facts are inferred to improve coverage]** -> Require explicit native/telemetry evidence for every covered matrix cell and allow truthful gaps.

## Migration Plan

1. Add the LangGraph capability matrix and native-fact expectation format with truthful initial statuses.
2. Capture/canonicalize adapter-produced fixtures for the required native scenarios.
3. Extend the current adapter for explicitly observable run/thread, LLM/token, retrieval, interrupt/checkpoint, failure, handoff, and correlation facts, updating matrix statuses only with fixture proof.
4. Add private normalization helpers and the narrow observational native identity metadata.
5. Route matrix-covered semantics through the existing `span_projection.v1` implementation and runtime explanation input path.
6. Add native-oracle end-to-end tests, safety tests, and secondary legacy regression comparison.
7. Document coverage/limitations and run TypeScript/Python validation.

Rollback reverts adapter fields and private normalization changes while leaving the baseline span-backed projection and durable data model intact. No data migration is required.

## Open Questions

No blocking planning questions remain. The capability matrix must record any LangGraph-version-specific observability discovered during fixture capture rather than resolving uncertainty through inference. Public RuntimeEvidence, generalized profiles, a second projector, another framework, governance controls, and production cutover require later OpenSpec changes.
