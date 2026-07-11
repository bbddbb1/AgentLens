## 1. LangGraph Capability Matrix and Native Oracle

- [x] 1.1 Add a LangGraph-specific executable capability matrix with rows for Agent, LLM, Tool, Retrieval, framework, thread/run/parent-run identity, activity correlation, failure, interrupt request, resume observation, explicit handoff, token usage, checkpoint reference, and optional observational `native_execution_key`.
- [x] 1.2 Define matrix statuses `covered`, `partial`, `not_observable`, and `not_applicable` plus required links to native source, adapter telemetry, fixture, expected facts, projected surface, references, and limitation.
- [x] 1.3 Add a fixture-native-fact expectation format and assertions that make native LangGraph facts the primary oracle rather than legacy projection equality.
- [x] 1.4 Populate every required matrix row from current callback code/tests; allow iteration completion with fixture-backed `partial`/`not_observable` rows and clear limitations, and fail when any status is unsupported by its required evidence.

## 2. Adapter-Produced LangGraph Fixture Corpus

- [x] 2.1 Capture and canonicalize raw OTLP fixtures through the real `AgentLensLangGraphCallbackHandler` and SDK exporter shape with stable IDs/timestamps and recorded library-version context.
- [x] 2.2 Add fixtures and expected facts for successful Agent, successful Tool, failed Tool, and parent-child run correlation.
- [x] 2.3 Add LLM/model/token-usage and explicit Retrieval fixtures where those native callbacks/results expose the facts; mark conditional or missing observability truthfully.
- [x] 2.4 Add fixtures for explicit interrupt request/resume observation and checkpoint references where observable, without adding approval/resume control or checkpoint payload capture.
- [x] 2.5 Add explicit-handoff, unresolved-target, non-causal-overlap, and unknown-telemetry fixtures.
- [x] 2.6 Add Python fixture-generation/contract tests proving checked-in telemetry remains aligned with the current adapter emitter.

## 3. LangGraph Native Fact Capture

- [x] 3.1 Preserve framework identity plus callback-provided run and parent-run IDs in adapter telemetry with tests.
- [x] 3.2 Preserve thread ID, activity correlation, checkpoint ID/namespace, and an optional AgentLens-derived `native_execution_key` only when explicitly observable; exclude state, secrets, executable tokens, and framework-control-reference claims.
- [x] 3.3 Add current-adapter LLM lifecycle/model/token-usage observation from explicit callback/result metadata, with partial/not-observable matrix outcomes where unavailable.
- [x] 3.4 Preserve Tool and explicit Retrieval native invocation identity/lifecycle so repeated same-name activities remain distinct.
- [x] 3.5 Preserve explicit failure from chain, LLM, Tool, and Retrieval callback errors/status without completion defaults overriding it.
- [x] 3.6 Observe interrupt request/resume identities only from explicit native facts and add no approval, decision, or resume command path.
- [x] 3.7 Stop treating ordinary parent-child callback nesting as handoff; emit/preserve handoff only from explicit native handoff/delegation evidence and document any compatibility correction.

## 4. Private Telemetry Normalization Boundary

- [x] 4.1 Add an unversioned, unexported internal normalized-fact structure under `apps/api-ts` containing only matrix-required activity, lifecycle, correlation, relationship, native-reference, token-usage, source-reference, and diagnostic fields.
- [x] 4.2 Move matrix-covered OpenTelemetry and GenAI key/event translation into pure convention helpers outside generic projection construction.
- [x] 4.3 Move current AgentLens compatibility translation into its owning helper and isolate LangGraph-specific markers in a LangGraph helper.
- [x] 4.4 Implement deterministic identity/deduplication and lifecycle merging, including explicit-failure dominance and repeated same-name invocation tests.
- [x] 4.5 Implement explicit resolved/unresolved relationship facts, no timing/name causality, safe unknown handling, and source/provenance tracking.
- [x] 4.6 Add boundary tests proving the private structure is not exported/persisted and matrix-covered generic projection code contains no LangGraph-specific keys.

## 5. Current Production Projection Integration

- [x] 5.1 Refactor existing `projectReplay()`/`projectTraceSnapshot()` matrix-covered semantics to consume private normalized facts while retaining `span_projection.v1` and current API response shapes.
- [x] 5.2 Preserve matrix-backed Agent, LLM, Tool, Retrieval, lifecycle/failure, parent-child, explicit handoff, interrupt observation, token usage, and checkpoint-reference semantics in current replay/graph output.
- [x] 5.3 Carry additive `metadata.native_runtime_identity` with recorded framework/native IDs, activity correlation, optional `native_execution_key`, and source traceability; include no adapter-owned control reference, control authority, or state payload.
- [x] 5.4 Keep runtime explanation on the existing derived replay/event path and remove any independent LangGraph-key interpretation for matrix-covered semantics.
- [x] 5.5 Add tests proving no second projector, `evidence_projection.v1`, public projection selector, production cutover, or normalized-fact persistence was introduced.

## 6. Native-Fact Conformance and Regression Safety

- [x] 6.1 Run every fixture end to end from adapter-produced OTLP through normalization and current replay/graph/explanation inputs, asserting expected native facts and references.
- [x] 6.2 Add safety assertions that failure is never success, unresolved targets create no edge, overlap creates no causality, and unknown telemetry degrades safely.
- [x] 6.3 Add deterministic repeated-run/span-permutation and multi-convention/repeated-invocation tests.
- [x] 6.4 Retain a secondary legacy semantic comparison report for unintended regressions, but fail correctness against fixture-native facts regardless of legacy parity.
- [x] 6.5 Classify intentional legacy corrections (including parent-child versus handoff) and unsupported native facts in fixture/matrix expectations.

## 7. Focused Documentation and Verification

- [x] 7.1 Document the LangGraph capability matrix, native fact sources, fixture provenance, current coverage/limitations, and the private normalization/current-projector boundary.
- [x] 7.2 Document stable native identifiers and `native_execution_key` as observational provenance only, reserve adapter-owned control references for a future governance bridge, and state that approval/resume controls are deferred.
- [x] 7.3 Run LangGraph/SDK Python tests plus protocol/API builds, type checks, and focused normalization/projection/conformance Vitest suites.
- [x] 7.4 Confirm no public RuntimeEvidence, generalized profile/capability product model, second projector, second framework, production cutover, approval/resume control, checkpoint payload, new persistence, or UI redesign entered the change.
- [x] 7.5 Strictly validate the revised OpenSpec change and record unrelated pre-existing failures separately.
