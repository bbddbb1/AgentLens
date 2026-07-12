## Purpose

Define evidence-backed MAF interaction observation, identity, decisions, and existing Govern UI behavior.

## Requirements

### Requirement: Only an explicit native MAF request creates an interaction
AgentLens SHALL represent an actionable MAF interaction only from a real native `request_info` event with source telemetry/native-event provenance and a compatible live MAF bridge binding. Inactivity, idle-with-pending state alone, checkpoint existence, graph position, names, or timing SHALL NOT create an interaction.

#### Scenario: Explicit request and binding match
- **WHEN** a real MAF `request_info` event is ingested and an active matching MAF binding exists
- **THEN** one existing-shape AgentLens interaction becomes actionable in the same mission and branch
- **AND** it retains the related workflow/executor activity and native source references

#### Scenario: Binding exists without native request
- **WHEN** a MAF bridge registers live context but no explicit `request_info` event has been observed
- **THEN** AgentLens creates no actionable interaction

#### Scenario: Workflow is merely idle with pending work
- **WHEN** a workflow status suggests pending requests but no identifiable native request event exists
- **THEN** AgentLens does not infer request identity, response schema, or actionability

### Requirement: MAF actionability uses a fixture-driven minimal identity policy
The MAF reference policy SHALL require mission, branch, framework, workflow ID, and request ID. Source executor ID SHALL be a consistency field unless the real MAF 1.10.0 reference fixture proves it is required for correct native response routing. Missing optional fields SHALL NOT make an otherwise valid request non-actionable, while conflicting explicit required or consistency values SHALL block governance.

#### Scenario: Required identity matches with optional field absent
- **WHEN** mission, branch, framework, workflow ID, and request ID match and an optional source executor or correlation field is missing on one side
- **THEN** identity remains a valid partial match and does not block actionability

#### Scenario: Fixture proves executor is required
- **WHEN** the real MAF 1.10.0 reference fixture demonstrates native response routing cannot be performed safely without source executor ID
- **THEN** the route-local constant MAF policy promotes source executor ID to a required key

#### Scenario: Explicit consistency identity conflicts
- **WHEN** both observation and binding record different source executor or other consistency values
- **THEN** AgentLens records an identity conflict and keeps the request non-actionable

### Requirement: MAF interactions preserve their native response contract safely
An observed MAF request SHALL retain mission/branch, workflow/executor activity, native request ID/type, response type, supported decision mapping, display-safe request data or schema, source references, actionability, and identity diagnostics. Complete workflow state, queues, checkpoint payloads, secrets, and private control references SHALL remain excluded.

#### Scenario: Structured native response is supported
- **WHEN** the reference request expects a typed structured response representable by existing validation
- **THEN** the interaction exposes the corresponding safe schema and supported structured-response control
- **AND** the existing structured-input validator validates the submitted value

#### Scenario: Response type is unsupported
- **WHEN** MAF requests a response type that the reference bridge cannot safely construct
- **THEN** the observation remains visible with a limitation
- **AND** actionability and controls remain unavailable

### Requirement: MAF reuses existing decision and actionability semantics
MAF interactions SHALL use the existing durable decision record, actor/audit provenance, structured-value bounds, idempotency identity, one-decision rule, mission/branch isolation, and separate request/decision/delivery/outcome fields. These Core state machines SHALL NOT be copied into MAF-specific persistence or route logic.

#### Scenario: Supported decision is submitted
- **WHEN** an actor submits a request-declared valid response through the existing decision API
- **THEN** the decision is durably and idempotently recorded using existing semantics
- **AND** delivery becomes pending without claiming native continuation

#### Scenario: Duplicate decision is submitted
- **WHEN** the same canonical response and idempotency key is repeated
- **THEN** the original decision/delivery identity is returned
- **AND** no second MAF response instruction is created

#### Scenario: Framework or branch differs
- **WHEN** a decision or binding targets another framework, mission, or branch
- **THEN** MAF actionability and delivery reject the mismatch

### Requirement: The existing Govern UI supports MAF without specialization
The existing Govern components SHALL render a MAF interaction through the current public shape, show only declared controls, use existing structured-input validation, display decision/delivery/runtime outcome separately, disable action after decision or resolution, and distinguish bridge failure from runtime failure. No MAF-specific dashboard or framework selector SHALL be introduced.

#### Scenario: Actionable MAF request is displayed
- **WHEN** the Govern tab receives an actionable MAF interaction
- **THEN** it uses the same components as a LangGraph interaction
- **AND** shows only MAF-declared supported responses

#### Scenario: Delivery fails before runtime acceptance
- **WHEN** the MAF bridge reports delivery failure
- **THEN** the UI labels bridge delivery failure separately
- **AND** does not present the MAF workflow as failed without runtime evidence

#### Scenario: Delivery is accepted without terminal outcome
- **WHEN** MAF accepts the response but correlated terminal evidence is absent
- **THEN** the UI shows accepted delivery and unknown runtime outcome
- **AND** does not show continued or completed
