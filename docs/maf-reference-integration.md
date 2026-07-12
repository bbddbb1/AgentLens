# Microsoft Agent Framework 1.10.0 reference integration

## Boundary assessment

| Classification | Evidence |
|---|---|
| Reusable unchanged | `interrupt_delivery_attempts`, decision idempotency, public interrupt serialization, delivery lifecycle, and Govern UI consume the existing interaction shape. |
| Framework-specific | `packages/sdk-maf/agentlens_maf/reference_runtime.py`, `enrichment.py`, and `governance_bridge.py` retain native workflow/request objects and emit MAF-only facts. |
| Legitimate Core correction | `apps/api-ts/src/services/interrupts/bridgeBindings.ts`, `identityMatch.ts`, and `reconcileActionability.ts` scope bindings and matching by a direct framework policy. |
| Remaining LangGraph coupling | The existing LangGraph route and legacy table remain available during the additive `framework_bridge_bindings` migration. |
| Unnecessary abstraction avoided | No adapter registry, plugin discovery, strategy, profile, factory, or public RuntimeEvidence contract exists. Known translators are direct imports. |
| Deferred candidate | A private bridge route/client shape is observable across both integrations, but remains deliberately unextracted until another framework proves its stable boundary. |

## MAF 1.10.0 constraints

- The reference package pins `agent-framework-core==1.10.0`; fixture manifests record and assert the exact runtime version.
- MAF identity is preserved as `workflow_id`, `executor_id`, `request_id`, request type, and response type. It is never relabeled as LangGraph thread, run, interrupt, or checkpoint identity.
- Only native `request_info` becomes an AgentLens interaction. The MAF bridge owns the live `Workflow`, pending native request, and opaque control reference; Core never receives workflow state, queues, checkpoints, or the control reference.
- The bridge submits only a typed native response through `Workflow.run(responses=...)`. Accepted delivery and terminal runtime outcome are distinct: a native exception after submission is recorded as uncertain, not automatically retried.
- MAF telemetry enrichment carries bounded request type/correlation and outcome labels only. It excludes raw response values, control references, secrets, and workflow state.
- `MAF_GOVERNANCE_ENABLED` is independent of `LANGGRAPH_GOVERNANCE_ENABLED`. Both default off and require the common service token; observability continues when control is unavailable.

## Cross-framework conformance boundary

The repository-level conformance inventory and commands are documented in
[`cross-framework-conformance.md`](cross-framework-conformance.md). The static
manifest points to this MAF package's native fixtures, capability rows, bridge
tests, and real-system harness; it does not import or normalize MAF evidence
into a shared provider model. LangGraph keeps its own native identity and
execution oracle alongside this MAF evidence.

The MAF system gate uses unique mission and branch identifiers, bounded API
readiness checks, no assertion retry, and run-owned cleanup. Its real
workflow/OTel/API/bridge/PostgreSQL boundaries are reported separately from
the explicitly declared `DeterministicModelClient` double. The four primary
scenarios are positive continuation, accepted delivery without terminal
evidence, wrong-scope rejection, and public-output non-disclosure.

Similar harness and summary shapes do not justify a public adapter interface,
runtime evidence/profile, registry/discovery mechanism, generalized report
platform, second projector, or production lifecycle abstraction.

The conformance architecture gate did expose one concrete defect: generic
projection and mission storage were reading LangGraph-native keys directly.
The minimal correction moved that interpretation into the private
`langgraphGovernance` normalizer while preserving the existing Core state and
both framework-owned regression suites. No translator, bridge, or production
module was consolidated.
