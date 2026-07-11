## ADDED Requirements

### Requirement: LangGraph observability uses the current production projector
AgentLens SHALL use the existing `projectReplay()` and `projectTraceSnapshot()` production path for this iteration and SHALL integrate normalized matrix facts into that path. It SHALL NOT create `evidence_projection.v1`, a duplicate replay/graph projector, or a public projection selector.

#### Scenario: Existing replay API is called
- **WHEN** a client requests replay or graph data
- **THEN** the current `span_projection.v1` path returns the response

#### Scenario: Implementation modules are reviewed
- **WHEN** completed work is inspected
- **THEN** no parallel evidence projector or production cutover mechanism exists

### Requirement: Matrix-covered semantics enter projection through normalized facts
The current projector SHALL consume private normalized facts for matrix-covered LangGraph and telemetry-convention semantics, keeping framework-specific keys out of generic graph/replay construction.

#### Scenario: LangGraph Agent activity is projected
- **WHEN** normalization produces a matrix-backed Agent fact
- **THEN** the existing projector emits the current compatible activity/node semantics with source traceability

#### Scenario: Projection source is scanned
- **WHEN** generic projection construction for matrix-covered facts is reviewed
- **THEN** it does not independently interpret LangGraph-specific keys

#### Scenario: Runtime explanation is built
- **WHEN** explanation is derived for a LangGraph fixture
- **THEN** it consumes the current derived replay/events and preserved references
- **AND** does not re-interpret LangGraph telemetry independently

### Requirement: Current projection preserves observational native identity
Where source telemetry records native identity, current replay/graph/explanation inputs SHALL carry additive `native_runtime_identity` metadata containing framework identity, available thread/run/parent-run, interrupt request, checkpoint, and activity-correlation identifiers plus an optional AgentLens-derived `native_execution_key`.

#### Scenario: Projected activity has native identity
- **WHEN** a normalized activity contains observable native references
- **THEN** the corresponding projected node/event metadata preserves those references and source evidence

#### Scenario: Native identity is partial
- **WHEN** only some native identifiers are observable
- **THEN** projection preserves the recorded subset and does not synthesize the rest

#### Scenario: Native reference is inspected for control authority
- **WHEN** projected metadata is reviewed
- **THEN** it contains no adapter-owned control reference, approval/resume command, secret, checkpoint state, or executable token
- **AND** `native_execution_key` is not represented as framework control authority

### Requirement: Projection correctness follows native fixture facts
For LangGraph conformance scenarios, the current projector SHALL satisfy fixture-declared native facts. Legacy output comparison SHALL be secondary and SHALL NOT override explicit native expectations.

#### Scenario: Native expectation and legacy behavior agree
- **WHEN** fixture expectations match the baseline projection behavior
- **THEN** the current output remains compatible

#### Scenario: Native expectation exposes a legacy defect
- **WHEN** explicit native facts contradict legacy interpretation
- **THEN** the projection/adapter behavior is corrected or the capability is truthfully marked unsupported
- **AND** legacy equality alone does not pass acceptance

### Requirement: Projection maintains evidence-first safety
The current projection SHALL preserve explicit failure, exclude unresolved edges, avoid timing-only causality, degrade safely on unknown telemetry, and trace every matrix-backed semantic to source telemetry.

#### Scenario: Explicit failure is projected
- **WHEN** normalized native facts record failure
- **THEN** no replay, graph, current-state, summary, or explanation input represents the activity as successful

#### Scenario: Unresolved target reaches projection
- **WHEN** normalization records an unresolved relationship target
- **THEN** projection emits no dangling edge or fabricated node

#### Scenario: Activities overlap without explicit causality
- **WHEN** normalized facts contain overlapping activities without a relationship
- **THEN** projection emits no causal edge based on timing

#### Scenario: Projected fact is audited
- **WHEN** a matrix-backed projected semantic is inspected
- **THEN** source telemetry references and translation provenance identify its basis

### Requirement: Projection and persistence architecture remain unchanged
This iteration SHALL NOT persist private normalized facts, change the durable span/control evidence model, or add a public framework profile/capability contract.

#### Scenario: Current mission is replayed
- **WHEN** the current projector derives a LangGraph replay
- **THEN** normalized facts are disposable and no new persistence write occurs
