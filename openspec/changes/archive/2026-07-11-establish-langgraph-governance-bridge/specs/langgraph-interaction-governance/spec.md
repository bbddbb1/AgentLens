## ADDED Requirements

### Requirement: Only explicit LangGraph interrupts become actionable requests
AgentLens SHALL create an actionable LangGraph interaction only when an explicit source-traceable LangGraph interrupt request has been ingested and a compatible live LangGraph bridge binding exists for the same mission, branch, request, and exact native identity match. Inactivity, graph position, timing, or a paused-looking trace SHALL NOT create an actionable request. A binding is live only when its lifecycle state is `active` and its lease has not expired.

#### Scenario: Explicit interrupt and bridge binding match
- **WHEN** adapter telemetry explicitly records a LangGraph interrupt request and an active, unexpired bridge binding matches under the exact identity rules
- **THEN** the existing interaction model exposes one actionable request for that mission and branch
- **AND** it retains the related activity, interrupt identity, native observational identity, and source telemetry references

#### Scenario: Interrupt is observed without a binding
- **WHEN** an explicit LangGraph interrupt is ingested but no active, unexpired bridge binding matches
- **THEN** AgentLens may display the observation as non-actionable
- **AND** it does not offer decision controls

#### Scenario: Binding exists without interrupt evidence
- **WHEN** a bridge registers execution context but no explicit interrupt request telemetry has been ingested
- **THEN** AgentLens does not create an actionable UI interaction

#### Scenario: Trace merely appears paused
- **WHEN** a LangGraph trace has no activity for a period but records no explicit interrupt
- **THEN** AgentLens creates no interaction request from that absence

#### Scenario: Binding lease has expired
- **WHEN** an otherwise matching bridge binding is expired, revoked, or consumed
- **THEN** the request is not actionable
- **AND** that binding cannot claim decisions

### Requirement: Exact identity matching gates actionability
AgentLens SHALL match an observed interrupt to a private bridge binding using deterministic field equality. Required matching fields SHALL include mission ID, branch ID, framework=`langgraph`, interaction or interrupt request ID, and thread ID where required by the reference graph. When both sides provide run ID, parent-run ID, checkpoint ID and namespace, or activity-correlation ID, AgentLens SHALL verify consistency. Missing required fields SHALL make the request non-actionable. Conflicting explicit values SHALL produce an identity-conflict diagnostic and block actionability. Absence of an optional consistency field on one side SHALL remain partial rather than conflicting. Matching SHALL NOT use names, timing, topology, fuzzy inference, or `native_execution_key`. Observational identifiers SHALL NOT serve as authentication credentials.

#### Scenario: Required fields match
- **WHEN** both sides present equal required matching fields and no consistency field conflicts
- **THEN** identity matching succeeds for actionability reconciliation

#### Scenario: Required field is missing
- **WHEN** a required matching field is absent on either the observation or the binding
- **THEN** the request is non-actionable

#### Scenario: Optional consistency field is partial
- **WHEN** one side omits an optional consistency field that the other side provides
- **THEN** AgentLens treats the identity as partial rather than conflicting
- **AND** does not block solely for that absence when all required fields match

#### Scenario: Explicit identity conflict
- **WHEN** both sides provide different explicit values for the same required or consistency field
- **THEN** AgentLens records an identity-conflict diagnostic
- **AND** the request is not actionable

#### Scenario: Fuzzy or observational credentials are rejected for matching
- **WHEN** a caller or reconciler would rely on names, timing, topology, fuzzy inference, or `native_execution_key` to associate binding and interrupt
- **THEN** AgentLens does not treat that association as a successful identity match

### Requirement: Interaction requests expose only supported and display-safe input
Each actionable request SHALL record its request type, supported decision types, lifecycle state, display-safe prompt or input schema when explicitly available, and source provenance. AgentLens SHALL NOT expose complete interrupt values, checkpoint state, secrets, resume tokens, or executable bridge references in the interaction record.

#### Scenario: Structured input is supported
- **WHEN** the reference graph records an interrupt whose bridge declares a bounded structured input schema
- **THEN** the interaction response exposes that safe schema and a `respond` decision option
- **AND** it does not expose the graph state or checkpoint payload

#### Scenario: Decision type is unsupported
- **WHEN** the current LangGraph scenario does not truthfully implement a decision type
- **THEN** that decision type is absent from the request's supported controls

#### Scenario: Unknown interaction type arrives
- **WHEN** explicit telemetry records an interaction type the bridge does not support
- **THEN** AgentLens preserves the observation and limitation safely
- **AND** marks it non-actionable without inferring a command mapping

### Requirement: User decisions are durable, auditable, and distinct from runtime state
AgentLens SHALL record an accepted user decision with an immutable decision identity, interaction request identity, actor, decision type, submitted value when applicable, timestamp, idempotency identity, and audit provenance. Recording the decision SHALL NOT mark delivery accepted or the LangGraph runtime resumed.

#### Scenario: Supported decision is submitted
- **WHEN** an authorized actor submits a decision type and value supported by an actionable request
- **THEN** AgentLens durably records the decision and its audit provenance
- **AND** sets delivery to pending without changing runtime outcome to resumed

#### Scenario: Submitted value violates the request schema
- **WHEN** a structured response does not satisfy the request's recorded safe schema
- **THEN** AgentLens rejects the submission without recording a decision or delivery attempt

#### Scenario: Actor identity is limited
- **WHEN** the deployment has no stronger authenticated principal for the request
- **THEN** the decision records an explicit unknown or local-operator actor condition and request provenance
- **AND** does not invent a human identity

### Requirement: Structured decision values are conservatively bounded
AgentLens SHALL enforce maximum serialized size, maximum nesting depth, and maximum collection sizes for operator-supplied structured decision values. Allowed value types SHALL be limited to JSON-like object, array, string, number, boolean, and null. Schema validation SHALL occur before decision recording. Binary payloads and unsupported arbitrary objects SHALL be rejected. Public display of decision fields SHALL use an explicit allowlist. Decision values SHALL NOT automatically enter OTLP telemetry, replay, graph, explanation, or unrestricted audit output. Audit records SHALL use a safe summary or redacted representation where appropriate. Secrets, tokens, credentials, or equivalent sensitive inputs are outside this iteration unless handled through an existing dedicated secret mechanism. No generalized data-classification platform is required.

#### Scenario: Oversized or over-deep structured input is rejected
- **WHEN** a structured decision value exceeds the configured serialized size, nesting depth, or collection-size limit
- **THEN** AgentLens rejects the submission without recording a decision

#### Scenario: Unsupported value type is rejected
- **WHEN** a structured decision contains binary data or a non-JSON-like arbitrary object
- **THEN** AgentLens rejects the submission without recording a decision

#### Scenario: Decision value is excluded from public observational outputs
- **WHEN** a structured decision has been recorded
- **THEN** OTLP telemetry, replay, graph, and explanation outputs do not automatically include the full decision value
- **AND** unrestricted audit output does not expose the full value without a safe summary or redaction

#### Scenario: Public decision display is allowlisted
- **WHEN** an operator API or UI presents decision information
- **THEN** only explicitly allowlisted decision fields are shown

### Requirement: Decision recording is idempotent and final for the request
AgentLens SHALL make repeated submission of the same canonical decision and idempotency identity a no-op, SHALL reject reuse of that identity with different content, and SHALL reject a different decision after the request has a recorded decision or has become stale or resolved.

#### Scenario: Same decision is repeated
- **WHEN** the same request receives the same decision content and idempotency identity more than once
- **THEN** every response identifies the original recorded decision
- **AND** no additional delivery is created

#### Scenario: Idempotency identity is reused with different content
- **WHEN** a caller reuses a decision idempotency identity with a different decision type or value
- **THEN** AgentLens returns a conflict and preserves the original decision

#### Scenario: Request is already resolved
- **WHEN** a caller submits a decision for a stale, expired, or resolved request
- **THEN** AgentLens rejects the submission and does not schedule native delivery

### Requirement: Existing Govern UI presents truthful governance state
The existing Govern/HITL UI SHALL show the pending request, only its supported controls, decision state, delivery state, and runtime-outcome state. It SHALL label delivery failure separately from runtime failure and SHALL prevent further decision action after a decision is recorded or the request is stale or resolved. Internal bridge claim state SHALL NOT be required on the operator UI. When LangGraph governance is unavailable or the governance feature flag is disabled, operator decision controls SHALL remain hidden or non-actionable.

#### Scenario: Actionable request is pending
- **WHEN** the Govern tab renders an actionable LangGraph request
- **THEN** it shows the display-safe request and only the decision controls declared by that request

#### Scenario: Delivery fails after decision recording
- **WHEN** a recorded decision has `delivery_state=failed`
- **THEN** the UI preserves the recorded decision and labels the bridge delivery failure
- **AND** it does not label the LangGraph runtime as failed unless runtime evidence says so

#### Scenario: Delivery is accepted without outcome evidence
- **WHEN** the bridge accepted delivery but correlated runtime outcome evidence has not arrived
- **THEN** the UI shows accepted delivery and an unknown or awaiting runtime outcome
- **AND** it does not show resumed

#### Scenario: Governance feature flag is disabled
- **WHEN** the LangGraph governance feature flag is off or governance is otherwise unavailable
- **THEN** operator decision controls are hidden or non-actionable
- **AND** observational interrupt display may still appear where already supported
