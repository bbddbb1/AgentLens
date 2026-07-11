## Context

The archived LangGraph reference integration established adapter-produced OTLP fixtures, a private normalization boundary, observational `native_runtime_identity`, and `span_projection.v1` as the only production observation path. The current implementation can record `agent.interrupt.requested` span events into the existing `interrupts` table and render them in the Govern sidebar, but its interrupt status conflates request, decision, and resume. The decision route updates that status directly, approval can trigger follow-on behavior, and the UI offers four generic actions regardless of what a runtime can execute.

The normalization path also selects one lifecycle candidate's complete native-identity object when candidates merge. A later event that records only an interrupt ID can therefore discard thread, run, checkpoint, or activity-correlation identifiers recorded earlier. That is unsafe for governance correlation, and conflicting explicit identifiers currently have no dedicated diagnostic.

The stakeholders are operators submitting LangGraph interaction decisions, application owners running the LangGraph adapter, and AgentLens maintainers responsible for auditability and truthful runtime state. LangGraph remains the authority for checkpoint state and native resume semantics. AgentLens may record intent and delivery facts, but it must not turn observational identity into control authority or report a resumed runtime without authoritative evidence.

## Goals / Non-Goals

**Goals:**

- Prove one end-to-end LangGraph interrupt-to-decision-to-native-delivery-to-observed-outcome path.
- Preserve complete, non-conflicting observational identity across lifecycle evidence.
- Reuse the existing interrupt model, routes, UI, span ingestion, normalization, and `span_projection.v1` path where they remain sufficient.
- Make request state, user decision, delivery state, and runtime outcome independent and auditable.
- Keep all framework execution context and native command translation inside a thin LangGraph bridge.
- Define binding liveness, claim-versus-acceptance, exact identity matching, out-of-order reconciliation, structured-input bounds, and feature-flag behavior for this vertical slice only.
- Prevent duplicate native application and fail safely when identity, binding, delivery, or outcome is uncertain.
- Keep projected semantics traceable to the original interrupt and subsequent correlated LangGraph telemetry.

**Non-Goals:**

- A public or generalized cross-framework governance protocol, adapter registry, or plugin system.
- A second framework integration or extraction of a stable governance adapter contract.
- Generalized service discovery, cross-framework lease systems, command buses, retry engines, or workflow debuggers.
- A generalized data-classification platform or broad authorization redesign.
- Arbitrary pause, retry, fork, replay, step, or checkpoint operations.
- Checkpoint payload persistence, state browsing/editing, native debugger features, or prompt tooling.
- Treating `native_execution_key`, thread/run IDs, checkpoint references, resume URLs, or telemetry identifiers as executable authority.
- Replacing `span_projection.v1`, introducing RuntimeEvidence, or redesigning the Govern UI or authorization platform.

## Decisions

### 1. Merge observational native identity per field and quarantine conflicts

Normalization will merge each native identity field across all candidates for an activity. A field recorded on an earlier span or event remains present when a later lifecycle event omits it. Repeated equal values coalesce. Two different explicit values for the same field produce a `conflicting_native_identity` diagnostic with both source references; deterministic output retains the first recorded value for observation, but the affected governance request is non-actionable until the binding can be unambiguously matched.

The merge covers framework, thread ID, run and parent-run IDs, interrupt/request ID, checkpoint ID and namespace, activity correlation ID, resume-of interrupt ID, and `native_execution_key`. The last remains an AgentLens-derived observational key. It is never accepted as bridge authentication or a control lookup credential.

Alternative considered: prefer the latest complete identity object. Rejected because later lifecycle callbacks commonly omit identifiers and ordering does not resolve explicit conflicts.

### 2. Reconcile two independent prerequisites with exact identity matching and live bindings

The existing interrupt record remains the operator-facing interaction record, with additive fields for request type, display-safe prompt or input schema, supported decision types, native identity, source references, actionability, decision state, delivery state, and runtime outcome.

An interaction becomes actionable only after AgentLens has both:

1. an explicit, ingested LangGraph `agent.interrupt.requested` observation with an interrupt identity and source telemetry; and
2. an **active, unexpired** LangGraph bridge binding registered by the application for the same mission, branch, and exact native identity match defined below.

Either side may arrive first. Ingest and bridge registration reconcile transactionally. An observed request without a valid binding remains visible as `observed_only`, `unsupported`, or `identity_conflict`; a binding without an observed request never creates an actionable UI request. Inactivity, topology, or a paused-looking trace is never enough.

#### Exact identity-matching rules (reference scenario)

**Required matching fields** (must be present and equal on both the observed interrupt and the private bridge binding):

- mission ID;
- branch ID;
- framework = `langgraph`;
- interaction or interrupt request ID;
- thread ID, where required by the checked-in reference graph.

Missing any required field makes the request non-actionable.

**Additional consistency fields** (when both sides provide an explicit value, they must be equal):

- run ID;
- parent-run ID;
- checkpoint ID and namespace;
- activity-correlation ID.

Rules:

- conflicting explicit values for any required or consistency field produce an `identity_conflict` diagnostic and block actionability;
- absence of an optional consistency field on one side remains partial, not conflicting;
- matching MUST NOT use names, timing, topology, fuzzy inference, or `native_execution_key`;
- observational identifiers MUST NOT serve as authentication credentials.

Private bridge endpoints MUST also use the repository’s existing service authentication and mission/branch isolation. The random control reference is necessary but not the sole authorization boundary.

#### Bridge-binding liveness

Bindings record enough information to determine liveness:

- registration time;
- lease expiry;
- last successful heartbeat or renewal;
- binding generation or replacement identity;
- revocation/consumption state.

Lifecycle states:

| State | Meaning |
| --- | --- |
| `active` | Lease valid, not revoked or consumed; may make matching requests actionable and may claim deliveries |
| `expired` | Lease elapsed without successful renewal; cannot make requests actionable or claim decisions |
| `revoked` | Explicitly invalidated (including supersession by re-registration); cannot claim |
| `consumed` | Binding used to a terminal point for its scoped interaction as defined by the delivery path; cannot claim further |

Rules:

- only an `active`, unexpired binding may make a request actionable;
- a persisted binding MUST NOT remain actionable indefinitely after the application process disappears — lease expiry enforces this without process heartbeats from AgentLens into the app;
- re-registration creates a new private control reference and a new binding generation that invalidates or supersedes the previous binding (`revoked` or equivalent supersession);
- expired or revoked bindings cannot claim decisions;
- **bridge restart:** the restarted process MUST re-register; prior binding becomes superseded/revoked and cannot claim; new registration yields a new control reference;
- **AgentLens restart:** persisted binding metadata survives subject to lease expiry and revocation/consumption state; expired bindings are not reactivated by Core restart alone;
- the raw private control reference remains undisclosed on all public surfaces.

This is a LangGraph-only binding lease for the vertical slice. No generalized service discovery or cross-framework lease system is introduced.

The adapter records only display-safe request material: an explicit request type, bounded safe prompt/summary, or a declarative input schema. Complete interrupt values, checkpoint state, secrets, and application objects are excluded.

Alternative considered: let bridge registration create the UI request. Rejected because it would let control-plane intent masquerade as observed runtime evidence.

### 3. Keep the bridge control reference private and adapter-owned

The LangGraph package will add a small governance bridge for the reference scenario. The application registers an opaque, random control reference associated locally with the compiled graph and the original LangGraph invocation configuration. The application process retains the graph, checkpointer, configuration, and any native state. AgentLens Core stores only a one-way hash and private binding metadata needed to authenticate claims and evaluate liveness; the raw control reference is supplied only on authenticated bridge calls and is never returned by operator APIs.

The bridge polls or long-polls a LangGraph-specific private delivery endpoint, receives a small framework-neutral decision request such as `{ interaction_request_id, decision_id, decision_type, value }`, and translates it to the supported LangGraph `Command(resume=...)` or equivalent invocation using its locally held context. Approve, reject, and structured response values are scenario mappings owned by the bridge, not interpretations performed by AgentLens Core.

No control reference, token, graph configuration, checkpoint payload, secret, or complete application state enters OTLP attributes, interrupt/replay/graph/explanation metadata, public API responses, realtime payloads, or UI state.

Alternative considered: have the TypeScript API load LangGraph checkpoints and invoke native operations. Rejected because it crosses language and ownership boundaries, exposes state, and turns Core into a LangGraph implementation.

### 4. Model request, decision, delivery, and runtime outcome as separate axes

The interrupt model will expose additive, explicit fields while retaining the existing coarse `status` only as a compatibility view:

- request lifecycle: `pending`, `resolved`, `expired`, `stale`, or `unsupported`;
- decision state: `none` or `recorded`, with immutable decision ID, actor, type, optional value, timestamp, idempotency key, and audit provenance;
- delivery state: `not_requested`, `pending`, `accepted`, `failed`, `stale`, or `unknown`;
- runtime outcome: `awaiting_interaction`, `resumed`, `continued_with_input`, `rejected_or_terminated`, `failed`, or `unknown`.

Legacy status is derived conservatively and cannot upgrade delivery or runtime outcome. In particular:

```text
decision recorded != delivery accepted != runtime resumed
```

The existing `interrupts` row holds the current aggregate. A focused delivery-attempt record holds delivery ID, decision ID, timestamps, safe error classification, receipt correlation, and audit data. Private bridge binding fields and internal claim fields are never mapped by public row serializers. This is not a generalized command/event store.

Alternative considered: add more values to the existing single `status` field. Rejected because it cannot faithfully represent delivery failure alongside an intact decision or a runtime failure after accepted delivery.

### 5. Separate bridge claim from delivery acceptance

A bridge **claim** only means that one bridge instance has reserved the delivery for processing. It does **not** mean LangGraph accepted or applied the native operation.

Internal claim state (private; not required on operator UI) includes:

- claimed time;
- claiming binding identity (generation);
- claim deadline;
- final receipt state.

External delivery lifecycle:

| External delivery | Meaning |
| --- | --- |
| `pending` | Decision recorded; not yet accepted by native operation — **including after a successful claim** |
| `accepted` | Explicit bridge receipt indicates the native operation was accepted |
| `failed` | Bridge confirmed it could not invoke/accept the native operation |
| `stale` | Interrupt/binding no longer applicable |
| `unknown` | Claim timed out or bridge disappeared after claim and native application is uncertain |

Rules:

- delivery remains `pending` after claim;
- delivery becomes `accepted` only after an explicit bridge receipt indicating native acceptance;
- if the bridge disappears after claim and native application is uncertain, delivery becomes `unknown`;
- an `unknown` delivery is not automatically retried;
- repeated claims or receipts remain idempotent (same delivery identity; no second native application instruction).

Alternative considered: treat claim as acceptance. Rejected because claim precedes native invoke and would overstate runtime progress.

### 6. Commit the decision before attempting delivery; bound structured values

The operator decision endpoint takes the existing mission/branch/interrupt lock, validates that the request is actionable and the decision type/value matches its declared support, and records the decision in one database transaction. Actor identity comes from the existing request/audit context; deployments without a stronger principal record an explicit `unknown` or local-operator actor condition rather than inventing identity. Audit provenance includes request/channel identity and source interaction references.

**Structured decision value bounds (conservative):**

- maximum serialized size (implementation chooses a small hard limit suitable for HITL forms, e.g. low tens of KB — fixed in code and tests);
- maximum nesting depth and maximum collection sizes;
- allowed JSON-like value types only (object, array, string, number, boolean, null);
- schema validation against the request’s recorded safe schema before decision recording;
- rejection of binary payloads and unsupported arbitrary objects;
- explicit public-display allowlisting for any decision fields shown in UI/API;
- decision values MUST NOT automatically enter OTLP telemetry, replay, graph, explanation, or unrestricted audit output;
- audit records SHOULD use a safe summary or redacted representation where appropriate;
- secrets, tokens, credentials, or equivalent sensitive inputs are outside this iteration unless handled through an existing dedicated secret mechanism.

No generalized data-classification platform is introduced.

After commit, delivery remains `pending` until the bridge claims and later accepts it via receipt. Bridge unavailability or delivery failure cannot roll back the decision and does not turn the already-recorded decision into runtime failure. The API response represents the committed decision and current delivery state, not a synchronous resume result.

Alternative considered: synchronously invoke the bridge inside the decision transaction. Rejected because network/native execution failure would couple durable user intent to runtime availability and hold database locks across framework execution.

### 7. Use idempotent decision recording and at-most-once native application

For the one-decision-per-request vertical slice:

- repeating the same idempotency key with the same canonical decision returns the original decision and creates no new delivery;
- reusing that key with different content is a conflict;
- submitting a new decision after one is recorded or after the request is stale/resolved is rejected;
- one delivery record is uniquely associated with one decision;
- the bridge uses the delivery ID as its local application key and marks it **claimed** (still externally `pending`) before invoking LangGraph;
- an accepted, failed, stale, or uncertain delivery is not automatically redelivered.

If the bridge process loses certainty after invoking LangGraph but before posting its receipt, or the claim deadline elapses without a definitive receipt, AgentLens records `delivery_state=unknown` and waits for correlated native telemetry. It does not retry an operation that might already have been applied. This favors prevention of duplicate runtime mutation over automatic recovery.

Alternative considered: retry until a delivery receipt is received. Rejected because LangGraph resume/input application is not guaranteed to be idempotent.

### 8. Confirm runtime outcome only through explicit correlated native evidence; reconcile out of order

The bridge emits or causes adapter telemetry that explicitly correlates the native resume/input operation with the interrupt and delivery IDs while retaining thread/run/activity identity. Ingest updates runtime outcome only from:

- an explicit correlated LangGraph resume/continuation observation;
- an explicit correlated rejected/terminated path;
- an explicit correlated runtime failure; or
- another documented authoritative LangGraph native result captured by the bridge.

Unrelated later activity, timing adjacency, successful HTTP responses, a claimed delivery, or a user decision is insufficient. A delivered decision may therefore remain `runtime_outcome=unknown`. A failure before LangGraph accepts the command is a delivery failure; failure after accepted delivery is a runtime failure and retains `delivery_state=accepted`.

#### Out-of-order reconciliation

Decision records, bridge receipts, and correlated runtime telemetry may arrive in different orders. Reconciliation MUST be deterministic and idempotent, converging on stable interaction, decision, delivery, and interrupt correlation IDs.

Rules:

- runtime outcome and delivery state remain independent axes;
- late events MUST NOT regress a stronger already-recorded state on the same axis;
- runtime failure after accepted delivery preserves `delivery=accepted` and `runtime_outcome=failed`;
- accepted delivery without outcome evidence remains outcome `unknown`;
- unrelated later activity still cannot imply resume;
- duplicate runtime outcome telemetry coalesces to the same recorded outcome;
- a late accepted receipt after runtime failure is already observed retains `runtime_outcome=failed` and may advance delivery to `accepted` if acceptance was not yet recorded (delivery and outcome stay independent);
- a late failed or pending receipt after delivery was `accepted` MUST NOT regress delivery to failed/pending;
- repeated stale receipts remain idempotent no-ops once a terminal delivery state is recorded;
- duplicate decision or delivery correlation events remain idempotent.

The observed result continues through spans, private normalization, and `span_projection.v1`. Projected runtime events may show safe decision/delivery/outcome states, but never private binding or claim data.

Alternative considered: mark resumed when any later span appears for the thread. Rejected because thread reuse and unrelated activity do not establish interaction causality.

### 9. Make the existing Govern UI capability-driven for this request

The existing Govern tab remains the only UI surface. It will render the request's declared supported decisions, a structured input control only when a safe schema is present, and separate decision, delivery, and runtime-outcome labels. Unsupported generic actions are hidden. Buttons become unavailable once a decision is recorded or the request is stale/resolved. Delivery errors are labeled as bridge delivery errors and are not rendered as runtime failures. Internal claim state is not required on the UI.

Legacy non-LangGraph interrupt rendering remains compatible. This change does not add a dashboard, native state viewer, checkpoint browser, or generic framework selector.

When the LangGraph governance feature flag is off or governance is otherwise unavailable, operator UI controls remain hidden or non-actionable while observational interrupt display may still appear where already supported.

Alternative considered: build a new governance console. Rejected as unnecessary for proving the adapter boundary.

### 10. Gate governance control behind an explicit feature flag

A LangGraph governance feature flag controls bridge registration and request actionability for the reference deployment:

- **default off** unless explicitly enabled for the reference deployment;
- when disabled: bridge registration and request actionability are unavailable; new control delivery is prevented;
- disabling does **not** delete existing request, decision, delivery, or audit records;
- observability through `span_projection.v1` remains available when governance is disabled;
- operator UI controls remain hidden or non-actionable when governance is unavailable.

This is a deployment gate for the vertical slice, not a multi-tenant policy engine.

### 11. Use real LangGraph behavior as the end-to-end oracle

A checked-in reference graph will reach a real LangGraph interrupt and support only the decisions its nodes explicitly implement. The test harness runs the adapter and bridge, submits through the API, applies native input, captures adapter-produced telemetry, and asserts the resulting AgentLens states.

Primary assertions are native behavior and explicitly correlated telemetry: positive continuation, the supported reject/alternative path, structured input when implemented, runtime failure after accepted delivery, and an intentionally delivered-but-unconfirmed case. Unit/integration cases cover binding lease expiry/renewal/revocation/replacement/restart, claim without acceptance, claim-timeout unknown delivery, exact identity matching (required missing, optional partial, explicit conflict), auth and mission/branch isolation on bridge endpoints, out-of-order receipts and runtime telemetry, non-regression under late/duplicate events, structured-input size/depth/schema/redaction/public-output exclusion, feature-flag on/off, bridge failure, duplicate submission, stale/resolved request, and projection/public-response non-disclosure. Existing observability fixtures remain regression protection, not a substitute for governance behavior.

## Risks / Trade-offs

- **[The adapter process is unavailable when a decision is recorded]** -> Keep the decision committed, show delivery pending/failed separately, and never claim runtime resume.
- **[Crash timing makes native application uncertain]** -> Use at-most-once delivery IDs, separate claim from acceptance, record `unknown` on claim timeout, avoid automatic redelivery, and reconcile only from correlated telemetry.
- **[Persisted bindings outlive the application process]** -> Lease expiry and heartbeat/renewal; expired/revoked bindings cannot claim; re-registration supersedes prior generation.
- **[Native identity varies across lifecycle events]** -> Exact required/consistency field rules, retain source references, block action on explicit conflicts, and add fixture coverage for partial and conflicting identities.
- **[Out-of-order receipts and telemetry]** -> Independent axes, non-regression of stronger states, idempotent coalescing on stable correlation IDs.
- **[Structured decision values leak or overwhelm stores]** -> Size/depth/type bounds, schema validation, public allowlists, redacted audit summaries, exclusion from OTLP/replay/graph/explanation.
- **[Private control data leaks through existing broad payload spreads]** -> Use explicit public serializers/allowlists and negative tests across interrupt APIs, realtime messages, replay, graph, explanation, and UI fixtures.
- **[A sample graph accidentally defines a general protocol]** -> Keep request types, value mappings, endpoints, and bridge implementation LangGraph-specific and private to this iteration.
- **[Legacy interrupt consumers depend on the coarse status]** -> Keep it as a conservative compatibility view while new UI/API code reads the separate axes.
- **[Reject or structured input is not supported by the actual reference graph]** -> Expose and test only capabilities implemented by the real graph; do not fabricate support to satisfy a matrix.

## Migration Plan

1. Add identity merge/conflict diagnostics and regression fixtures before enabling governance actions.
2. Add additive interrupt aggregate fields, a focused delivery-attempt record (including private claim fields), private binding storage with lease/liveness metadata, and explicit public serializers; migrate existing rows as non-actionable observational requests with unknown delivery/outcome.
3. Add LangGraph bridge registration/claim/receipt behavior and the real interrupt scenario behind a LangGraph governance feature flag (default off).
4. Reconcile explicit interrupt telemetry with bridge bindings using exact identity-matching rules and enable actionability only when both prerequisites match and the binding is active/unexpired.
5. Update the decision route (including structured-value bounds) and existing Govern UI to use supported decisions and separate state axes; hide/disable controls when the flag is off.
6. Add correlated outcome ingestion with out-of-order reconciliation, end-to-end native behavior tests, binding/claim/identity/auth/flag/security tests, type checks, and documentation.
7. Roll out to the reference LangGraph scenario first. Rollback disables the feature flag (bridge registration/actionability/new delivery) and leaves durable request/decision/delivery/audit records readable; `span_projection.v1` and existing observation remain available without a data rollback.

## Open Questions

No blocking architecture questions remain. Exact supported decision types, which LangGraph native result constitutes acceptance, concrete numeric size/depth limits, and the reference graph’s thread-ID requirement will be fixed by the checked-in reference scenario, its installed LangGraph version, and implementation constants covered by tests; unsupported behavior must remain unavailable rather than inferred.

## Accepted Follow-ups

The following items are intentionally deferred and do not block archival:

1. Add a live CI integration path covering the AgentLens API, PostgreSQL, the HTTP LangGraph bridge, OTLP ingestion, and a real LangGraph execution.
2. Consider transitioning an unclaimed pending delivery to `unknown` when its associated bridge binding expires.

These items are outside the acceptance criteria of this change and should be handled as separate future work.
