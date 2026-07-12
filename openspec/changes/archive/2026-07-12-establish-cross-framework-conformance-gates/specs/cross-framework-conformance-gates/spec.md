## ADDED Requirements

### Requirement: Shared conformance invariants remain bounded and evidence-backed
AgentLens SHALL maintain one static test-only cross-framework manifest limited to behavior already demonstrated by the accepted LangGraph and MAF integrations. Each entry SHALL contain an invariant ID and, for each framework, status, limitation where required, evidence file paths, and explicit repository test commands. The manifest SHALL NOT define shared native telemetry fields, lifecycle names, identities, response APIs, or failure semantics and SHALL NOT use an evidence-provider interface, adapter, registry, dynamic framework mapping, discovery mechanism, or package-import protocol.

#### Scenario: Both frameworks demonstrate a shared boundary
- **WHEN** an invariant is declared shared
- **THEN** the manifest identifies separate LangGraph-owned and MAF-owned evidence file paths and commands proving the applicable AgentLens boundary
- **AND** the shared definition does not require native field or API equivalence

#### Scenario: A proposed invariant is framework-specific
- **WHEN** only one framework's native semantics support an assertion
- **THEN** the assertion remains in that framework package and is not promoted into a shared semantic model

### Requirement: Coverage results are honest and mechanically validated
Every framework/invariant result SHALL declare exactly one of `covered`, `partial`, `not_observable`, or `not_applicable`. A `covered` result SHALL name commands that execute all referenced assertions; a `partial` result SHALL name the supported evidence and state its limitation; `not_observable` and `not_applicable` SHALL state evidence-backed rationales. Manifest validation SHALL mechanically reject invalid statuses, missing limitations, missing evidence paths, and missing commands rather than inventing dynamic evidence discovery.

#### Scenario: Covered evidence passes
- **WHEN** a framework declares an invariant `covered`
- **THEN** every required framework-owned assertion executes successfully and the report links its evidence

#### Scenario: Native behavior differs
- **WHEN** a framework cannot fully demonstrate an invariant because its native behavior differs
- **THEN** the report preserves `partial`, `not_observable`, or `not_applicable` with a concrete limitation or rationale
- **AND** does not fabricate equivalence

### Requirement: Framework-native identity remains semantically distinct
LangGraph and MAF SHALL retain their own native identity terminology and exact identity policies in their private translators, fixtures, bridges, and route policies. Conformance SHALL prove that neither framework is coerced into the other's identity fields and that observational identity is not treated as authentication or executable authority.

#### Scenario: Identity evidence is projected
- **WHEN** either framework emits supported native identity evidence
- **THEN** its framework-owned oracle verifies the identity in native terms
- **AND** generic projection does not reinterpret it as the other framework's identity

#### Scenario: Observational identifier is presented as authority
- **WHEN** a client supplies a native workflow, thread, run, request, interrupt, trace, or checkpoint identifier without valid service authentication and an exact live binding
- **THEN** control is rejected while permitted observability remains available

### Requirement: Generic projection and Core remain free of framework-native interpretation
Architecture and behavior gates SHALL prove that `span_projection.v1`, generic explanation, and shared Core state services consume private normalized facts without interpreting LangGraph- or MAF-native telemetry keys. Framework-specific translation SHALL remain in explicit private framework translators, and no second projector or public runtime evidence/profile/adapter abstraction SHALL be introduced.

#### Scenario: Framework-native telemetry reaches projection
- **WHEN** a LangGraph or MAF fixture is normalized and projected
- **THEN** the framework-owned translator interprets its native keys
- **AND** generic projection produces `span_projection.v1` without direct framework-key interpretation

#### Scenario: Framework logic crosses a generic boundary
- **WHEN** architecture checks detect framework-native key interpretation, a prohibited public adapter/profile/evidence type, a registry/discovery mechanism, or a second projector in generic production code
- **THEN** the conformance gate fails with the owning file and violated boundary

### Requirement: Actionable control requires explicit native interaction evidence
For both frameworks, only explicit framework-native interaction evidence recognized by the framework-owned oracle SHALL create an actionable AgentLens interaction. Checkpoint existence, parent-child structure, temporal overlap, generic workflow activity, or unknown telemetry SHALL NOT create actionable control.

#### Scenario: Explicit interaction is observed
- **WHEN** LangGraph emits an explicit supported interrupt request or MAF emits an explicit supported `request_info`
- **THEN** framework-owned assertions verify the interaction and its exact native binding inputs

#### Scenario: Non-interaction evidence is observed
- **WHEN** telemetry contains only nesting, checkpoint/state references, later workflow activity, overlap, or unknown framework metadata
- **THEN** no actionable control is created

### Requirement: Governance state axes remain separate
Conformance SHALL verify that interaction observation, decision recording, durable claim, delivery acceptance, and runtime outcome remain distinct monotonic states for both frameworks. A decision, claim, HTTP success, accepted receipt, or later runtime activity SHALL NOT by itself prove terminal runtime outcome.

#### Scenario: Delivery is accepted without terminal evidence
- **WHEN** a framework bridge accepts a delivery but no explicitly correlated terminal native evidence is recorded
- **THEN** delivery remains accepted and runtime outcome remains unknown or awaiting interaction according to the existing contract

#### Scenario: Runtime fails after accepted delivery
- **WHEN** explicitly correlated native evidence records a runtime failure after delivery acceptance
- **THEN** delivery remains accepted and runtime outcome becomes failed without rewriting the decision or claim state

### Requirement: Claim and receipt authority are exact-bound
Claim and receipt operations SHALL require service authentication and the exact framework, mission, branch, native identity policy, control reference, and live binding generation required by the owning framework route. A binding or receipt authority for one framework or scope SHALL NOT authorize another.

#### Scenario: Exact binding claims and acknowledges delivery
- **WHEN** an authenticated bridge presents the exact active binding and native identity for a decided interaction
- **THEN** Core issues at most the existing durable one-time claim and accepts receipts only from that authorized binding

#### Scenario: Cross-boundary claim or receipt is attempted
- **WHEN** an authenticated request uses the wrong framework, mission, branch, native identity, control reference, binding, or binding generation
- **THEN** claim or receipt is rejected without mutating decision, delivery, or runtime outcome state

### Requirement: Runtime outcome requires explicit request and delivery correlation
Framework-owned outcome assertions SHALL require explicit correlation from terminal native evidence to the original interaction request and delivery. Completion, failure, or activity sharing only workflow/thread/trace proximity SHALL NOT advance runtime outcome.

#### Scenario: Correlated terminal evidence arrives
- **WHEN** framework-native terminal evidence explicitly identifies the original request and accepted delivery according to that framework's private policy
- **THEN** shared monotonic reconciliation records the supported runtime outcome

#### Scenario: Unrelated later activity arrives
- **WHEN** a later run, workflow, span, checkpoint, or completion lacks explicit request-and-delivery correlation
- **THEN** runtime outcome does not advance

### Requirement: Framework, mission, and branch isolation remain enforced
Fast conformance tests SHALL verify that observation, bindings, decisions, claims, receipts, and outcomes remain isolated by framework, mission, and branch. Each real-system harness SHALL use an isolated database or schema and isolated mission/branch identifiers. Parallel-run conformance testing SHALL be deferred unless current CI executes the gates concurrently or implementation exposes an actual isolation defect.

#### Scenario: Cross-scope control is attempted
- **WHEN** valid credentials and a live binding are used against a different framework, mission, or branch
- **THEN** control is rejected and both scopes retain their prior state

#### Scenario: Real-system harness allocates state
- **WHEN** either framework's real-system gate begins
- **THEN** it uses isolated database or schema state and mission/branch identifiers independent of prior runs

#### Scenario: Concurrency is not demonstrated
- **WHEN** current CI does not run the real-system gates concurrently and implementation finds no isolation defect
- **THEN** parallel-run conformance testing remains deferred

### Requirement: Public metadata is bounded and non-executable
Conformance SHALL scan interaction, realtime, replay, graph, explanation, audit, UI fixture, and report outputs for both frameworks. Public output SHALL contain only existing bounded observational metadata and SHALL exclude raw or recoverable control references, binding credentials, live workflow/graph objects, queues, checkpoint/state payloads, secrets, and sensitive response data.

#### Scenario: Public surfaces are emitted
- **WHEN** either real framework path produces public API, realtime, UI, or conformance-report output
- **THEN** security assertions verify bounded allowlisted metadata and the absence of executable or private native data

#### Scenario: Private value appears in diagnostic context
- **WHEN** a harness or gate fails after handling a private control or native state value
- **THEN** retained logs and reports redact that value while preserving actionable failure context

### Requirement: Governance availability does not control observability
LangGraph and MAF governance flags and service-auth readiness SHALL be evaluated independently. Disabling governance or omitting its authentication configuration SHALL make only the affected control plane unavailable; supported telemetry ingestion and projection SHALL remain operational. Enabling, authenticating, or binding one framework SHALL NOT enable, authenticate, disable, or control the other.

#### Scenario: Governance is disabled
- **WHEN** one framework's governance flag is disabled while its supported telemetry is ingested
- **THEN** its interactions are non-actionable and its observability remains available
- **AND** the other framework's flag and behavior are unchanged

#### Scenario: One framework is enabled and authenticated
- **WHEN** only LangGraph or only MAF has an enabled, authenticated control plane
- **THEN** the enabled framework may control only its exact bindings
- **AND** the other framework remains independently unavailable or available according to its own configuration

### Requirement: Fixture meaning and native oracle provenance cannot drift silently
Every framework-owned captured fixture and capability assertion used by conformance SHALL record its generator, framework/integration version context, native evidence source, primary oracle, fingerprint, and declared test doubles. Version, generator, provenance metadata, and fingerprint SHALL mechanically match the captured fixture. Fixture or version changes SHALL appear as explicit checked-in diffs, and validation failure SHALL provide regeneration guidance.

#### Scenario: Checked-in fixture matches provenance
- **WHEN** conformance validates a fixture corpus
- **THEN** generator, version, native source, oracle, fingerprint, and double declarations match the checked-in evidence

#### Scenario: Dependency or capture changes
- **WHEN** framework version, adapter behavior, capture output, or fixture fingerprint changes
- **THEN** the gate fails with regeneration guidance until matching fixture, provenance, and fingerprint diffs are checked in

### Requirement: Both real framework paths are repeatable gates
AgentLens SHALL provide explicit LangGraph and MAF real-system repository commands. Each primary system gate SHALL execute the real framework workflow, its real telemetry/export path, real AgentLens Express HTTP and service authentication, real private bridge HTTP, and real PostgreSQL persistence where applicable, while clearly identifying every double. Each gate SHALL prove only one positive observe/govern/native-continuation path, accepted delivery without terminal outcome, one exact-binding or wrong-scope rejection, and public-output non-disclosure. Broader negative coverage SHALL remain in fast API, persistence, fixture, and architecture tests. Existing mock-based tests MAY remain for isolated behavior but SHALL NOT be reported as the primary real-system path.

#### Scenario: LangGraph real-system gate runs
- **WHEN** the LangGraph system command executes
- **THEN** it crosses real LangGraph execution, telemetry, HTTP/authentication, bridge HTTP, and PostgreSQL boundaries
- **AND** its manifest distinguishes real components from doubles

#### Scenario: MAF real-system gate runs
- **WHEN** the MAF system command executes
- **THEN** it preserves the existing real MAF/OTel/HTTP/bridge/PostgreSQL path and identifies the deterministic model client and any other doubles

### Requirement: Real-system lifecycle is isolated, deterministic, and diagnosable
Each real-system harness SHALL independently provide isolated database or schema state and mission/branch identifiers, bounded database/API readiness checks, no retry of assertion failures, and run-owned cleanup in `finally` without masking the primary failure. Port and process handling SHALL remain harness-local where needed. Shared lifecycle helpers MAY be added only for small mechanical duplication demonstrated during implementation; the change SHALL NOT require a generalized database, port, process, readiness, cleanup, or redaction utility.

#### Scenario: Service startup is transiently unavailable
- **WHEN** PostgreSQL or the API is not immediately ready
- **THEN** that harness retries only its readiness probe within a bounded policy

#### Scenario: Scenario assertion fails
- **WHEN** a conformance assertion fails after readiness
- **THEN** the harness does not hide it through scenario retry
- **AND** `finally` cleanup runs and terminal output retains the primary and cleanup results

### Requirement: Gate output remains small and repository-local
Each conformance command SHALL emit deterministic terminal output. Each real-system gate SHALL emit one small machine-readable summary containing framework, gate, result, real components and doubles, scenario results, evidence paths, cleanup result, and rerun command. The summary SHALL remain repository test output and SHALL NOT be specified as a public, operator, versioned, long-lived, or generalized report contract.

#### Scenario: Real-system gate completes
- **WHEN** a LangGraph or MAF system gate finishes
- **THEN** terminal output and the small summary identify its result, four scenario results, evidence, component/double boundary, cleanup result, and rerun command

#### Scenario: Combined release command runs
- **WHEN** the repository release entry point runs both framework gates
- **THEN** it MAY collect their summaries mechanically without creating a report service, generalized report model, or compatibility promise

### Requirement: CI and release entry points are documented and failures are actionable
The repository SHALL expose documented test entry points for fast conformance, each framework's real-system conformance, combined system conformance, summary output, and release conformance. These entry points SHALL NOT be treated as public compatibility contracts. Fast gates SHALL run in ordinary pull-request CI. Both real-system gates SHALL run in an explicit CI or release job and SHALL never be reported as passed when prerequisites caused them not to execute. Terminal output SHALL identify the framework, gate, failing assertion, evidence location, real-versus-double boundary, and rerun command.

#### Scenario: Fast invariant regresses
- **WHEN** a fixture, architecture, governance, isolation, or public-output assertion fails in pull-request CI
- **THEN** the named conformance check fails with an invariant-specific rerun command

#### Scenario: Real-system prerequisites are absent
- **WHEN** a real-system gate cannot start its required services
- **THEN** its result is failed, errored, or explicitly not run according to CI policy
- **AND** it is not published as a passing real-system check

### Requirement: Cross-framework documentation preserves the private boundary
Documentation SHALL explain the static invariant manifest, per-framework evidence and limitations, real components and doubles, repository commands, and remaining framework-specific translators, bridges, identity policies, native execution, telemetry semantics, and failure behavior. It SHALL record that two integrations do not justify a public adapter interface, generalized test platform, or broader framework platform.

#### Scenario: Operator reviews conformance scope
- **WHEN** an operator reads the conformance documentation
- **THEN** they can distinguish shared AgentLens invariants from framework-native assertions and run the appropriate fast or real-system command

#### Scenario: Developer proposes shared production extraction
- **WHEN** test orchestration reveals similar LangGraph and MAF shapes
- **THEN** documentation identifies them as test/report similarity or deferred candidates
- **AND** no public adapter, registry, discovery mechanism, or production abstraction is extracted by this change
