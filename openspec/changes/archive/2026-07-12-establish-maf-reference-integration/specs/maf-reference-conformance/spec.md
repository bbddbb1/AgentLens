## ADDED Requirements

### Requirement: Real MAF behavior is the primary conformance oracle
The conformance suite SHALL run the pinned real MAF workflow through native telemetry, explicit request observation, private bridge registration, AgentLens decision API, one-time bridge claim, native MAF response, correlated result telemetry, persistence, and public replay/interaction responses. Expected MAF workflow behavior and native facts SHALL be primary over legacy projection equality.

#### Scenario: Full positive path runs
- **WHEN** the reference workflow reaches its native request and receives its supported positive or structured response through AgentLens
- **THEN** MAF follows the expected native continuation
- **AND** AgentLens separately records request, decision, delivery acceptance, and telemetry-confirmed runtime outcome

#### Scenario: Explicit failure path runs
- **WHEN** the reference workflow follows an explicit failure path
- **THEN** real MAF failure evidence reaches `span_projection.v1`
- **AND** AgentLens never represents the failed activity as successful

### Requirement: The primary harness identifies real components and doubles
The repeatable system harness SHALL use real MAF execution, real OTel/AgentLens OTLP ingestion, real AgentLens HTTP/service authentication, real private bridge HTTP, and a real PostgreSQL test database. It SHALL explicitly identify the deterministic model client and any other test doubles in its manifest and output.

#### Scenario: Harness manifest is inspected
- **WHEN** the end-to-end target starts
- **THEN** it reports the installed MAF version and which MAF, OTel, HTTP, PostgreSQL, bridge, and model components are real or doubled

#### Scenario: Persistence is verified
- **WHEN** the full path completes
- **THEN** interaction, decision, binding, delivery, and runtime-outcome state is read back from the real PostgreSQL-backed API rather than asserted only from in-memory objects

### Requirement: Conformance covers success, ambiguity, restart, authentication, and security paths
The suite SHALL cover successful Tool/Agent and executor lifecycle, explicit failure, actionable request, supported continuation, accepted delivery without outcome, runtime failure after acceptance, duplicate decision/polling, bridge restart after durable claim, fixture-driven optional identity, missing/conflicting required identity, expired binding, fail-closed missing/invalid authentication, authenticated wrong framework/mission/branch scope, control reference without service authentication, unrelated later activity, and public-output non-disclosure.

#### Scenario: Duplicate decision and polling are exercised
- **WHEN** the decision request and bridge polling are repeated
- **THEN** MAF receives no more than one response application for the delivery

#### Scenario: Bridge restart after claim is exercised
- **WHEN** the bridge restarts and re-registers after Core durably recorded the delivery claim
- **THEN** Core does not reissue the delivery and the restarted bridge does not apply it again
- **AND** no durable bridge-side journal is required

#### Scenario: Identity is missing or conflicting
- **WHEN** required mission/branch/framework/workflow/request identity is missing or any explicit required/consistency identity conflicts
- **THEN** the request remains non-actionable and diagnostics identify the limitation

#### Scenario: Optional source executor identity is absent
- **WHEN** all fixture-required identity matches but source executor ID is absent on one side and the fixture has not proven it required
- **THEN** the request is not rejected solely for that optional absence

#### Scenario: MAF authentication fails closed
- **WHEN** MAF is enabled without configured service authentication, authentication is missing/invalid, a control reference is presented without service authentication, or valid authentication targets the wrong framework/mission/branch
- **THEN** governance endpoints/actionability fail without issuing a delivery
- **AND** observability remains operational

#### Scenario: Accepted without outcome is exercised
- **WHEN** native response acceptance is recorded but terminal evidence is intentionally absent
- **THEN** runtime outcome remains unknown

#### Scenario: Public outputs are scanned
- **WHEN** the full workflow has registered and used a private MAF binding
- **THEN** public API, realtime, replay, graph, explanation, audit, and UI outputs contain no raw/recoverable control reference, workflow object/state, queue, checkpoint payload, secret, or response credential

### Requirement: Existing LangGraph behavior remains an acceptance gate
All existing LangGraph observability, governance, identity, delivery, security, projection, and UI tests SHALL remain passing. Core framework-neutral corrections SHALL preserve LangGraph binding data, exact identity policy, feature-gate behavior, and bridge operation.

#### Scenario: Generic binding storage is migrated
- **WHEN** existing LangGraph bindings and interactions are exercised after the Core correction
- **THEN** framework-scoped lookup, renewal, claim, and receipt preserve their prior behavior
- **AND** MAF bindings cannot authenticate against them

#### Scenario: Projection regressions run
- **WHEN** MAF conformance is validated
- **THEN** existing LangGraph fixtures still use `span_projection.v1` and retain their expected native facts

### Requirement: A code-grounded cross-framework boundary report is produced
The completed implementation SHALL publish a report classifying observed boundaries as reusable without change, framework-specific, legitimate framework-neutral correction, remaining LangGraph coupling, unnecessary abstraction, or deferred common-interface candidate. The report SHALL cite concrete modules/tests and SHALL NOT introduce a public shared adapter interface.

#### Scenario: Reusable Core behavior is assessed
- **WHEN** the report evaluates normalization, projection, interaction persistence, decisions, delivery, UI, security, and idempotency
- **THEN** each item identifies evidence of reuse or the exact Core correction required

#### Scenario: Framework-specific behavior is assessed
- **WHEN** the report evaluates telemetry enrichment, native identity, execution binding, decision translation, and outcome correlation
- **THEN** it distinguishes MAF and LangGraph implementations without forcing one framework's concepts into the other

#### Scenario: Interface candidate appears proven
- **WHEN** both bridges reveal a possible shared interface
- **THEN** the report records it as a deferred candidate
- **AND** this change exports no public `RuntimeAdapter`, `GovernanceAdapter`, `TelemetryProfile`, or equivalent contract

### Requirement: Full validation passes without architectural expansion
The completed change SHALL pass MAF and LangGraph Python tests, API and web tests, builds/type checks, security scans, and strict OpenSpec validation while retaining `span_projection.v1` as the only production projector.

#### Scenario: Validation suite completes
- **WHEN** implementation is ready for acceptance
- **THEN** all affected validation commands pass
- **AND** no second projector, adapter registry, plugin system, generalized command bus, or public RuntimeEvidence model has been added
