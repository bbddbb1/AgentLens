## Context

The completed LangGraph work established two working paths: adapter-produced telemetry enters the private normalization boundary and current `span_projection.v1`, while a thin bridge registers a private live binding, claims an AgentLens decision, applies a native LangGraph command, and reports delivery separately from telemetry-confirmed runtime outcome.

The current implementation proves the behavior but not yet the boundary. Generic delivery and interaction code is already reusable (`interrupts`, `interrupt_delivery_attempts`, decision idempotency, claim/receipt transitions, public serializers, service authentication, and the Govern UI), while several control-path components are still named or coded for LangGraph: `langgraph_bridge_bindings`, bridge-binding queries that hard-code `framework='langgraph'`, a matcher that requires `thread_id` and rejects other frameworks, actionability reconciliation that filters LangGraph, LangGraph-specific feature checks inside shared middleware, and a LangGraph route mounted directly by Core.

Microsoft Agent Framework is not currently present in the workspace lock. For proposal grounding, its Python Core 1.10.0 package was inspected in an isolated environment. That version exposes:

- native workflow spans with `workflow.id`, name, start/completion/error events, and child executor processing spans carrying `executor.id` and `executor.type`;
- explicit executor lifecycle and failure events in the `WorkflowEvent` stream;
- explicit human interaction through `WorkflowContext.request_info(...)`, producing a `request_info` event with `request_id`, source executor, request type, response type, and data;
- native continuation on the same live workflow through `Workflow.run(responses={request_id: value}, ...)`;
- OTel GenAI Agent/Tool/model/token facts when the corresponding Agent and Tool path emits them;
- a new workflow span for each run/continuation, with cross-run context the caller's responsibility.

Those are MAF facts, not LangGraph equivalents. The reference integration must pin and assert 1.10.0 before code and fixture capture so installed behavior remains the source of truth. MAF owns workflow state, pending requests, and native continuation. AgentLens owns observations, decisions, delivery coordination, audit, and only explicitly correlated outcomes.

## Goals / Non-Goals

**Goals:**

- Prove one deterministic real MAF Python workflow through observability and governance in both directions.
- Determine whether existing generic OTel/GenAI normalization, private normalized facts, `span_projection.v1`, interaction persistence, delivery lifecycle, and Govern UI work for a second framework.
- Keep MAF telemetry keys, native identity policy, request-response adaptation, and live execution context outside generic projection and outside the LangGraph package.
- Correct only Core assumptions that are demonstrably framework-neutral after two integrations.
- Preserve explicit failure, explicit relationship evidence, source traceability, idempotency, mission/branch isolation, and non-disclosure.
- Produce a code-grounded boundary assessment without extracting a public adapter interface.

**Non-Goals:**

- Broad MAF feature/orchestration coverage, .NET support, AutoGen, or a third framework.
- Public `RuntimeAdapter`, `GovernanceAdapter`, `TelemetryProfile`, RuntimeEvidence, dynamic discovery, plugins, or a generalized command bus.
- Generalized exactly-once delivery, workflow retry/replay, time travel, debugger behavior, or checkpoint/state inspection.
- Treating MAF workflow, executor, request, trace, conversation, or checkpoint identifiers as control credentials.
- A new UI, framework selector, authorization redesign, or unrelated projection refactor.

## Decisions

### 1. Pin and fingerprint MAF Core 1.10.0 before generating evidence

Create `packages/sdk-maf` with an exact `agent-framework-core==1.10.0` dependency and add it to the uv workspace. Fixture manifests, capability-matrix tests, and the end-to-end harness record both the distribution version and relevant runtime metadata. Tests fail if the installed version differs, so fixture meaning cannot silently drift with a broad version range.

The package uses Core rather than the all-integrations meta-package because the reference workflow requires workflow, Agent, Tool, observability, and local test-double support, not every cloud connector.

Alternative considered: use `agent-framework>=1.10`. Rejected because the request/response and telemetry APIs have changed across releases and native facts must be version-backed.

### 2. Use one deterministic native workflow, not a synthetic telemetry generator

The reference scenario contains a MAF Agent using an in-process deterministic chat-client/test double plus an explicit tool, followed by a workflow executor that issues `ctx.request_info(...)` with a stable request ID and typed response. Its response handler routes to:

- a successful positive or structured continuation;
- a rejected/alternative terminal result when the workflow implements it; and
- an explicit post-acceptance failure path.

This satisfies the required Agent/Tool/executor facts without external credentials. The workflow itself, `WorkflowEvent` stream, native `request_info`, response validation, executor routing, and failure are real MAF behavior. Only model generation is doubled and clearly labeled.

Alternative considered: emit hand-authored OTLP that resembles MAF. Rejected because it would not validate native APIs or behavior.

### 3. Make the capability matrix MAF-owned and fixture-specific

`packages/sdk-maf` owns a checked-in matrix with rows for workflow, executor, Agent, Tool/function, lifecycle, explicit failure, explicit relationships, request ID/type, response type/correlation, native identifiers, model/token usage, source telemetry, and private bridge binding availability/governance binding readiness. Binding readiness is a tested availability condition; the matrix never exposes or treats the executable control reference as an observability fact. Each row records:

- status (`covered`, `partial`, `not_observable`, or `not_applicable`);
- exact MAF source (OTel span/event, `WorkflowEvent`, response API, or bridge observation);
- adapter enrichment where necessary;
- fixture and expected native fact;
- normalization and projected surface;
- limitation.

Completion requires every row to be assessed and fixture-backed, not every row to be covered. Checkpoint identity may remain not applicable because the reference bridge retains a live workflow and uses native response continuation without checkpoint restore.

Alternative considered: extend the LangGraph matrix into a product framework matrix. Rejected because two reference integrations still do not justify a public capability model.

### 4. Prefer native OTel and enrich only explicit streamed facts

The MAF adapter configures the framework's native observability and captures its real spans. Generic OTel/GenAI normalization handles standard parent spans, status/error, Agent, Tool, model, and token attributes where sufficient.

The narrow MAF adapter observes the real `WorkflowEvent` stream and adds explicit, bounded AgentLens-compatible telemetry only where native OTLP lacks sufficient durable facts:

- `request_info` with MAF request ID, source executor ID, request/response type names, display-safe data/schema, and workflow identity;
- response submission/acceptance correlation with AgentLens decision/delivery IDs;
- terminal continuation, alternative result, or failure correlation to the original request and delivery.

Enrichment never invents a request, relationship, identity, or outcome and never emits the private control reference, live workflow object, complete state, message queue, checkpoint payload, or raw sensitive response.

Alternative considered: replace MAF native telemetry with a full custom instrumentor. Rejected because it would test AgentLens's invented model rather than the framework boundary.

### 5. Add a private MAF translator beside existing translators

Add `normalization/maf.ts` and extend `SourceReference.translator` with a private MAF source marker. Responsibilities remain separated:

- `otelGenAi.ts`: standard status, failure, Agent/Tool/model/token semantics;
- `agentLensCompat.ts`: current AgentLens compatibility conventions;
- `langgraph.ts`: LangGraph native keys and rules only;
- `maf.ts`: MAF `workflow.*`, `executor.*`, MAF enrichment keys, and request/response semantics only;
- `normalize.ts`: combines normalized facts and generic explicit relationships without inspecting raw framework keys directly;
- `projection.ts`: consumes normalized facts and never reads MAF attributes/events.

The private normalized structure gains only fields required by the MAF matrix, such as workflow/executor/request identity and explicit workflow relationship source. It remains unversioned, disposable, and unexported. No registry or dynamic profile selection is introduced; normalization calls the two known translators explicitly.

Alternative considered: define a public RuntimeEvidence or TelemetryProfile now. Rejected because this iteration's purpose is to discover the boundary, not freeze it.

### 6. Preserve MAF identity in MAF terms

The reference identity policy is derived from the exact MAF 1.10.0 fixtures and uses actual MAF facts:

- required match: mission ID, branch ID, framework=`ms_agent_framework`, `workflow_id`, and native `request_id`;
- consistency when present on both sides: `source_executor_id`, request type, response type, trace/span correlation, Agent/conversation identity, and adapter activity correlation;
- conditional promotion: `source_executor_id` becomes required only if the real MAF 1.10.0 reference fixture proves that correct native response routing depends on it;
- private governance binding: opaque bridge control reference tied locally to the live `Workflow` object and pending request context.

No `thread_id`, LangGraph `run_id`, interrupt ID, or checkpoint ID is required unless MAF itself emits an independently named fact with that exact meaning. Public `metadata.native_runtime_identity` receives only allowlisted observational values such as framework, `workflow_id`, `executor_id`, and `request_id`; private binding identity can retain additional exact match keys without exposing control data.

Missing required identity or any explicit conflict in required/consistency fields makes governance non-actionable. Missing optional consistency identity does not block an otherwise valid request. Observational IDs never authenticate bridge calls.

Alternative considered: place `workflow_id` into `thread_id` and `request_id` into `interrupt_request_id`. Rejected because field reuse would conceal incompatible native semantics.

### 7. Generalize only the private Core mechanics already proven common

The second integration requires four focused Core corrections:

1. rename/migrate `langgraph_bridge_bindings` to a private framework-neutral binding table while preserving existing rows, and parameterize binding queries by explicit framework;
2. make exact identity matching accept a small constant private policy object (`expected framework`, required native keys, consistency keys) supplied directly by each explicit LangGraph or MAF route module, while retaining current LangGraph policy unchanged;
3. make actionability reconciliation take framework, feature availability, and identity policy rather than filtering LangGraph internally;
4. separate common service-token verification from independently evaluated LangGraph and MAF enablement flags.

Delivery attempts, decisions, monotonic outcome reconciliation, structured-value bounds, public serializers, and UI state remain shared without copies. LangGraph and MAF each retain explicit route modules and bridge packages. Policy selection is direct constant passing only: no policy registry, strategy framework, adapter factory, dynamic dispatch, discovery mechanism, or public policy/common-interface contract is created.

Every Core change is documented in the boundary report as a legitimate framework-neutral correction, remaining coupling, unnecessary abstraction, or deferred interface candidate.

Alternative considered: copy the LangGraph table and state services into MAF-named modules. Rejected because it would fork safety-critical idempotency and delivery semantics.

### 8. Reconcile an explicit native request with a live MAF binding

The existing interaction row is populated only after ingestion of the adapter's explicit `request_info` observation. A MAF bridge binding may register before or after telemetry, but it cannot create an interaction by itself. The request becomes actionable only when:

- MAF governance is independently enabled and service authentication is configured;
- the explicit request observation exists in the mission/branch;
- a live, unexpired binding for framework `ms_agent_framework` matches the MAF identity policy;
- the response type is supported and safe input validation can be represented;
- required identity is present, optional identity is allowed to remain partial, and explicit identity values are non-conflicting.

Inactivity, a workflow status that looks idle, checkpoint existence, executor order, names, or timing never creates actionability. The current public interaction shape carries supported decision controls and safe schema to the existing Govern UI.

Alternative considered: infer an interaction from MAF `IDLE_WITH_PENDING_REQUESTS`. Rejected because that state does not identify the request, response contract, or correct live binding.

### 9. Keep the MAF bridge thin and live-object-owned

`MafGovernanceBridge` owns:

- the live MAF `Workflow`/application object;
- the pending native `request_info` event and request ID;
- the expected response type and reference-scenario mapping;
- the private random control reference and binding lease;
- an in-process seen-delivery safeguard keyed by AgentLens delivery ID.

Core's durable one-time claim is the cross-restart at-most-once issuance guarantee: once a delivery has been claimed, Core never issues that delivery instruction again to the same or a restarted bridge. After the first claim, Core provides only `{interaction_request_id, decision_id, decision_type, value, delivery_id}`. The bridge validates the native request is still pending, maps the already validated AgentLens response into the exact MAF response type, and calls native `workflow.run(responses={request_id: value}, stream=True)` or the installed version's equivalent.

The bridge's seen-delivery set only suppresses duplicate handling inside one process. It is not restart-safe, is not a second source of at-most-once truth, and is not persisted. This change adds no durable bridge journal. After a bridge restart and re-registration, polling a delivery already claimed before the restart returns no application instruction, so the restarted bridge cannot apply it again.

Claim remains delivery `pending`. Delivery becomes accepted only after an explicit native event/result shows the response was accepted for that request. The bridge then continues consuming native events so correlated terminal outcome telemetry can update runtime outcome independently. If native acceptance becomes uncertain, delivery is `unknown` and is not automatically reissued.

Alternative considered: let Core deserialize MAF request types and call `Workflow.run`. Rejected because Core must not own Python objects, MAF validation, or workflow state.

### 10. Reuse governance axes and keep framework flags isolated

MAF uses the existing axes unchanged:

```text
request lifecycle
decision state
delivery state
runtime outcome
```

The established distinctions remain:

```text
decision recorded != bridge claim != delivery accepted != runtime continued
```

`MAF_GOVERNANCE_ENABLED` is disabled by default and independent of `LANGGRAPH_GOVERNANCE_ENABLED`. Common service authentication is required for both, but enabling one framework does not enable or authorize the other. If `MAF_GOVERNANCE_ENABLED=true` while no service credential is configured, MAF bridge endpoints and actionability fail closed as unavailable while MAF observability through `span_projection.v1` continues. Missing or invalid service authentication is rejected before control-reference or binding checks; possession of a control reference never substitutes for service authentication. Correct service authentication still cannot cross framework, mission, or branch scope.

Alternative considered: one global governance flag. Rejected because it would let rollout of one framework broaden another framework's control plane.

### 11. Derive explicitly correlated MAF outcome from evidence

The MAF translator/reconciler records runtime outcome only from explicit native events/results tied to both request and delivery. This is an evidence-backed observation and creates no separate AgentLens outcome authority:

- accepted response followed by explicit successful output/completion -> `continued_with_input` or the existing compatible success outcome;
- explicit alternative/rejected terminal path -> `rejected_or_terminated`;
- explicit workflow/executor failure after response acceptance -> `failed` while delivery remains accepted;
- response application failure before native acceptance -> delivery failed, runtime outcome unchanged/unknown;
- accepted delivery with no correlated terminal event -> runtime outcome unknown.

A later workflow span is insufficient because MAF creates separate workflow spans for continuations and unrelated runs may share workflow identity. Correlation enrichment must explicitly carry request and delivery IDs.

Alternative considered: treat any `workflow.completed` after a claim as continuation. Rejected because completion without explicit request/delivery correlation is ambiguous.

### 12. Validate with layered tests and one real system harness

Unit tests use database/HTTP doubles only for isolated mapping, matching, and failure cases. Adapter fixture generation uses the real MAF 1.10.0 workflow and OTel SDK with an in-memory span exporter. The end-to-end target uses:

- real MAF workflow/request-response execution;
- real MAF/OTel spans and AgentLens OTLP JSON export;
- real AgentLens Express HTTP routes and service authentication;
- a real PostgreSQL test database for interaction, binding, decision, delivery, and outcome persistence;
- real private bridge HTTP registration/claim/receipt;
- the deterministic model client as the only required execution double.

The harness declares each real component and each double in its manifest/output. It covers positive/structured continuation, failure, accepted-without-outcome, duplicate submission/polling, bridge restart after a durable claim, fixture-driven optional identity, identity conflict, binding expiry, fail-closed missing/invalid authentication, authenticated wrong framework/mission/branch scope, control reference without service authentication, unrelated activity, and public scrubbing.

Alternative considered: call store functions directly for the primary conformance path. Rejected because it would not validate HTTP, OTLP, transactions, or public serialization together.

### 13. Finish with a code-grounded boundary report, not extraction

The final report inventories code and test evidence under:

- reusable without change;
- framework-specific;
- legitimate framework-neutral correction;
- remaining LangGraph coupling;
- unnecessary abstraction found/avoided;
- deferred common-interface candidate.

It explicitly evaluates generic OTel/GenAI normalization, projection, interaction persistence, decision recording, delivery lifecycle, UI, security/idempotency, telemetry enrichment, identity mapping, private execution binding, native operation translation, and outcome correlation. No public interface is created from the report in this change.

## Risks / Trade-offs

- **[MAF API/telemetry changes invalidate fixtures]** -> Exact 1.10.0 pin and fixture fingerprint; version changes require deliberate fixture regeneration and review.
- **[Native OTLP omits request-response facts]** -> Enrich only explicit `WorkflowEvent` and bridge observations with source references; mark matrix gaps honestly.
- **[MAF identity is insufficient for safe binding]** -> Require mission/branch/framework/workflow/request identity; treat source executor as consistency-only unless the fixture proves routing requires it; allow missing optional fields and block explicit conflicts.
- **[Workflow response is accepted but terminal telemetry is lost]** -> Preserve accepted delivery and unknown runtime outcome; never infer success.
- **[Genericizing bindings regresses LangGraph]** -> Migration preserves rows, framework becomes part of every query/auth check, and all LangGraph suites remain acceptance gates.
- **[A private policy helper grows into a profile system]** -> Each explicit route passes one small constant object directly to the shared matcher; add no registry, strategy framework, adapter factory, dynamic dispatch, discovery, or public export.
- **[A bridge restart loses its process-local duplicate set]** -> Rely on Core's durable one-time claim to prevent reissuance across restarts; keep the local set non-durable and test restarted polling without adding a bridge journal.
- **[MAF is enabled without service authentication]** -> Fail endpoints and actionability closed while leaving observability operational; never accept a control reference as substitute authentication.
- **[Deterministic model double hides Agent behavior]** -> Use the real MAF Agent and Tool execution pipeline; double only model response generation and document the boundary.
- **[Sensitive request/response data leaks]** -> Apply existing structured bounds and public allowlists; export safe summaries/schema only; scan all public outputs.

## Migration Plan

1. Add and lock `packages/sdk-maf` at Agent Framework Core 1.10.0; record version fingerprints.
2. Build the real deterministic reference workflow, native fixture generator, and initial truthful capability matrix before changing projection or governance.
3. Add private MAF translation and route its matrix facts through current normalization and `span_projection.v1`.
4. Migrate bridge-binding storage/services to explicit framework scope, parameterize identity/actionability/auth gating, and prove unchanged LangGraph behavior.
5. Add the MAF bridge route/package and reconcile explicit MAF requests with independently gated live bindings.
6. Add correlated response/outcome telemetry, reuse decision/delivery state, and verify the existing Govern UI with MAF requests.
7. Run the real HTTP/PostgreSQL/OTLP end-to-end harness, including bridge restart after durable claim and fail-closed authentication/scope cases, security scans, all LangGraph regressions, builds/type checks, and strict OpenSpec validation.
8. Publish the cross-framework boundary report. Rollback disables `MAF_GOVERNANCE_ENABLED`, removes the MAF adapter package/translator, and leaves LangGraph plus `span_projection.v1` operational; the generic binding migration remains backward-compatible.

## Open Questions

No blocking planning questions remain. The capability matrix must record whether model/token facts and workflow relationships are covered or partial in the exact 1.10.0 fixtures. If native response acceptance cannot be distinguished from terminal completion through the installed API, the bridge must conservatively leave delivery or outcome unknown rather than infer a stronger state.
