## ADDED Requirements

### Requirement: LangGraph control authority remains private to the bridge
The LangGraph governance bridge SHALL own the framework-specific execution context and opaque control reference needed to apply a native operation. AgentLens Core SHALL pass only a framework-neutral decision request to the bridge and SHALL NOT interpret LangGraph checkpoints or application state. The private control reference SHALL remain distinct from observational native identity. Private bridge endpoints SHALL use the repository's existing service authentication and mission/branch isolation mechanisms. The random control reference SHALL NOT be the sole authorization boundary.

#### Scenario: Bridge claims a decision
- **WHEN** an authenticated bridge presents its private control reference for a matching actionable request under an active binding
- **THEN** AgentLens Core provides the interaction request identity, decision identity, decision type, and validated value required for delivery
- **AND** provides no instruction to inspect or mutate checkpoint internals

#### Scenario: Observational key is used as control authority
- **WHEN** a caller presents only `native_execution_key`, thread ID, run ID, checkpoint reference, or interrupt ID
- **THEN** the bridge delivery interface does not treat those observational identifiers as executable credentials

#### Scenario: Unauthenticated or cross-mission bridge call is rejected
- **WHEN** a bridge call lacks valid existing service authentication or targets a mission/branch outside its isolation scope
- **THEN** AgentLens rejects the call
- **AND** does not disclose whether a matching control reference exists beyond existing auth failure semantics

#### Scenario: Public surface is serialized
- **WHEN** an interrupt, replay, graph, explanation, realtime, audit, or UI response is produced
- **THEN** it contains no raw or recoverable bridge control reference, checkpoint payload, secret, resume token, or application execution context

### Requirement: Bridge bindings have an explicit liveness lifecycle
AgentLens SHALL record bridge bindings with registration time, lease expiry, last successful heartbeat or renewal, binding generation or replacement identity, and revocation or consumption state. Binding lifecycle states SHALL include `active`, `expired`, `revoked`, and `consumed`. Only an `active`, unexpired binding MAY make a matching request actionable or claim a delivery. A persisted binding MUST NOT remain actionable indefinitely after the application process disappears. Re-registration SHALL create a new private control reference and invalidate or supersede the previous binding. Expired or revoked bindings SHALL NOT claim decisions. Bridge restart SHALL require re-registration with a new control reference. AgentLens restart SHALL preserve persisted binding metadata subject to lease expiry and revocation or consumption state. The raw private control reference SHALL remain undisclosed. This requirement SHALL NOT introduce generalized service discovery or a cross-framework lease system.

#### Scenario: Active unexpired binding enables actionability
- **WHEN** a binding is `active`, unexpired, and identity-matched to an observed interrupt
- **THEN** the request may become actionable

#### Scenario: Lease expires after process disappears
- **WHEN** a binding's lease expires without successful heartbeat or renewal
- **THEN** the binding becomes `expired`
- **AND** it can no longer make requests actionable or claim decisions

#### Scenario: Re-registration supersedes prior binding
- **WHEN** the application re-registers for the same scoped interrupt context
- **THEN** AgentLens creates a new binding generation and private control reference
- **AND** the previous binding is revoked or otherwise superseded and cannot claim

#### Scenario: Bridge restarts
- **WHEN** the bridge process restarts
- **THEN** it must re-register to obtain a new control reference
- **AND** the prior binding cannot claim deliveries

#### Scenario: AgentLens restarts with unexpired binding
- **WHEN** AgentLens restarts while a previously persisted binding remains unexpired and not revoked or consumed
- **THEN** that binding metadata remains available for matching subject to ongoing lease rules
- **AND** expiry is not reset solely by the Core restart

### Requirement: The bridge performs only supported LangGraph-native translation
The bridge SHALL translate a validated decision into only the native resume/input operation implemented by the checked-in LangGraph scenario. Unsupported request or decision types SHALL fail safely without an inferred mapping.

#### Scenario: Positive continuation is supported
- **WHEN** the reference request accepts an approve-equivalent decision
- **THEN** the bridge maps it to the scenario's explicit LangGraph resume value and invokes the original execution context

#### Scenario: Structured response is supported
- **WHEN** the request declares structured input and the recorded value passed validation
- **THEN** the bridge supplies that value through the scenario's supported native resume/input operation

#### Scenario: Mapping is unknown
- **WHEN** the bridge receives a decision type not implemented by the scenario
- **THEN** it records delivery failure or staleness as appropriate
- **AND** performs no LangGraph state mutation

### Requirement: Decision delivery has an independent lifecycle
AgentLens SHALL track delivery independently from the decision and runtime outcome, at minimum distinguishing pending, accepted by native receipt, failed, stale or already resolved, and unknown. Bridge delivery failure SHALL NOT roll back or corrupt an already committed decision record.

#### Scenario: Decision is committed before bridge availability
- **WHEN** a supported decision is recorded while its bridge is temporarily unavailable
- **THEN** the decision remains durable and delivery remains pending or becomes failed
- **AND** the decision API does not rewrite the decision as a runtime failure

#### Scenario: Binding is stale
- **WHEN** the bridge reports that the interrupt is no longer present or its execution binding is stale
- **THEN** AgentLens records the delivery/request as stale or already resolved
- **AND** does not attempt another native application automatically

### Requirement: Bridge claim is distinct from native acceptance
A bridge claim SHALL mean only that one bridge instance reserved the delivery for processing. A claim SHALL NOT mean LangGraph accepted or applied the native operation. AgentLens SHALL record private claim fields including claimed time, claiming binding identity, claim deadline, and final receipt state. Externally, delivery SHALL remain `pending` after claim and SHALL become `accepted` only after an explicit bridge receipt indicating that the native operation was accepted. If the bridge disappears after claim and native application is uncertain, or the claim deadline elapses without a definitive receipt, delivery SHALL become `unknown`. An unknown delivery SHALL NOT be automatically retried. Repeated claims and receipts SHALL remain idempotent. Claim state SHOULD remain private and SHALL NOT be unnecessarily exposed to the operator UI.

#### Scenario: Claim without acceptance leaves delivery pending
- **WHEN** an active binding successfully claims a delivery but has not yet posted an acceptance receipt
- **THEN** external delivery state remains `pending`
- **AND** private claim metadata records the claiming binding and claim deadline

#### Scenario: Explicit acceptance receipt advances delivery
- **WHEN** the bridge posts an explicit receipt that the native operation was accepted
- **THEN** AgentLens records delivery as `accepted` with a delivery identity and timestamp
- **AND** runtime outcome remains unknown or awaiting explicit evidence

#### Scenario: Claim times out with uncertain native application
- **WHEN** the claim deadline elapses or the bridge disappears after claim without a definitive receipt
- **THEN** AgentLens records delivery as `unknown`
- **AND** does not automatically redeliver the operation

#### Scenario: Repeated claim is idempotent
- **WHEN** the same bridge or a superseded binding retries claim for a delivery already claimed, accepted, failed, stale, or unknown
- **THEN** AgentLens does not issue a second native application instruction for that decision

### Requirement: Native application is at most once per recorded decision
AgentLens and the LangGraph bridge SHALL use one stable delivery identity per recorded decision and SHALL prevent repeated API submission, repeated polling, or repeated receipts from applying that decision to LangGraph more than once. An uncertain prior application SHALL not be retried automatically.

#### Scenario: Bridge polls repeatedly
- **WHEN** the same bridge requests work multiple times for a decision already claimed, accepted, failed, stale, or unknown
- **THEN** it receives no new application instruction for that decision

#### Scenario: Receipt is repeated
- **WHEN** the bridge posts the same delivery receipt more than once
- **THEN** AgentLens returns the existing delivery state without adding a second attempt

#### Scenario: API decision is repeated
- **WHEN** the operator decision request is idempotently repeated
- **THEN** the existing delivery identity is retained
- **AND** no second LangGraph command is produced

### Requirement: Runtime outcome requires authoritative correlated evidence
AgentLens SHALL derive the final LangGraph runtime outcome only from explicit telemetry or another documented authoritative native result that correlates to the interaction or delivery. A recorded decision, successful API response, accepted delivery, claimed delivery, or unrelated later activity SHALL NOT prove runtime resume.

#### Scenario: Explicit resume telemetry arrives
- **WHEN** adapter telemetry explicitly identifies the resumed interrupt and correlates it with the governance delivery
- **THEN** AgentLens records runtime outcome as resumed or continued with supplied input as supported by that evidence
- **AND** preserves the telemetry source references

#### Scenario: Delivery succeeds without confirmation
- **WHEN** delivery is accepted but no correlated runtime result arrives
- **THEN** runtime outcome remains unknown

#### Scenario: Unrelated later activity exists
- **WHEN** later LangGraph activity has no explicit correlation to the interaction or delivery
- **THEN** AgentLens does not infer that the runtime resumed

#### Scenario: Runtime fails after accepted delivery
- **WHEN** correlated LangGraph telemetry records a runtime failure after the bridge accepted the decision
- **THEN** delivery remains accepted and runtime outcome becomes failed

#### Scenario: Delivery fails before native acceptance
- **WHEN** the bridge cannot invoke the native operation
- **THEN** delivery becomes failed and runtime outcome does not become failed solely from that bridge error

### Requirement: Out-of-order receipts and telemetry reconcile deterministically
AgentLens SHALL reconcile decision records, bridge receipts, and correlated runtime telemetry that arrive in different orders using stable interaction, decision, delivery, and interrupt correlation IDs. Reconciliation SHALL be idempotent. Runtime outcome and delivery state SHALL remain independent. Late events SHALL NOT regress a stronger already-recorded state on the same axis. Runtime failure after accepted delivery SHALL preserve `delivery=accepted` and `runtime_outcome=failed`. Accepted delivery without outcome evidence SHALL leave outcome unknown. Unrelated later activity SHALL NOT imply resume.

#### Scenario: Runtime outcome arrives before accepted receipt
- **WHEN** correlated runtime outcome telemetry arrives before the accepted-delivery receipt
- **THEN** AgentLens records the runtime outcome from that evidence
- **AND** later accepted receipt may advance delivery to `accepted` without clearing the recorded outcome

#### Scenario: Duplicate runtime outcome telemetry
- **WHEN** the same correlated runtime outcome evidence is ingested more than once
- **THEN** AgentLens coalesces to one recorded outcome without duplication side effects

#### Scenario: Late accepted receipt after runtime failure
- **WHEN** runtime failure is already recorded and a late accepted receipt arrives
- **THEN** delivery may become `accepted` if not already terminal-accepted
- **AND** `runtime_outcome=failed` is preserved

#### Scenario: Late failed receipt after accepted delivery
- **WHEN** delivery is already `accepted` and a late failed or pending receipt arrives
- **THEN** delivery remains `accepted`
- **AND** the late receipt does not regress delivery state

#### Scenario: Repeated stale receipts
- **WHEN** stale receipts are posted after a terminal delivery state is recorded
- **THEN** AgentLens treats them as idempotent no-ops for native application

#### Scenario: Duplicate decision or delivery correlation events
- **WHEN** duplicate decision or delivery correlation events arrive
- **THEN** AgentLens converges on the existing stable identities without creating a second delivery

### Requirement: LangGraph governance feature flag gates control delivery
Bridge registration and request actionability SHALL be disabled by default unless explicitly enabled for the reference deployment. Disabling the feature SHALL prevent new control delivery and SHALL NOT delete existing request, decision, delivery, or audit records. Observability through `span_projection.v1` SHALL remain available when governance is disabled. Operator UI controls SHALL remain hidden or non-actionable when governance is unavailable.

#### Scenario: Feature flag defaults to disabled
- **WHEN** the reference deployment has not explicitly enabled the LangGraph governance feature flag
- **THEN** bridge registration and request actionability are unavailable

#### Scenario: Feature flag is turned off after use
- **WHEN** governance is disabled after request, decision, delivery, or audit records already exist
- **THEN** those records remain readable
- **AND** no new control delivery is accepted

#### Scenario: Observability remains with governance disabled
- **WHEN** the LangGraph governance feature flag is disabled
- **THEN** `span_projection.v1` replay, graph, and explanation observation remain available
