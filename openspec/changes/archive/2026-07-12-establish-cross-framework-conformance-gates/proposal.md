## Why

LangGraph and Microsoft Agent Framework now demonstrate the same bounded AgentLens observability and governance model, but their evidence is spread across framework-owned fixtures, unit tests, and unequal system harnesses. Repeatable cross-framework gates are needed now to prevent generic Core or projection changes from weakening the proven boundary while still preserving each framework's native semantics and oracle.

## What Changes

- Define a small, explicit inventory of AgentLens invariants already demonstrated by both integrations, with per-framework `covered`, `partial`, `not_observable`, or `not_applicable` results and links to framework-owned evidence.
- Add one static test-only manifest containing invariant IDs, per-framework status and limitations, evidence file paths, and explicit repository test commands; do not introduce an evidence-provider interface, adapter, registry, dynamic framework mapping, package-import protocol, or shared production framework model.
- Keep native identity, telemetry interpretation, lifecycle assertions, response application, failure behavior, fixtures, and expected-native-fact oracles inside each framework package; the manifest points to that evidence rather than importing or normalizing it.
- Add architecture gates proving generic Core and `span_projection.v1` do not interpret framework-native keys and that explicit private translators, bridges, identity policies, and route policies remain framework-owned.
- Add governance-state, exact-binding, correlation, isolation, feature-gate/authentication, public-output, and observability-when-governance-disabled gates across both integrations.
- Make both real integration paths reliable minimal gate candidates by adding LangGraph's real HTTP/PostgreSQL/OTLP governance path and retaining MAF's real path, each covering one positive continuation, accepted delivery without terminal outcome, one exact-binding or wrong-scope rejection, and public-output non-disclosure.
- Add documented repository test entry points for fast, framework system, combined system, summary, and release execution, with deterministic terminal output and one small machine-readable summary; these commands and summaries are not public compatibility contracts.
- Require each real-system harness to use isolated database/schema and mission/branch state, bounded readiness checks, `finally` cleanup, and no retry of assertion failures. Share only small mechanical helpers if implementation demonstrates actual duplication.
- Document what is genuinely shared, what remains framework-specific, known partial or unobservable behavior, and why two integrations still do not justify extracting a public adapter abstraction.
- Do not add a third framework, second projector, generalized command bus or exactly-once mechanism, checkpoint/state tooling, dashboard, or production behavior changes unless a failing conformance invariant demonstrates a narrowly required defect correction.

## Capabilities

### New Capabilities

- `cross-framework-conformance-gates`: Defines the shared invariant inventory, framework-owned evidence contract, architecture/security gates, repeatable real-system execution, result vocabulary, CI/release entry points, and boundary documentation for LangGraph and MAF.

### Modified Capabilities

None. Existing LangGraph and MAF capability requirements remain unchanged and continue to define their respective integrations; this change adds repository gates over their accepted behavior rather than redefining either integration.

## Impact

- Framework-owned fixtures, capability matrices, tests, and harness code under `packages/sdk-langgraph` and `packages/sdk-maf` gain static manifest references and real-system readiness where needed.
- API architecture, normalization, governance, security, persistence, and public-output tests under `apps/api-ts` are composed into named invariant gates; production modules change only if a gate exposes a demonstrated defect.
- Root scripts and `.github/workflows/ci.yml` gain documented fast and real-system repository test entry points plus small deterministic summaries.
- Cross-framework documentation builds on `docs/maf-reference-integration.md`, `docs/langgraph-governance-bridge.md`, and the existing boundary assessment without creating a new dashboard or public runtime contract.
