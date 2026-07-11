## Why

AgentLens can now observe LangGraph interrupt and execution identity through `span_projection.v1`, but it cannot safely carry a user decision back to the corresponding LangGraph execution or distinguish a recorded decision, bridge delivery, and telemetry-confirmed runtime outcome. The next iteration should prove that UI-to-Runtime boundary with one production-oriented LangGraph vertical slice before any cross-framework control abstraction is considered.

## What Changes

- Preserve explicitly recorded LangGraph native identity across an activity lifecycle by merging identity field by field and surfacing conflicts instead of replacing earlier values with a later partial identity.
- Turn only explicitly observed, source-traceable LangGraph interrupt requests into actionable records in the existing mission/branch interrupt model, including supported request type and display-safe prompt or input-schema information.
- Durably and audibly record only the decisions supported by the reference LangGraph scenario, with actor, value, timestamp, and idempotency identity; a decision record does not claim delivery or resume.
- Bound operator-supplied structured decision values with conservative size, depth, collection, and type limits; validate against the request schema before recording; reject binary and unsupported arbitrary objects; allowlist public display fields; keep decision values out of OTLP, replay, graph, explanation, and unrestricted audit output unless a safe summary or redaction is used; treat secrets/tokens/credentials as out of scope unless an existing dedicated secret mechanism applies.
- Add a thin LangGraph-specific governance bridge that owns a private adapter control reference and translates a framework-neutral decision request into the supported native resume/input operation.
- Define a minimal private bridge-binding lifecycle (`active`, `expired`, `revoked`, `consumed`) with registration time, lease expiry, last successful heartbeat or renewal, binding generation or replacement identity, and revocation/consumption state so only an active, unexpired binding may make a request actionable; re-registration creates a new private control reference and supersedes the previous binding; expired or revoked bindings cannot claim decisions; bridge and AgentLens restart behavior is defined; the raw private control reference remains undisclosed. No generalized service discovery or cross-framework lease system is introduced.
- Separate internal bridge claim from external delivery acceptance: a claim reserves delivery for one binding instance and keeps external delivery `pending` until an explicit receipt that the native operation was accepted; claim timeout with uncertain native application yields `unknown` without automatic retry; repeated claims and receipts remain idempotent; claim internals stay private where possible.
- Track bridge delivery separately from the user decision and the observed runtime outcome, including pending, accepted/delivered, failed, stale, and already-resolved conditions.
- Reconcile out-of-order decision records, bridge receipts, and correlated runtime telemetry deterministically and idempotently so state converges on stable interaction, decision, delivery, and interrupt correlation IDs without regressing stronger recorded states or letting unrelated later activity imply resume.
- Derive the final runtime outcome only from explicitly correlated LangGraph telemetry or another authoritative native result; successful delivery alone does not mean the runtime resumed.
- Gate bridge registration and request actionability behind a LangGraph governance feature flag that is disabled by default; disabling prevents new control delivery without deleting existing request, decision, delivery, or audit records; `span_projection.v1` observability remains available; operator UI controls remain hidden or non-actionable when governance is unavailable.
- Extend the existing HITL UI just enough to show the request, supported actions/input, decision state, delivery state, runtime-outcome state, and delivery failures while preventing action after resolution.
- Add a real LangGraph end-to-end scenario and failure/idempotency fixtures using explicit LangGraph behavior as the correctness oracle, including binding liveness, claim-without-acceptance, claim-timeout unknown delivery, exact identity matching, auth and mission/branch isolation, out-of-order reconciliation, structured-input bounds/redaction, and feature-flag on/off behavior.
- Keep `span_projection.v1`, the span-backed evidence model, current replay/graph/explanation architecture, and existing interrupt/control surfaces intact.
- Explicitly defer a generalized multi-framework governance protocol, second framework, dynamic plugins, arbitrary workflow controls, checkpoint/state browsing, public executable references, public RuntimeEvidence, and broad UI or authorization redesign.

## Capabilities

### New Capabilities

- `langgraph-interaction-governance`: Defines how explicit LangGraph interrupt observations become actionable AgentLens interaction requests and how supported user decisions are recorded, audited, constrained, and presented in the existing HITL surface.
- `langgraph-governance-delivery`: Defines the thin LangGraph bridge, private adapter-owned control reference, binding liveness, claim-versus-acceptance delivery lifecycle, out-of-order reconciliation, idempotent delivery, and strict separation between decision, delivery, and authoritative runtime outcome.
- `langgraph-governance-conformance`: Defines real LangGraph end-to-end acceptance and negative-path coverage for governance delivery, identity matching, binding liveness, claim/receipt ordering, idempotency, outcome confirmation, structured-input bounds, feature-flag behavior, and control-data non-disclosure.

### Modified Capabilities

- `langgraph-runtime-observability`: Requires lifecycle identity to merge per field, retain earlier recorded identifiers when later evidence is partial, and diagnose conflicting explicit identifiers without treating observational identity as control authority.

## Impact

- `apps/api-ts` interrupt persistence, mission-store orchestration, routes, runtime normalization, audit/realtime events, feature-flag gating, and focused tests gain separate request, decision, delivery, and observed-outcome handling plus private binding lease/claim metadata and deterministic identity matching.
- `packages/sdk-langgraph` gains the narrow governance bridge, private control-reference ownership with lease/heartbeat/replacement semantics, explicit resume/input correlation telemetry, a real reference scenario, and adapter tests without exposing checkpoint payloads or runtime secrets.
- `packages/protocol` receives only the smallest additions needed by the existing interrupt API/UI for supported request, decision, delivery, and outcome states; no public cross-framework governance adapter protocol is introduced.
- `apps/web` reuses the current Govern/HITL UI and limits controls to decision types declared by the actionable request; controls remain hidden or non-actionable when the governance feature flag is off.
- Existing `span_projection.v1` replay, graph, explanation, and observational `native_runtime_identity` remain authoritative for runtime observation and must not expose adapter control references.
- Persistence changes are limited to durable, auditable governance state and private bridge-reference/binding/claim storage required by this vertical slice; complete LangGraph checkpoint/application state is never stored.
- Private bridge endpoints reuse the repository’s existing service authentication and mission/branch isolation; the random control reference is not the sole authorization boundary.
