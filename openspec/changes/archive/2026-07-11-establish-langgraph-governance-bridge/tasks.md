## 1. Native Identity Continuity

- [x] 1.1 Add a pure field-wise `NativeRuntimeIdentity` merge that retains earlier non-conflicting framework, thread, run, parent-run, interrupt, checkpoint, activity-correlation, resume-of, and `native_execution_key` values across lifecycle candidates.
- [x] 1.2 Extend normalization diagnostics with source-traceable native-identity conflicts, retain deterministic observational output, and expose a machine-checkable ambiguity condition for governance gating.
- [x] 1.3 Add normalization and adapter-produced fixture tests for partial later identity, equal repeated values, conflicting explicit fields, and unchanged observational-only treatment of `native_execution_key`.

## 2. Governance State and Persistence

- [x] 2.1 Add the smallest protocol/API types and validation schemas for request actionability, supported decision types, safe input schema, immutable decision/audit data, delivery state, runtime outcome, and feature-flag availability while retaining the legacy coarse interrupt status as a compatibility view.
- [x] 2.2 Add additive interrupt persistence fields plus focused private bridge-binding storage (registration time, lease expiry, last heartbeat/renewal, generation/replacement identity, revocation/consumption state) and delivery-attempt storage including private claim fields (claimed time, claiming binding identity, claim deadline, final receipt state), with uniqueness for one decision/delivery identity per interaction and no checkpoint/application-state columns.
- [x] 2.3 Implement store mappings and explicit public serializers that exclude raw bridge references, hashes, claim internals, resume tokens, secrets, checkpoint payloads, application execution context, and non-allowlisted decision value bodies.
- [x] 2.4 Add migration/store tests proving legacy interrupt rows remain readable as non-actionable observations and the separate decision, delivery, and runtime-outcome axes round-trip independently.

## 3. Explicit Interaction Request Reconciliation

- [x] 3.1 Extend the LangGraph adapter's explicit interrupt observation with bounded display-safe request type/prompt or input-schema facts and source correlation, without exporting complete interrupt values or control context.
- [x] 3.2 Update OTLP interrupt ingestion to preserve merged native identity and source telemetry references, classify unsupported or ambiguous observations safely, and never make inactivity or inferred pause state actionable.
- [x] 3.3 Add a LangGraph-specific private bridge-binding registration path that hashes the opaque adapter control reference, stores binding liveness metadata, supports heartbeat/renewal, and creates a new generation that supersedes prior bindings on re-registration.
- [x] 3.4 Implement deterministic exact identity matching (required: mission, branch, framework=`langgraph`, interaction/interrupt request ID, thread ID when required; consistency when both sides present: run, parent-run, checkpoint ID/namespace, activity-correlation) with missing-required → non-actionable, explicit conflict → diagnostic + block, optional absence → partial, and no names/timing/topology/fuzzy/`native_execution_key` matching.
- [x] 3.5 Reconcile telemetry observations and bridge bindings transactionally in either arrival order, making a request actionable only when the feature flag is enabled, the binding is `active` and unexpired, and exact identity matching succeeds.
- [x] 3.6 Gate bridge registration and request actionability behind the LangGraph governance feature flag (default off); when disabled, prevent new registration/actionability without deleting existing records and keep `span_projection.v1` observability available.
- [x] 3.7 Add API/store tests for observed-only requests, binding-only registrations, matching actionability, unsupported interaction types, missing required identity, optional partial identity, explicit identity conflict, expired/revoked/superseded bindings, branch isolation, and feature-flag off behavior.

## 4. Decision Recording and Delivery Coordination

- [x] 4.1 Restrict LangGraph decision validation to the request-declared approve, reject, and/or structured-response types; enforce conservative structured-value size, depth, collection, and JSON-like type limits; validate against the recorded safe schema; reject binary/unsupported objects before recording.
- [x] 4.2 Refactor decision recording so the mission/branch/interrupt transaction durably stores immutable decision identity, actor condition, bounded value, timestamp, idempotency identity, and audit provenance (safe summary/redaction where appropriate) before any delivery work; exclude full decision values from OTLP/replay/graph/explanation/unrestricted audit; remove automatic resume implications from the LangGraph path.
- [x] 4.3 Implement same-key/same-content idempotent replay, same-key/different-content conflict, and stale/resolved/different-decision rejection without creating duplicate delivery records.
- [x] 4.4 Add private LangGraph bridge claim and receipt operations that keep external delivery `pending` after claim, advance to `accepted` only on explicit native-acceptance receipt, move to `unknown` on claim timeout or uncertain post-claim disappearance, and support failed/stale independently of decision and runtime outcome; keep claim fields private from public serializers.
- [x] 4.5 Implement deterministic out-of-order reconciliation for receipts and correlated runtime telemetry (telemetry-before-receipt, duplicate outcomes, late accept after runtime failure, late fail/pending after accept, repeated stale receipts, duplicate correlation events) so axes stay independent and stronger states do not regress.
- [x] 4.6 Ensure bridge unavailability or receipt failure cannot roll back a committed decision or turn the decision API response into a claimed runtime failure; never automatically retry `unknown` delivery.
- [x] 4.7 Enforce existing service authentication plus mission/branch isolation on private bridge endpoints so the random control reference is not the sole authorization boundary.
- [x] 4.8 Add route/store/audit tests for supported and invalid decisions, structured-input bounds/redaction/public-output exclusion, actor provenance, duplicate submissions, claim-without-acceptance, claim-timeout unknown, repeated claims/receipts, out-of-order non-regression, delivery failure, stale resolution, auth/isolation rejection, and one stable delivery identity.

## 5. Thin LangGraph Governance Bridge

- [x] 5.1 Add a LangGraph-specific governance bridge module that generates an opaque control reference and keeps the compiled graph, invocation configuration, checkpointer access, and native execution context inside the application process.
- [x] 5.2 Implement bridge registration, heartbeat/renewal, and decision claim using the private control reference while accepting only the framework-neutral interaction request ID, decision ID, decision type, and validated value from AgentLens Core; on restart, re-register with a new control reference that supersedes the prior binding.
- [x] 5.3 Map only reference-scenario-supported decisions to LangGraph `Command(resume=...)` or the installed version's authoritative equivalent; fail unknown mappings without native mutation.
- [x] 5.4 Enforce at-most-once local application by delivery identity, post idempotent accepted/failed/stale/unknown receipts, treat claim as reservation only, and avoid automatic retry when prior native application is uncertain.
- [x] 5.5 Emit explicit interrupt/delivery correlation in adapter telemetry for native resume, continued input, rejected/terminated path, and runtime failure without emitting the control reference or checkpoint state.
- [x] 5.6 Add Python unit/integration tests for registration, lease expiry/renewal/revocation/replacement/restart, supported translation, structured input, claim without acceptance, duplicate claims, stale/expired bindings, pre-acceptance failure, uncertain receipt timing, and control-data non-disclosure.

## 6. Authoritative Runtime Outcome

- [x] 6.1 Extend span ingestion and private normalization to recognize only explicitly correlated LangGraph post-decision resume/input, rejected/terminated, and failure evidence and retain its source references.
- [x] 6.2 Update the interrupt aggregate and existing `span_projection.v1`-backed runtime events so accepted delivery remains distinct from telemetry-confirmed runtime outcome and unrelated later activity cannot imply resume.
- [x] 6.3 Preserve accepted delivery with `runtime_outcome=failed` for correlated execution failure, preserve non-failed/unknown runtime outcome for bridge delivery failure before native acceptance, and apply out-of-order non-regression rules when telemetry and receipts arrive in different orders.
- [x] 6.4 Add API projection tests for confirmed resume, continued structured input, accepted-without-confirmation, unrelated later activity, rejected/terminated outcome, runtime failure after acceptance, delivery failure without fabricated runtime failure, telemetry-before-receipt, and late/duplicate event non-regression.

## 7. Minimal Govern UI Integration

- [x] 7.1 Extend the web interrupt client/store mapping to consume supported decisions, safe input schema, actionability, decision state, delivery state, runtime outcome, and governance availability without receiving private binding or claim fields.
- [x] 7.2 Update the existing Govern tab to render only request-supported controls and structured input, disable action after decision/stale/resolved state, hide or disable controls when the governance feature flag is off, and retain compatible rendering for existing non-LangGraph interrupts.
- [x] 7.3 Present decision, delivery, and runtime outcome as separate labels, including pending/unknown states and delivery errors that are not styled or described as runtime failures; do not surface internal claim state.
- [x] 7.4 Add focused UI tests for actionable and observed-only requests, supported-control filtering, structured input validation feedback, duplicate-click prevention, delivery failure, accepted-without-resume, confirmed outcome, resolved requests, and feature-flag-disabled non-actionable controls.

## 8. LangGraph End-to-End Conformance and Documentation

- [x] 8.1 Add a checked-in real LangGraph reference graph and harness that reaches an interrupt, registers the bridge, receives an API decision, applies native input, continues along its explicit path, and exports resulting telemetry to AgentLens.
- [x] 8.2 Add end-to-end positive continuation plus reject/alternative and structured-input cases where the real reference graph supports them, using native graph behavior and correlated telemetry as the primary oracle.
- [x] 8.3 Add end-to-end/fixture cases for bridge delivery failure, duplicate decision submission, stale/already-resolved request, missing/conflicting identity, optional partial identity, accepted delivery without outcome evidence, confirmed resume, runtime failure after accepted delivery, binding lease expiry/renewal/revocation/replacement/restart, claim without acceptance, claim-timeout unknown delivery, out-of-order receipts/telemetry, and feature-flag enabled/disabled behavior.
- [x] 8.4 Add automated public-output scans across interrupt APIs, realtime payloads, replay, graph, explanation, audit data, and UI fixtures proving no raw/recoverable control reference, claim internals, checkpoint payload, secret, resume token, non-allowlisted decision body, or application context leaks.
- [x] 8.5 Document the LangGraph-only governance flow, binding liveness, claim-versus-acceptance, exact identity matching, out-of-order reconciliation, structured-input bounds, feature-flag behavior, separate state axes, adapter-owned control-reference boundary, failure/unknown semantics, and explicit deferral of generalized governance abstractions.
- [x] 8.6 Run the existing LangGraph observability fixtures, Python suites, API and web tests, lint/type checks, and `openspec validate establish-langgraph-governance-bridge --type change --strict`; resolve all relevant failures without adding a second projector or public governance protocol.
