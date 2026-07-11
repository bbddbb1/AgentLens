## 1. Pin MAF and Build the Reference Workflow

- [x] 1.1 Add `packages/sdk-maf` to the uv workspace with exact `agent-framework-core==1.10.0`, lock the dependency, and add a runtime version assertion used by fixtures and tests.
- [x] 1.2 Implement an in-process deterministic MAF-compatible model client/test double and a real MAF Agent plus explicit Tool invocation without external credentials.
- [x] 1.3 Build the minimal real workflow around the Agent/Tool and one or more executors, including stable workflow/executor identifiers, a successful terminal path, and an explicit executor/workflow failure path.
- [x] 1.4 Add a typed native `request_info` request and response handler with positive/structured continuation and a truthful alternative/rejected path where implemented.
- [x] 1.5 Add focused Python tests proving the installed MAF version, real executor/Agent/Tool execution, request event shape, native response validation, success, alternative, and failure behavior.

## 2. MAF Capability Matrix and Adapter-Produced Fixtures

- [x] 2.1 Add the MAF-owned capability matrix with all required workflow, executor, Agent, Tool/function, lifecycle, failure, relationship, request/response, identity, model/token, source, and private bridge binding availability/governance binding readiness rows and truthful initial statuses, without exposing an executable control reference as an observability fact.
- [x] 2.2 Configure MAF native observability and capture baseline OTel spans/events from the real reference workflow using the OTel SDK without hand-authoring telemetry.
- [x] 2.3 Add narrow MAF adapter enrichment for explicit streamed `request_info`, response/delivery correlation, and terminal outcome facts missing from native OTLP, with bounded safe data and source references.
- [x] 2.4 Generate checked-in fixtures and expected-native-fact declarations for success, Agent/Tool, request, continuation, alternative, explicit failure, unknown telemetry, missing identity, conflicting identity, and unrelated later activity.
- [x] 2.5 Fingerprint the exact MAF distribution/runtime version and fixture-generation path in each fixture manifest and fail regeneration/conformance on version mismatch.
- [x] 2.6 Add executable matrix tests proving each row is fixture-backed while allowing `partial`, `not_observable`, and `not_applicable` completion states.

## 3. Private MAF Telemetry Translation

- [x] 3.1 Extend private normalized fact/source types only with the MAF workflow, executor, request, response, and correlation fields required by the matrix, without public protocol or persisted RuntimeEvidence types.
- [x] 3.2 Add `normalization/maf.ts` for MAF `workflow.*`, `executor.*`, request enrichment, and native identity rules while leaving standard GenAI Agent/Tool/model/token facts in generic OTel/GenAI translation.
- [x] 3.3 Integrate the MAF translator explicitly beside AgentLens compatibility and LangGraph translation, with no dynamic registry, profile selection, or plugin machinery.
- [x] 3.4 Add normalization tests for workflow/executor/Agent/Tool facts, explicit failure dominance, native request/response identity, source traceability, unknown telemetry, and no timing/name/order relationship inference.
- [x] 3.5 Route MAF normalized facts through existing `projectReplay()`, `projectTraceSnapshot()`, and explanation inputs while keeping all MAF keys/event interpretation out of generic projection code.
- [x] 3.6 Add architectural and semantic tests proving MAF uses `span_projection.v1`, unresolved relationships create no edges, explicit relationships remain evidence-backed, and no second projector/public RuntimeEvidence is introduced.

## 4. Framework-Neutral Core Corrections

- [x] 4.1 Migrate the private `langgraph_bridge_bindings` storage to an explicitly framework-scoped binding table while preserving existing LangGraph rows, lifecycle state, generation, leases, and hashes.
- [x] 4.2 Parameterize binding registration, renewal, expiry, authentication, and lookup by exact framework plus mission/branch without duplicating binding services for MAF.
- [x] 4.3 Refactor the private exact identity matcher so each explicit LangGraph or MAF route passes one small constant object containing expected framework, required native keys, and consistency keys; preserve LangGraph behavior and add no policy registry, strategy framework, adapter factory, dynamic dispatch, discovery, or public policy contract.
- [x] 4.4 Parameterize actionability reconciliation only by the route-supplied constant framework availability and identity policy instead of hard-coded LangGraph/thread rules, retaining binding-only, observation-only, optional-identity, and explicit-conflict safety behavior.
- [x] 4.5 Separate common service-token verification from independently disabled-by-default `LANGGRAPH_GOVERNANCE_ENABLED` and `MAF_GOVERNANCE_ENABLED` checks; fail MAF endpoints/actionability closed when enabled without configured authentication while leaving observability operational.
- [x] 4.6 Add or refactor thin explicit LangGraph and MAF private bridge route modules to call the same binding, actionability, claim, receipt, idempotency, and outcome services using their direct constant policies, without adding a policy/route/adapter registry, strategy, factory, or discovery layer.
- [ ] 4.7 Add migration and service tests proving existing LangGraph bindings still register/renew/claim/receipt correctly; missing/invalid MAF authentication and control reference without service auth fail closed; and correctly authenticated wrong-framework, wrong-mission, and wrong-branch requests always fail.

## 5. Explicit MAF Interaction Observation

- [ ] 5.1 Ingest only the explicit MAF request enrichment into the existing interrupt/interaction record with framework, workflow/executor activity, native request ID/type, response type, safe prompt/schema, and source references.
- [ ] 5.2 Preserve MAF-native `workflow_id`, `executor_id`, and `request_id` terminology in private/native metadata without synthesizing LangGraph thread/run/interrupt/checkpoint fields.
- [ ] 5.3 Derive the reference MAF identity policy from real 1.10.0 fixtures: require mission, branch, framework, workflow ID, and request ID; treat source executor ID as consistency-only unless fixtures prove native routing requires it; retain request/response type and trace/activity correlation as consistency fields.
- [ ] 5.4 Reconcile request observation and live MAF binding in either arrival order; allow missing optional identity, block explicit conflicts, and keep binding-only, idle-only, checkpoint-only, unsupported response, missing required identity, expired binding, flag-off, and auth-unavailable cases non-actionable.
- [ ] 5.5 Reuse the existing decision API, structured-input validation/bounds, actor/audit provenance, idempotency, one-decision rule, and delivery creation for actionable MAF requests without MAF-specific decision persistence.
- [ ] 5.6 Add API/store tests for explicit request actionability, safe request serialization, unsupported response types, missing/conflicting MAF identity, mission/branch isolation, duplicate decisions, and absence-based non-inference.

## 6. Thin MAF Governance Bridge

- [ ] 6.1 Implement `MafGovernanceBridge` with a private opaque control reference and local ownership of the live `Workflow`, pending native request event, expected response type, and continuation context.
- [ ] 6.2 Add the MAF bridge HTTP client for authenticated register, renew, claim, and receipt against MAF-specific private routes while sending no live workflow state or checkpoint payload to Core.
- [ ] 6.3 Translate only reference-supported AgentLens decision types/values into the exact MAF response type and call native `Workflow.run(responses={request_id: value}, stream=True)` or the verified 1.10.0 equivalent.
- [ ] 6.4 Mark delivery accepted only after explicit native response acceptance evidence, report pre-acceptance validation/application errors as delivery failures, and report no-longer-pending requests as stale.
- [ ] 6.5 Rely on Core's durable one-time claim as the cross-restart guarantee against reissuing a delivery; keep bridge delivery-ID tracking as an in-process duplicate-handling safeguard only, add no durable bridge journal, preserve idempotent receipts, and use `unknown` without automatic reissue when native application becomes uncertain.
- [ ] 6.6 Emit bounded explicit request/delivery correlation on native continuation, alternative completion, and failure telemetry without emitting the control reference, workflow object, queue, checkpoint state, secrets, or raw sensitive response.
- [ ] 6.7 Add Python bridge tests for live binding, lease renewal/expiry, supported response mapping, stale request, invalid response type, in-process duplicate handling, uncertainty, accepted/failure receipts, and bridge restart after a durable Core claim proving the delivery is not reissued or applied again without a bridge journal.

## 7. Explicitly Correlated MAF Outcome and Govern UI Compatibility

- [x] 7.1 Extend MAF normalization/ingestion to recognize only explicitly request-and-delivery-correlated native response acceptance, successful continuation, alternative/rejected result, and executor/workflow failure as evidence-backed observations, without adding a separate AgentLens outcome authority.
- [x] 7.2 Reuse shared monotonic delivery/outcome reconciliation so accepted-without-result remains unknown, runtime failure after acceptance preserves accepted delivery, and pre-acceptance bridge failure does not fabricate runtime failure.
- [ ] 7.3 Add API/projection tests for successful response continuation, structured continuation, alternative path, accepted-without-outcome, runtime failure after acceptance, delivery failure before acceptance, duplicate/out-of-order evidence, and unrelated later workflow activity.
- [x] 7.4 Verify the existing Govern client/store/components render MAF through the current interaction shape, show only declared controls, reuse structured-input validation, separate all state axes, and disable action after decision/resolution.
- [x] 7.5 Add web tests proving the same components support LangGraph and MAF, bridge errors remain distinct from runtime errors, flag-off MAF requests are non-actionable, and no framework selector/dashboard is introduced.

## 8. Real End-to-End System Conformance

- [ ] 8.1 Add a repeatable harness manifest that records MAF version and explicitly labels the real MAF runtime, OTel/OTLP path, Express HTTP, service authentication, private bridge HTTP, PostgreSQL database, and deterministic model double.
- [ ] 8.2 Run the full real path from MAF workflow request through OTLP ingestion, interaction observation, binding registration, decision API, one-time claim, native response, correlated telemetry/result, persisted state, and public replay/interaction response.
- [ ] 8.3 Add end-to-end positive/structured continuation and truthful alternative path coverage, including successful Agent/Tool and executor lifecycle assertions using native facts as the primary oracle.
- [ ] 8.4 Add end-to-end explicit failure, accepted-delivery-without-outcome, runtime-failure-after-acceptance, and pre-acceptance-delivery-failure cases.
- [ ] 8.5 Add end-to-end duplicate decision/polling, bridge restart after durable claim, optional source-executor identity, missing/conflicting required identity, expired binding, independent feature flags, MAF-enabled-without-auth, missing/invalid auth, valid control reference without service auth, authenticated wrong framework/mission/branch, unrelated later activity, and cross-framework control rejection cases.
- [ ] 8.6 Add public-output scans over interaction APIs, realtime payloads, replay, graph, explanation, audit output, and UI fixtures proving no raw/recoverable control reference, workflow/executor state, queue, checkpoint payload, secret, or response credential leaks.

## 9. Boundary Assessment, Documentation, and Validation

- [x] 9.1 Produce the code-grounded cross-framework boundary report with concrete modules/tests under reusable unchanged, framework-specific, legitimate Core correction, remaining LangGraph coupling, unnecessary abstraction, and deferred common-interface candidate classifications.
- [x] 9.2 Document MAF 1.10.0 capability limitations, native identity terminology, request-response semantics, telemetry enrichment boundary, private bridge ownership, state-axis separation, and independent feature-flag deployment.
- [x] 9.3 Add architecture tests confirming MAF code does not enter the LangGraph package, LangGraph code does not interpret MAF, generic projection contains no MAF keys, each route directly passes a small constant identity policy, and no public adapter/profile/policy contract, registry, strategy framework, adapter factory, dynamic dispatch, or discovery mechanism is introduced.
- [x] 9.4 Run all existing LangGraph observability/governance/security/UI tests and resolve only genuine framework-neutral regressions without changing LangGraph native semantics.
- [ ] 9.5 Run MAF and workspace Python tests, API/web tests, real PostgreSQL/HTTP/OTLP conformance, builds, lint/type checks, public-output scans, and `openspec validate establish-maf-reference-integration --type change --strict`; resolve all relevant failures.
