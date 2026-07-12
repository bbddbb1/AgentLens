## Why

AgentLens has proved observability and governance with LangGraph, but several supposedly reusable Core paths still contain LangGraph-specific storage, identity, feature-gate, and routing assumptions. A minimal Microsoft Agent Framework integration is the next necessary test of whether `span_projection.v1` and the existing governance state model are genuinely framework-neutral before extracting any common public adapter contract.

## What Changes

- Add a Python `packages/sdk-maf` reference package pinned to Microsoft Agent Framework Core 1.10.0, the stable API inspected for this proposal, and record/assert the resolved package version in every generated fixture and conformance run. The workspace currently has no MAF dependency, so implementation must install and lock this exact reference version before capturing facts rather than silently using an unrecorded version.
- Build one deterministic real MAF workflow using the native Python workflow API, at least an Agent plus an executor or two executors, an explicit Tool/Agent invocation, native `request_info`, continuation through the native responses API, a successful path, and an explicit failure path without external model credentials.
- Add a small MAF-owned, fixture-backed capability matrix for only the reference scenario, including private bridge binding availability/governance binding readiness without exposing an executable reference, and allowing `covered`, `partial`, `not_observable`, and `not_applicable` outcomes without forcing LangGraph concepts or full MAF coverage.
- Prefer MAF's native OpenTelemetry workflow, executor, Agent, Tool, lifecycle, failure, GenAI, and token facts; add only narrow adapter enrichment for explicit native facts such as streamed request/response events and delivery correlation that native OTLP does not preserve sufficiently.
- Add a private MAF telemetry translator beside generic OTel/GenAI, AgentLens compatibility, and LangGraph translation. Generic projection consumes framework-neutral normalized facts and never directly inspects MAF-specific attributes or event names.
- Preserve actual MAF identity in its own terms, including `workflow.id`, executor identity, request ID/type, response type/correlation, and trace/span references where emitted. The fixture-backed reference policy requires mission, branch, framework, workflow ID, and request ID; source executor ID is a consistency field unless the real MAF 1.10.0 fixture proves it is required for native response routing. Missing optional identity does not block an otherwise valid request, while explicit conflicts do. Do not map MAF facts into LangGraph thread, run, interrupt, or checkpoint fields merely for reuse.
- Represent only an explicit native MAF `request_info` event through the existing AgentLens interaction shape, including safe request data/schema, supported response type, actionability, source references, and identity diagnostics.
- Add a thin private MAF governance bridge that retains the live MAF workflow/application object and pending request context locally, claims the existing framework-neutral decision/delivery payload, and applies it through the installed version's native `Workflow.run(responses={request_id: value})` behavior.
- Reuse the existing request, decision, delivery, runtime-outcome, audit, idempotency, authentication, mission/branch isolation, binding lease, durable one-time claim, scrubbing, feature-gate, and Govern UI behavior rather than copying those state machines into MAF code. Core's durable one-time claim is the cross-restart guarantee that prevents a delivery instruction from being issued twice; bridge-local delivery tracking is only an in-process duplicate-handling safeguard and adds no durable journal.
- Make only framework-neutral Core corrections proven necessary by the second integration: parameterize private bridge bindings and actionability reconciliation by framework, remove the fixed LangGraph/thread identity policy from the shared matcher, separate generic service authentication from framework feature gates, and keep LangGraph and MAF flags independently controllable. The explicit LangGraph and MAF route modules pass only small constant policy objects (`expected framework`, required keys, consistency keys) to the shared private matcher; no registry, strategy framework, adapter factory, dynamic dispatch, discovery mechanism, or public policy contract is introduced.
- Fail closed when `MAF_GOVERNANCE_ENABLED=true` but service authentication is absent or invalid: MAF governance endpoints and actionability remain unavailable while observability continues. A control reference never substitutes for service authentication, and correctly authenticated requests still require the exact framework, mission, and branch scope.
- Confirm MAF runtime outcome only from explicitly request-and-delivery-correlated native workflow results or telemetry. Accepted delivery without a result remains unknown; unrelated later activity, HTTP success, a claim, or checkpoint creation does not prove continuation. This remains an evidence-backed observation and creates no separate AgentLens outcome authority.
- Add a repeatable real MAF telemetry/API/bridge harness, including bridge restart after a durable claim, fail-closed authentication, scope-mismatch, and control-reference-without-service-auth cases; preserve LangGraph tests and produce a code-grounded cross-framework boundary report classifying Core changes and deferred common-interface candidates.
- Keep `span_projection.v1` as the only production projector; do not add RuntimeEvidence, a second projector, a public adapter interface, a registry/plugin system, a command bus, or broad MAF/.NET coverage.

## Capabilities

### New Capabilities

- `maf-reference-observability`: Defines the MAF 1.10.0 reference workflow, truthful capability assessment, explicit native facts/identity, fixture provenance, and evidence-first observability coverage.
- `maf-telemetry-translation`: Defines private MAF-specific translation and the separation between native MAF telemetry, generic OTel/GenAI interpretation, AgentLens compatibility, and generic projection.
- `maf-interaction-governance`: Defines how an explicit MAF request-response event enters the existing AgentLens interaction model and reuses decision, validation, UI, audit, and actionability semantics.
- `maf-governance-delivery`: Defines the MAF-owned live execution binding, native response application, independent fail-closed feature/authentication gate, durable Core claim responsibility, delivery lifecycle reuse, and explicitly correlated outcome behavior.
- `maf-reference-conformance`: Defines real end-to-end validation, negative/security cases, LangGraph regression protection, and the required code-grounded cross-framework boundary assessment.

### Modified Capabilities

None. Existing LangGraph and projection requirements remain valid; any Core edits are private framework-neutral corrections exercised by the new MAF capabilities rather than changes to the LangGraph contracts.

## Impact

- A new `packages/sdk-maf` workspace package adds the exact MAF Core dependency, reference workflow, narrow telemetry enrichment, private bridge, fixtures, capability matrix, and Python tests.
- `apps/api-ts/src/services/runtime/normalization/` gains a private MAF translator and only the minimal shared normalized fields needed by current projection; `projection.ts` remains free of MAF keys and continues to emit `span_projection.v1`.
- Existing interrupt persistence, delivery attempts, decision route, public serializer, and UI shape are reused. Private bridge-binding/actionability services and database naming become framework-parameterized while retaining LangGraph data and behavior.
- MAF receives its own authenticated private route and independently disabled-by-default feature flag; it cannot claim a LangGraph binding, and LangGraph cannot claim a MAF binding.
- `apps/web` reuses the existing Govern components and structured-input validation without a framework selector or MAF-specific dashboard.
- Documentation and tests record which components were reusable unchanged, which required legitimate Core correction, which coupling remains, and which common interface candidates stay deferred.
