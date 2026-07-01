# Research: Coherent Runtime Execution Story

## Decision 1: Keep the shared runtime explanation projection as the canonical story source

**Decision**: Use `packages/protocol/src/projections/explanationProjection.ts` as the authoritative, frame-scoped execution story and continue deriving `RuntimeSummary` and UI-facing render state from that shared projection instead of letting each surface interpret recorded replay evidence independently.

**Rationale**: The repository already has an evidence-backed `RuntimeExplanationProjection`, targeted projection tests, and web contract tests that assume the server supplies the authoritative story. Extending that shared contract is lower-risk than adding another story layer.

**Alternatives considered**:

- Reconstruct meaning independently in the graph, timeline, and inspector from replay events.
- Build a separate backend summarization service just for Run UI storytelling.

## Decision 2: Define frame identity as a shared tuple, not as per-view local state

**Decision**: Treat the selected frame as the tuple `{ mission_id, branch_id, sequence_num, as_of_timestamp, projection_version }`, and require summary, graph snapshot, timeline, and inspector to resolve against that same frame identity.

**Rationale**: The spec's core risk is silent drift between surfaces. The current code already threads `branch_id` and `sequence_num` through runtime summary and explanation endpoints, so formalizing that shared tuple fits the existing architecture and keeps historical views honest.

**Alternatives considered**:

- Let each view infer "current" or "best available" state locally.
- Use timestamps alone as the cross-view sync contract.

## Decision 3: Use stable activity identities for cross-view focus, with spans as supporting anchors

**Decision**: Standardize cross-view selection and relationship mapping on stable `activity.id` values. Identity prefers the applicable `tool_call_id`, LLM request ID, retrieval request ID, interrupt ID, workflow step ID, or artifact ID; span or event identity is fallback-only, and one span may contain multiple activities. `source_span_id`, `parent_span_id`, and evidence references remain supporting anchors.

**Rationale**: Existing projection tests already demonstrate why invocation identity is safer than direct span identity for retries and shared-span edge cases. A stable activity id gives summary, timeline, graph, and inspector a single focus token that survives label changes and partial evidence.

**Alternatives considered**:

- Span-only activity identity.
- Label- or node-id-based selection synchronization.

## Decision 4: Keep evidence conditions first-class and explicit

**Decision**: Represent missing evidence, inconsistent evidence, and redacted evidence as explicit runtime-story data that every surface must render truthfully instead of smoothing over gaps with empty values or inferred text.

**Rationale**: The protocol projection and ROPS-related tests already protect against fabricated lifecycle data and redaction leaks. Extending that honesty model across the summary/graph/timeline/inspector story keeps the feature aligned with the product's observability role.

**Alternatives considered**:

- Treat absent data as empty strings or "no issue".
- Let UI heuristics fill in unrecorded fields to keep the story flowing.

## Decision 5: Keep BSOps-specific meaning as optional decoration only

**Decision**: Use BSOps update/diagnosis runs as the primary validation corpus, but keep any workload-specific naming or hints as optional decoration layered on top of the generic runtime activity model.

**Rationale**: The spec explicitly forbids BSOps from becoming a core dependency or taxonomy. The existing protocol types already model generic activity kinds such as agent, workflow, tool, retrieval, human, and checkpoint, which are broad enough for both BSOps and non-BSOps runs.

**Alternatives considered**:

- Introduce BSOps-only activity types or phase names into the core projection.
- Fork the Run UI into BSOps and non-BSOps experiences.

## Decision 6: Validate coherence at protocol, API, and web layers

**Decision**: Validate the feature at three layers: projection correctness in `apps/api-ts/tests/unit/explanationProjection.test.ts` and related protocol tests, frame/transport behavior in API route or mission-store tests, and cross-view rendering/state alignment in `apps/web/tests/unit/explanationContract.test.ts` and related web tests.

**Rationale**: The failure mode is cross-layer drift, so testing one layer in isolation is not enough. The repo already has a strong starting point for this shape of verification, and it should be expanded with golden scenario fixtures that cover BSOps and non-BSOps runs.

**Alternatives considered**:

- Rely mostly on manual UI QA.
- Add only component snapshot tests without protocol/API coverage.

## Decision 7: Make phase selection, progress markers, activity importance, and validation fixtures deterministic

**Decision**: Define the authoritative runtime phase with the fixed workload-neutral labels `Queued`, `Active Work`, `Waiting`, `Converging`, `Completed`, `Failed`, or `Unknown`, always disclose whether that phase is `recorded`, `derived`, or `unknown`, keep progress markers as optional subordinate context, define important activities with one stable prioritization order, and validate the behavior against three explicit corpora: a BSOps update or diagnosis run, a generic HITL run, and a sparse or conflict-heavy non-BSOps run.

**Rationale**: The checklist review showed that leaving phase semantics, story selection, and corpus shape implicit would produce cross-implementation drift even if the core projection remained deterministic.

**Alternatives considered**:

- Leave phase naming and activity significance to UI-specific heuristics.
- Keep fixture requirements at "one BSOps and two non-BSOps runs" without defining their structural coverage.

## Decision 8: Separate engineering acceptance from product-validation research

**Decision**: Treat corpus-based cross-surface authority, historical exclusion, evidence-condition, graph-context, phrase-quality, and evidence-navigation checks as hard engineering gates, while keeping first-use comprehension and comparative UX study goals as non-blocking product validation unless they are explicitly brought into sprint scope.

**Rationale**: The revised spec now distinguishes hard acceptance from product validation, which lets implementation planning stay truthful about what must block delivery versus what should be measured through a formal study.

**Alternatives considered**:

- Use the 12-person comparative usability study as a default implementation gate for this sprint.
- Keep engineering correctness and product-usability outcomes blended into one acceptance checklist.
