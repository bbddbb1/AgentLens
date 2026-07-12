## Purpose

Define the private MAF governance bridge, its shared durable delivery lifecycle, and independent feature-gate behavior.

## Requirements

### Requirement: The MAF bridge owns native execution context
The private MAF bridge SHALL own the live workflow/application object, pending request-response context, any MAF-specific execution or checkpoint state required by the reference workflow, and the opaque control binding. AgentLens Core SHALL receive none of those native objects and SHALL provide only the existing framework-neutral decision/delivery payload.

#### Scenario: Bridge claims a pending decision
- **WHEN** an authenticated live MAF binding claims delivery
- **THEN** Core returns only interaction request ID, decision ID, decision type, validated value, and delivery ID
- **AND** the bridge resolves the corresponding local MAF workflow and pending request

#### Scenario: Native context is inspected publicly
- **WHEN** API, realtime, replay, graph, explanation, audit, or UI outputs are serialized
- **THEN** they contain no live workflow object, queue, checkpoint payload, response token, raw control reference, or executable state

### Requirement: The bridge applies the installed MAF native response operation
The MAF bridge SHALL translate only reference-scenario-supported decisions into the exact response type expected by the native request and SHALL continue the live workflow through MAF 1.10.0 `Workflow.run(responses={request_id: value}, ...)` or its verified installed equivalent. Unknown mappings or stale native requests SHALL cause no workflow mutation.

#### Scenario: Positive or structured response is delivered
- **WHEN** the bridge claims a supported decision for a still-pending native request
- **THEN** it constructs the verified native response value and submits it under the exact MAF request ID

#### Scenario: Native request is stale
- **WHEN** the request ID is no longer pending on the bound live workflow
- **THEN** the bridge reports stale and performs no response application

#### Scenario: Decision mapping is unsupported
- **WHEN** the bridge cannot safely construct the expected MAF response type
- **THEN** it reports delivery failure without mutating workflow state

### Requirement: Core governance lifecycle is shared and framework-scoped
MAF SHALL use the existing binding lease, service authentication, durable one-time claim, accepted/failed/stale/unknown delivery, monotonic runtime outcome, idempotency, and public scrubbing services. Core's durable claim record SHALL be the cross-restart guarantee that prevents a delivery instruction from being issued twice. Bridge-local seen-delivery tracking SHALL be only an in-process duplicate-handling safeguard, SHALL NOT be represented as restart-safe, and SHALL NOT introduce a second durable bridge journal. Private binding lookup and claims SHALL include framework, mission, and branch so MAF and LangGraph control authority cannot cross. The explicit LangGraph and MAF route modules SHALL pass only small constant expected-framework/required-key/consistency-key policies directly to the shared private matcher.

#### Scenario: MAF binding claims MAF decision
- **WHEN** an active unexpired MAF binding authenticates in its mission/branch
- **THEN** the shared claim lifecycle reserves at most one delivery instruction
- **AND** external delivery remains pending until native acceptance receipt

#### Scenario: Bridge restarts after durable claim
- **WHEN** a MAF bridge claims a delivery, restarts, re-registers, and polls again
- **THEN** Core does not reissue the previously claimed delivery instruction
- **AND** the restarted bridge does not apply that delivery again

#### Scenario: In-process duplicate handling repeats
- **WHEN** one bridge process receives duplicate handling for the same delivery ID
- **THEN** its process-local safeguard suppresses the duplicate
- **AND** that safeguard is not persisted or treated as the cross-restart guarantee

#### Scenario: MAF binding attempts LangGraph claim
- **WHEN** a MAF control reference targets a LangGraph interaction or binding
- **THEN** authentication/actionability fails without issuing a decision payload

#### Scenario: Route identity policies are wired directly
- **WHEN** the MAF and LangGraph private route modules configure identity matching
- **THEN** each passes a small constant policy object directly to the shared private matcher
- **AND** no policy registry, strategy framework, adapter factory, dynamic dispatch, discovery mechanism, or public policy contract exists

#### Scenario: Binding expires
- **WHEN** a MAF binding lease expires before claim
- **THEN** it cannot make the request actionable or claim delivery

#### Scenario: Claim becomes uncertain
- **WHEN** the bridge may have submitted a response but loses certainty before receipt
- **THEN** shared delivery state becomes unknown
- **AND** the response is not automatically reissued

### Requirement: MAF and LangGraph governance flags remain independent
MAF governance SHALL be disabled by default behind its own feature flag and SHALL require existing service authentication. When `MAF_GOVERNANCE_ENABLED=true` but service authentication is not configured, MAF governance endpoints and actionability SHALL fail closed as unavailable while MAF observability continues. A private control reference SHALL NOT substitute for service authentication. Enabling or disabling MAF SHALL NOT enable, disable, authorize, or mutate LangGraph governance, and observability for either framework SHALL remain available independently.

#### Scenario: Only MAF governance is enabled
- **WHEN** MAF governance and service authentication are configured but LangGraph governance is disabled
- **THEN** MAF bridge endpoints may operate for MAF bindings
- **AND** LangGraph control endpoints remain disabled

#### Scenario: MAF governance is disabled
- **WHEN** explicit MAF requests are observed while its feature flag is off
- **THEN** observability remains available and requests remain non-actionable
- **AND** no MAF delivery can be claimed

#### Scenario: MAF is enabled without configured service authentication
- **WHEN** `MAF_GOVERNANCE_ENABLED=true` and no service credential is configured
- **THEN** MAF governance endpoints and request actionability remain unavailable
- **AND** MAF telemetry ingestion, replay, and `span_projection.v1` observability continue operating

#### Scenario: Service authentication is missing or invalid
- **WHEN** a MAF bridge request omits service authentication or supplies an invalid credential
- **THEN** it is rejected before binding or control-reference authorization

#### Scenario: Control reference is presented without service authentication
- **WHEN** a caller presents a valid private control reference but no valid service authentication
- **THEN** MAF governance rejects the request and issues no decision payload

#### Scenario: Correct authentication targets the wrong scope
- **WHEN** a correctly authenticated caller presents a binding/control reference for the wrong framework, mission, or branch
- **THEN** binding lookup, actionability, and claim fail without issuing or applying a delivery

### Requirement: MAF runtime outcome is explicitly correlated evidence
AgentLens SHALL update MAF runtime outcome only from an explicit native result or adapter telemetry correlated to the MAF request and AgentLens delivery. This SHALL remain an evidence-backed observation and SHALL NOT create a separate AgentLens outcome authority. Decision recording, claim, HTTP success, checkpoint creation, or unrelated later workflow activity SHALL NOT prove continuation.

#### Scenario: Native continuation succeeds
- **WHEN** MAF accepts the response and emits a correlated successful output or completion for that request/delivery
- **THEN** runtime outcome advances to the supported continued/success result with source references

#### Scenario: Accepted delivery lacks runtime result
- **WHEN** native acceptance is recorded but no correlated terminal result is observed
- **THEN** delivery remains accepted and runtime outcome remains unknown

#### Scenario: Runtime fails after acceptance
- **WHEN** a correlated executor/workflow failure occurs after response acceptance
- **THEN** delivery remains accepted and runtime outcome becomes failed

#### Scenario: Delivery fails before acceptance
- **WHEN** native response submission fails before MAF accepts it
- **THEN** delivery becomes failed and runtime outcome is not marked failed solely from the bridge error

#### Scenario: Unrelated workflow activity occurs later
- **WHEN** later MAF spans lack explicit request/delivery correlation
- **THEN** they do not change the interaction's runtime outcome
