## ADDED Requirements

### Requirement: LangGraph telemetry-convention translation is centralized
AgentLens SHALL translate matrix-covered LangGraph, OpenTelemetry, GenAI, and current AgentLens compatibility keys/events in dedicated pure normalization helpers outside generic replay/graph construction.

#### Scenario: LangGraph-specific marker is interpreted
- **WHEN** recorded telemetry contains a supported LangGraph-native marker
- **THEN** the LangGraph translation helper maps only the explicit native fact and provenance
- **AND** generic projection construction does not inspect the framework key

#### Scenario: Standard or compatibility convention is interpreted
- **WHEN** OTel, GenAI, or AgentLens compatibility telemetry records a matrix fact
- **THEN** the owning normalization helper maps it once for the current projector

#### Scenario: Complete LangGraph state is present
- **WHEN** callback inputs or metadata include application/checkpoint state beyond required references
- **THEN** normalization excludes the state payload from projection facts

### Requirement: Normalization is deterministic and deduplicates overlapping conventions
Equivalent telemetry SHALL produce equivalent normalized facts regardless of span-array order. Multiple conventions describing one invocation SHALL NOT create duplicate activities or contradictory lifecycle state.

#### Scenario: Same spans are reordered
- **WHEN** an equivalent fixture span set is presented in a different array order
- **THEN** normalized matrix facts, identifiers, references, and projected semantics remain equivalent

#### Scenario: Multiple conventions describe one Tool invocation
- **WHEN** generic lifecycle plus GenAI/AgentLens fields describe the same Tool call
- **THEN** normalization produces one correlated Tool activity with combined traceability

#### Scenario: Repeated same-name invocations occur
- **WHEN** multiple same-name Tool, LLM, or Retrieval activities have distinct recorded run/correlation IDs
- **THEN** normalization keeps them distinct

### Requirement: Native runtime facts are not inferred from weak signals
Normalization SHALL require explicit source evidence for framework identity, activity type, failure, thread/run identity, interrupt/resume, handoff, token usage, checkpoint reference, and relationships. Names, timing, later activity, and LLM interpretation SHALL be insufficient.

#### Scenario: Parent-child callbacks are observed
- **WHEN** LangGraph telemetry records only parent/child nesting
- **THEN** normalization records parent-child correlation
- **AND** does not label it handoff without explicit handoff evidence

#### Scenario: Retrieval is not explicitly identified
- **WHEN** a Tool name resembles retrieval but no retriever callback or explicit retrieval marker exists
- **THEN** normalization does not claim native Retrieval coverage

#### Scenario: Later activity follows an interrupt
- **WHEN** later activity occurs without an explicit resume marker or identity
- **THEN** normalization does not infer that the interrupt resumed

### Requirement: Failure and unresolved relationships remain safe
Explicit failure SHALL dominate completion/default success. Unresolved targets SHALL remain traceable and SHALL NOT create projected edges or nodes.

#### Scenario: Success-like and failure evidence conflict
- **WHEN** one activity has explicit failure plus completion-like evidence
- **THEN** the normalized outcome is failed
- **AND** the conflicting sources remain traceable

#### Scenario: Handoff target is missing
- **WHEN** explicit handoff telemetry references a target absent from normalized activities
- **THEN** no graph edge or fabricated target is produced

### Requirement: Unknown telemetry degrades safely
Unknown callbacks, attributes, events, or LangGraph-version-specific metadata SHALL NOT crash normalization or create unsupported authoritative semantics.

#### Scenario: Unknown telemetry accompanies supported facts
- **WHEN** a fixture contains an unknown event or attribute
- **THEN** supported facts still normalize and project correctly
- **AND** the unknown input is ignored or exposed as a traceable diagnostic
