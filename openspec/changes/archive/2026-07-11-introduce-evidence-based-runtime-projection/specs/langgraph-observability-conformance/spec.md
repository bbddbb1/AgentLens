## ADDED Requirements

### Requirement: LangGraph observability matrix is code- and fixture-backed
AgentLens SHALL maintain an executable LangGraph runtime-observability matrix covering Agent, LLM, Tool, Retrieval, framework identity, thread/run/parent-run identity, activity correlation, failure, interrupt request, resume observation, explicit handoff, token usage, checkpoint references, and optional observational `native_execution_key`.

#### Scenario: Matrix row is marked covered
- **WHEN** a capability row has status `covered`
- **THEN** it links to adapter telemetry, at least one real fixture, native-fact expectations, normalization behavior, projected output, and source/native references

#### Scenario: Fact is only partially observable
- **WHEN** LangGraph or the current callback exposes a fact conditionally or incompletely
- **THEN** the row is `partial` with the condition and missing information stated

#### Scenario: Fact is not observable
- **WHEN** no explicit native source exists in the supported adapter/runtime version
- **THEN** the row is `not_observable` rather than inferred or reported covered

#### Scenario: Iteration completes with non-covered rows
- **WHEN** every required row is fixture-backed and clearly limited but some rows remain `partial` or `not_observable`
- **THEN** the iteration may complete without forcing those rows to `covered`
- **AND** no inference or broader LangGraph state/checkpoint access is added merely to improve the matrix status

#### Scenario: Matrix implementation is reviewed
- **WHEN** completed code and documentation are inspected
- **THEN** the matrix is LangGraph-specific and test-focused
- **AND** no generalized product capability/profile framework exists

### Requirement: Adapter-produced fixtures declare expected native facts
Conformance SHALL use canonicalized OTLP produced through the real LangGraph callback adapter and SDK exporter shape. Each fixture SHALL declare expected native facts derived from its callback inputs, native metadata, outputs, token usage, interrupts, checkpoint references, and errors.

#### Scenario: Fixture provenance is verified
- **WHEN** a fixture is loaded
- **THEN** its generation path, LangGraph/LangChain version context, and adapter source are documented or asserted

#### Scenario: Native-fact oracle runs
- **WHEN** the fixture is normalized and projected through the current path
- **THEN** the test compares observed/projected semantics with the fixture's expected native facts
- **AND** not merely with legacy projection output

### Requirement: LangGraph native activity coverage is verified end to end
The fixture corpus SHALL test native Agent, LLM, Tool, and explicitly observable Retrieval activities with identity, lifecycle/outcome, activity correlation, and source references.

#### Scenario: Agent executes successfully
- **WHEN** a LangGraph node callback starts and ends successfully
- **THEN** one Agent activity preserves native run/thread correlation and completes successfully

#### Scenario: LLM reports usage
- **WHEN** an LLM callback/result exposes model and token usage
- **THEN** one LLM activity preserves recorded model, lifecycle, token counts, native correlation, and source references

#### Scenario: Tool succeeds
- **WHEN** a Tool callback starts and ends successfully
- **THEN** one Tool activity preserves its native run/correlation identity and successful outcome

#### Scenario: Tool fails
- **WHEN** a Tool callback reports an explicit error
- **THEN** one Tool activity is failed and is never projected as success

#### Scenario: Retrieval is explicitly observable
- **WHEN** a retriever callback or explicit recorded marker identifies Retrieval
- **THEN** one Retrieval activity preserves its native correlation and outcome

#### Scenario: Retrieval is not explicitly observable
- **WHEN** only a generic Tool name suggests retrieval
- **THEN** the matrix/test does not claim native Retrieval semantics

### Requirement: LangGraph native identity and runtime references are verified
Fixtures SHALL verify framework identity, thread ID, run/parent-run IDs, interrupt request ID, checkpoint reference where observable, activity correlation, and optional `native_execution_key` without exposing framework state or control authority.

#### Scenario: Thread and run identifiers are available
- **WHEN** callback metadata contains thread and run identity
- **THEN** adapter telemetry, normalized facts, and projected metadata preserve the recorded identifiers

#### Scenario: Checkpoint reference is available
- **WHEN** callback metadata exposes a checkpoint identifier or namespace
- **THEN** projection preserves the reference but not checkpoint payload/state

#### Scenario: Native execution key is produced
- **WHEN** sufficient recorded native identity exists
- **THEN** the same fixture produces a stable AgentLens-derived `native_execution_key` that contains no secret or executable control token
- **AND** the key is not described as a framework-owned control reference

### Requirement: Interrupt, resume, and handoff coverage requires explicit native evidence
The matrix and fixtures SHALL distinguish observable native interrupt/request and resume facts from control actions, and SHALL distinguish parent-child relationships from explicitly recorded handoffs.

#### Scenario: Interrupt request is observable
- **WHEN** LangGraph-native callback/output metadata explicitly records an interrupt request and identity
- **THEN** telemetry and projection preserve the request fact and stable reference
- **AND** do not approve or resume it

#### Scenario: Resume is explicitly observable
- **WHEN** source telemetry explicitly identifies a resume for a prior interrupt request
- **THEN** the observed resume fact correlates to the request
- **AND** no resume command is issued by AgentLens

#### Scenario: Resume is not explicit
- **WHEN** later activity follows an interrupt without an explicit resume fact
- **THEN** the matrix remains partial/not observable for resume and no resume is inferred

#### Scenario: Parent-child relationship exists without handoff
- **WHEN** LangGraph callbacks record only nesting/parent-run identity
- **THEN** projection may preserve parent-child correlation but emits no handoff edge

#### Scenario: Handoff is explicitly recorded
- **WHEN** native command/metadata/event evidence explicitly records handoff/delegation and a resolvable target
- **THEN** projection emits the relationship with source evidence

#### Scenario: Handoff target is unresolved
- **WHEN** explicit handoff evidence names a missing target
- **THEN** no edge or target activity is fabricated

### Requirement: Safety and unknown-telemetry behavior are fixture-backed
The LangGraph corpus SHALL include explicit failure, unresolved target, overlapping activities without causal evidence, and unknown telemetry scenarios.

#### Scenario: Non-causal overlap is projected
- **WHEN** two fixture activities overlap without explicit relationship evidence
- **THEN** no causal edge is emitted

#### Scenario: Unknown metadata is present
- **WHEN** a fixture contains unsupported LangGraph-version-specific metadata
- **THEN** supported facts still project correctly and no unsupported semantic is fabricated

#### Scenario: Projected semantic is traced
- **WHEN** any covered matrix fact is asserted
- **THEN** the test can identify its source telemetry and translation provenance

### Requirement: Legacy comparison is a secondary regression aid
Conformance MAY compare current results with the pre-refactor baseline to identify regressions, but native fixture expectations SHALL remain authoritative.

#### Scenario: Legacy comparison differs from native oracle
- **WHEN** legacy behavior and fixture-declared native facts disagree
- **THEN** the difference is documented as correction, unsupported coverage, or regression against native facts
- **AND** legacy equality does not override the native oracle

### Requirement: Deferred abstractions remain deferred
This change SHALL NOT add a public RuntimeEvidence schema, generalized profile/capability framework, second projector, second framework integration, production cutover, approval control, or resume control.

#### Scenario: Completed iteration is reviewed
- **WHEN** implementation and artifacts are inspected
- **THEN** work is limited to the LangGraph reference integration, private translation/facts, current projection, fixtures, matrix, native references, and tests
