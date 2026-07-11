## ADDED Requirements

### Requirement: LangGraph runtime facts remain private and minimal
AgentLens SHALL use only the smallest internal normalized structure required to carry LangGraph matrix facts into the current production projector. The structure SHALL remain inside the API runtime implementation, SHALL be unversioned, and SHALL NOT be exported as a public RuntimeEvidence protocol.

#### Scenario: Internal facts are constructed
- **WHEN** adapter-produced telemetry is prepared for current replay/graph projection
- **THEN** the private structure contains only fields consumed by matrix-backed semantics and safety checks

#### Scenario: Public protocol is inspected
- **WHEN** completed implementation exports are reviewed
- **THEN** no `runtime_evidence.v1`, public RuntimeEvidence bundle, generalized telemetry profile, or framework capability schema has been added

### Requirement: Internal facts preserve recorded native identity and correlation
The private structure SHALL preserve framework identity, thread/run/parent-run identity, interrupt request identity, checkpoint reference where observable, activity correlation, trace/span correlation, and an optional AgentLens-derived `native_execution_key` when those values are explicitly recorded.

#### Scenario: LangGraph run metadata is observable
- **WHEN** adapter telemetry records run and thread identity
- **THEN** normalized facts retain those identifiers and source references without inferring missing values

#### Scenario: Checkpoint reference is observable
- **WHEN** callback metadata explicitly records a checkpoint identifier or namespace
- **THEN** normalized facts preserve the reference
- **AND** exclude checkpoint payload/state

#### Scenario: Native identifier is unavailable
- **WHEN** a native identity field is not observable in source telemetry
- **THEN** the field remains unavailable and the capability matrix records the limitation

### Requirement: Derived native execution keys are observational only
Any `native_execution_key` SHALL be stable for the same recorded identifiers, SHALL be explicitly identified as AgentLens-derived observational correlation, and SHALL NOT be presented as a framework-owned or executable control reference. It SHALL NOT contain secrets, state payloads, approval decisions, resume commands, resume tokens, or mutable control authority.

#### Scenario: Native execution key is projected
- **WHEN** a matrix-backed activity has sufficient native identity
- **THEN** additive projected metadata carries framework identity, available native IDs, activity correlation, and optional `native_execution_key`

#### Scenario: Future governance bridge needs control authority
- **WHEN** a later governance bridge needs an executable framework control reference
- **THEN** it defines an adapter-owned control reference separately
- **AND** does not reinterpret `native_execution_key` as control authority

#### Scenario: Governance action is attempted
- **WHEN** this iteration's interfaces are inspected for approval or resume behavior
- **THEN** no action endpoint, command, or executable control token exists

### Requirement: Internal facts represent recorded outcomes and explicit relationships only
The private structure SHALL preserve explicit lifecycle/failure and relationship evidence without inferred explanation or causality.

#### Scenario: Explicit failure is recorded
- **WHEN** callback error or telemetry status explicitly records failure
- **THEN** normalized facts retain failure and its source evidence

#### Scenario: Relationship target is unresolved
- **WHEN** source telemetry explicitly names a target that cannot be matched
- **THEN** normalized facts retain a traceable unresolved condition
- **AND** do not fabricate the target

#### Scenario: Activities overlap without relationship evidence
- **WHEN** two activities overlap but record no explicit native/telemetry relationship
- **THEN** normalized facts contain no causal relationship

### Requirement: Internal normalized facts are disposable
AgentLens SHALL derive the private structure from current durable spans/control records on demand and SHALL NOT persist it or treat it as an event ledger.

#### Scenario: Projection is repeated
- **WHEN** the same telemetry is projected more than once
- **THEN** private normalized facts are rebuilt without normalized-fact storage

#### Scenario: Database schema is reviewed
- **WHEN** implementation changes are inspected
- **THEN** no normalized-fact, RuntimeEvidence, checkpoint-payload, or durable-envelope table exists
