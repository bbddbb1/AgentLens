## Purpose

Define the pinned MAF reference workflow, its fixture-backed capability evidence, and native observability boundaries.

## Requirements

### Requirement: The MAF reference version is exact and fixture-visible
The reference integration SHALL install and lock Microsoft Agent Framework Core 1.10.0, SHALL assert that resolved version during fixture generation and tests, and SHALL record it in capability and fixture metadata. Telemetry expectations SHALL NOT be generated under an unrecorded or different MAF version.

#### Scenario: Reference fixtures are generated
- **WHEN** the MAF fixture generator runs
- **THEN** it verifies the installed `agent-framework-core` version is 1.10.0
- **AND** records that version with the generated telemetry and expected native facts

#### Scenario: Installed version drifts
- **WHEN** conformance runs with a different MAF Core version
- **THEN** the version guard fails before treating the fixture expectations as valid for that installed runtime

### Requirement: A real deterministic MAF workflow supplies native facts
The reference scenario SHALL use the real MAF Python workflow runtime with at least an Agent plus an executor or two executors, one explicit Tool or Agent invocation, one successful terminal path, one explicit failure path, one native `request_info` interaction, and the supported positive, structured, or alternative response paths. It SHALL NOT require external model credentials.

#### Scenario: Successful workflow runs
- **WHEN** the deterministic reference workflow follows its successful path
- **THEN** real MAF workflow/executor and Tool or Agent behavior produces the expected native events and telemetry
- **AND** the result is terminal and successful

#### Scenario: Workflow fails explicitly
- **WHEN** the reference input selects the failure path
- **THEN** real MAF executor/workflow behavior emits explicit failure evidence
- **AND** AgentLens does not classify it as success

#### Scenario: Human response is requested
- **WHEN** the review executor reaches its native interaction point
- **THEN** MAF emits a real `request_info` event with request ID, source executor, request type, response type, and request data

### Requirement: The MAF capability assessment is truthful and fixture-backed
The MAF package SHALL maintain a small matrix covering workflow/executor identity, Agent where used, Tool/function invocation, lifecycle, explicit failure, explicit relationships, request ID/type, response correlation, actually exposed native identity, model/token usage, source traceability, and private bridge binding availability/governance binding readiness. Binding readiness SHALL describe whether a compatible private binding is available without exposing an executable control reference as an observability fact. Every row SHALL have a fixture-backed status of `covered`, `partial`, `not_observable`, or `not_applicable`; completion SHALL NOT require every row to be covered.

#### Scenario: Matrix row is covered
- **WHEN** real MAF telemetry or an explicit native event contains a fact
- **THEN** the row identifies its source, fixture, normalized mapping, projected surface, and expected native assertion

#### Scenario: Fact is unavailable or conditional
- **WHEN** MAF 1.10.0 or the reference scenario does not expose sufficient evidence for a row
- **THEN** the row remains `partial`, `not_observable`, or `not_applicable` with a tested limitation
- **AND** no inference or broader state inspection is added merely to improve coverage

### Requirement: MAF observability preserves explicit facts and source evidence
AgentLens SHALL preserve explicit workflow, executor, Agent, Tool, lifecycle, failure, native identity, token/model where emitted, and relationship facts from native telemetry or explicit adapter enrichment. Every matrix-backed semantic SHALL remain traceable to its source span/event or native workflow event.

#### Scenario: Native workflow and executor spans are ingested
- **WHEN** MAF emits `workflow.*`, `executor.*`, standard GenAI, status, or error telemetry
- **THEN** normalization preserves supported facts and source references
- **AND** current projection represents them without MAF-specific interpretation in generic projection code

#### Scenario: Native relationship is explicit
- **WHEN** parentage, OTel link, or MAF workflow evidence explicitly records a relationship supported by the current ingest shape
- **THEN** the normalized relationship identifies that evidence
- **AND** no relationship is created from timing, names, or execution order alone

#### Scenario: Unknown MAF telemetry arrives
- **WHEN** MAF emits an event or attribute outside the supported reference matrix
- **THEN** processing remains stable and traceable
- **AND** no unsupported lifecycle, relationship, identity, or outcome is fabricated

### Requirement: Native MAF identity remains semantically distinct
The integration SHALL preserve explicitly recorded MAF workflow ID, executor ID, request ID, request/response types, and trace/span correlation using MAF terminology. It SHALL NOT require or synthesize LangGraph thread, run, interrupt, or checkpoint semantics. The fixture-driven reference policy SHALL require mission, branch, framework, workflow ID, and request ID. It SHALL treat source executor ID as a consistency field unless the real MAF 1.10.0 fixture proves it is required for correct native response routing. Missing required identity or explicit conflicts SHALL make the request non-actionable; missing optional identity SHALL NOT block an otherwise valid request.

#### Scenario: MAF request identity is complete
- **WHEN** request telemetry records workflow ID, native request ID, and source executor ID
- **THEN** those values are preserved as MAF native identity with source references

#### Scenario: Optional source executor identity is missing
- **WHEN** mission, branch, framework, workflow ID, and request ID match but source executor ID is absent on one side
- **THEN** the request remains eligible for actionability unless the version-backed reference fixture proves source executor ID is required for native response routing

#### Scenario: LangGraph-shaped fields are absent
- **WHEN** MAF exposes no LangGraph-equivalent thread or run ID
- **THEN** those fields remain absent
- **AND** workflow or request identity is not relabeled to fill them

#### Scenario: Explicit identity conflicts
- **WHEN** explicit observation and bridge binding disagree on workflow, request, or source executor identity
- **THEN** AgentLens records a traceable identity conflict and prevents actionability
