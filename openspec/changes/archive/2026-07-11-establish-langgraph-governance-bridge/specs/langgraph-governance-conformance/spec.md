## ADDED Requirements

### Requirement: A real LangGraph scenario proves the governance path
The conformance suite SHALL run a real LangGraph graph through interrupt, AgentLens observation, API decision, bridge-native delivery, subsequent execution, adapter-produced telemetry, and AgentLens state update. Explicit LangGraph behavior and correlated native facts SHALL be the primary correctness oracle.

#### Scenario: Positive continuation completes end to end
- **WHEN** the reference graph reaches its interrupt and receives its supported approve-equivalent or positive input through the bridge
- **THEN** LangGraph follows the expected continuation path
- **AND** AgentLens separately records the request, decision, accepted delivery, and telemetry-confirmed runtime outcome

#### Scenario: Alternative or reject path is supported
- **WHEN** the checked-in reference graph implements a reject or alternative decision and that decision is submitted
- **THEN** LangGraph follows the explicitly expected native path
- **AND** AgentLens reports the final outcome only after correlated native evidence

#### Scenario: Structured input is supported
- **WHEN** the checked-in graph declares and consumes structured human input
- **THEN** the fixture submits schema-valid input through the bridge and asserts the native result and correlated AgentLens outcome

### Requirement: Conformance covers unsafe and ambiguous paths
The suite SHALL cover delivery failure, duplicate decision submission, stale or already-resolved requests, missing and conflicting native identity, accepted delivery without confirmed runtime outcome, confirmed resume, and runtime failure after accepted delivery.

#### Scenario: Delivery failure is exercised
- **WHEN** the bridge is unavailable or rejects its private binding
- **THEN** the committed decision remains intact, delivery is failed, and runtime failure is not fabricated

#### Scenario: Duplicate submission is exercised
- **WHEN** the same idempotent decision is submitted repeatedly and the bridge polls repeatedly
- **THEN** the reference graph applies no more than one native operation

#### Scenario: Request is stale or resolved
- **WHEN** the native interrupt is already resolved before delivery
- **THEN** the bridge performs no state mutation and AgentLens records the stale/resolved limitation

#### Scenario: Native identity is missing or conflicting
- **WHEN** required native fields are absent or explicit lifecycle values conflict
- **THEN** the request is non-actionable or delivery is blocked with traceable diagnostics

#### Scenario: Accepted delivery has no outcome fixture
- **WHEN** a fixture intentionally omits correlated post-delivery runtime evidence
- **THEN** AgentLens leaves runtime outcome unknown

#### Scenario: Runtime fails after delivery fixture
- **WHEN** the graph accepts the decision and then raises a recorded execution error
- **THEN** conformance asserts accepted delivery and a separate telemetry-backed failed runtime outcome

### Requirement: Conformance covers binding liveness and claim versus acceptance
The suite SHALL exercise binding lease expiry, renewal, revocation, replacement, and restart behavior, as well as claim without acceptance and claim-timeout unknown delivery.

#### Scenario: Binding lease expiry and renewal
- **WHEN** a binding renews before expiry and later is allowed to expire
- **THEN** only the active unexpired period permits actionability and claims
- **AND** the expired binding cannot claim

#### Scenario: Binding revocation and replacement
- **WHEN** the application re-registers and obtains a new control reference
- **THEN** the prior binding is superseded or revoked
- **AND** only the new generation can claim

#### Scenario: Bridge and AgentLens restart behavior
- **WHEN** the bridge restarts and must re-register, and when AgentLens restarts with a persisted unexpired binding
- **THEN** restart semantics match the binding lifecycle rules without indefinite actionability after process disappearance

#### Scenario: Claim without acceptance
- **WHEN** a delivery is claimed but no acceptance receipt is posted
- **THEN** external delivery remains `pending`

#### Scenario: Claim timeout produces unknown delivery
- **WHEN** a claimed delivery's claim deadline elapses without a definitive receipt
- **THEN** delivery becomes `unknown`
- **AND** automatic retry is not performed

### Requirement: Conformance covers exact identity matching and bridge endpoint isolation
The suite SHALL cover exact identity matching, missing required identity, optional partial identity, explicit conflict, and authentication plus mission/branch isolation on bridge endpoints.

#### Scenario: Exact identity match succeeds
- **WHEN** required fields match and consistency fields do not conflict
- **THEN** reconciliation may make the request actionable given an active binding

#### Scenario: Missing required identity
- **WHEN** a required matching field is absent
- **THEN** the request remains non-actionable

#### Scenario: Optional partial identity
- **WHEN** an optional consistency field is present on only one side
- **THEN** matching remains partial rather than conflicting

#### Scenario: Explicit identity conflict
- **WHEN** both sides provide conflicting explicit values for the same field
- **THEN** actionability is blocked with a diagnostic

#### Scenario: Bridge endpoint authentication and isolation
- **WHEN** a bridge call lacks service authentication or crosses mission/branch isolation
- **THEN** the call is rejected without treating observational identifiers as credentials

### Requirement: Conformance covers out-of-order reconciliation
The suite SHALL cover receipts and runtime telemetry arriving in different orders and non-regression under late or duplicate events, including telemetry before accepted receipt, duplicate outcome telemetry, late accepted receipt after runtime failure, late failed receipt after accepted delivery, repeated stale receipts, and duplicate decision or delivery correlation events.

#### Scenario: Telemetry before accepted receipt
- **WHEN** correlated runtime outcome arrives before the accepted-delivery receipt
- **THEN** outcome is recorded and later acceptance does not clear it

#### Scenario: Late and duplicate events do not regress stronger state
- **WHEN** late or duplicate receipts and telemetry arrive after stronger states are recorded
- **THEN** delivery and runtime outcome remain independent
- **AND** stronger already-recorded states are not regressed

### Requirement: Conformance covers structured-input bounds and feature-flag behavior
The suite SHALL cover structured input size, depth, schema, redaction, and public-output exclusion, as well as feature-flag enabled and disabled behavior.

#### Scenario: Structured input bounds and redaction
- **WHEN** oversized, over-deep, schema-invalid, or binary structured input is submitted, and when a valid decision is recorded
- **THEN** invalid input is rejected
- **AND** valid decision values do not automatically appear in OTLP, replay, graph, explanation, or unrestricted audit output

#### Scenario: Feature flag enabled
- **WHEN** the LangGraph governance feature flag is explicitly enabled for the reference deployment
- **THEN** bridge registration and request actionability may proceed under the other governance rules

#### Scenario: Feature flag disabled
- **WHEN** the feature flag is disabled
- **THEN** new control delivery is prevented, existing records remain, observability through `span_projection.v1` remains available, and operator controls are hidden or non-actionable

### Requirement: Conformance prevents executable-data disclosure
Automated tests SHALL inspect public interrupt responses, realtime messages, replay, graph, explanation, audit views, and UI fixtures to ensure they contain no bridge control reference, checkpoint payload/state, secret, resume token, or recoverable execution credential.

#### Scenario: Public outputs are scanned
- **WHEN** the full reference governance flow has registered a private bridge binding and delivered a decision
- **THEN** every public output contains only allowlisted request, decision, delivery, outcome, observational identity, and source-provenance fields
- **AND** no executable control data is present

#### Scenario: Projection remains on the production path
- **WHEN** the governance conformance suite requests replay, graph, or explanation
- **THEN** it uses `span_projection.v1` and the existing span-backed observation path
- **AND** no second projector or public RuntimeEvidence contract is required

### Requirement: Validation preserves existing observability behavior
The completed change SHALL pass the existing LangGraph observability fixtures, API and UI tests, Python tests, type checks, and strict OpenSpec validation in addition to governance conformance.

#### Scenario: Existing LangGraph fixtures run
- **WHEN** the governance implementation is validated
- **THEN** Agent, LLM, Tool, Retrieval, failure, interrupt/resume observation, identity, checkpoint, relationship, unknown-telemetry, and traceability tests remain passing
- **AND** lifecycle identity tests demonstrate field-wise preservation and conflict detection
