## Context

AgentLens has two accepted framework integrations with deliberately different native models. LangGraph owns callback telemetry, thread/run/interrupt/checkpoint identity, `Command(resume=...)`, and graph/checkpointer execution. MAF 1.10.0 owns workflow/executor/request identity, `request_info`, response submission, and workflow continuation. Both route private normalized facts into the single `span_projection.v1` path and reuse shared interaction, decision, delivery, outcome, authentication, persistence, and Govern UI behavior.

The existing evidence is strong but fragmented. LangGraph has a native-fact fixture corpus and real graph/bridge tests, but `test_governance_integration_harness.py` explicitly mocks AgentLens HTTP and PostgreSQL/Core persistence. MAF has real workflow/OTel fixtures and `run_system_harness.py`, whose manifest identifies real MAF, OTLP, Express HTTP, service authentication, private bridge HTTP, and PostgreSQL while naming the deterministic model client as a double. The cross-framework boundary report in `docs/maf-reference-integration.md` classifies shared code, framework-owned code, legitimate Core corrections, remaining coupling, avoided abstractions, and deferred interface candidates. Current CI runs broad TypeScript and Python jobs but exposes no named conformance layers, real-system service lifecycle, isolated database contract, or retained per-invariant report.

This change turns already-proven boundaries into small repository test and release gates. It is bounded test wiring and documentation work, not a production adapter or generalized test platform. Framework packages remain responsible for interpreting their telemetry and executing their native workflows. One static manifest records invariant identifiers, framework status, limitations, evidence file paths, and explicit commands; no central code imports packages to discover or normalize evidence.

## Goals / Non-Goals

**Goals:**

- Define the smallest shared invariant inventory demonstrated by both integrations.
- Require framework-owned assertions and native oracles for every applicable invariant.
- Report `covered`, `partial`, `not_observable`, or `not_applicable` honestly without treating gaps as equivalent to failures.
- Provide fast fixture/architecture/security gates and minimal repeatable real-system LangGraph/MAF gates with clear repository commands and summaries.
- Require each harness to provide isolated database/schema and mission/branch state, `finally` cleanup, bounded readiness checks, no assertion retry, fixture provenance, and real-versus-double disclosure.
- Detect framework-specific interpretation in generic Core or projection and regressions in state separation, exact authority, correlation, isolation, authentication, feature independence, public safety, and observability.
- Preserve the cross-framework boundary report and explain why no public adapter interface is extracted.

**Non-Goals:**

- Identical telemetry fields, lifecycle names, identity shapes, response APIs, failure behavior, or capability coverage across LangGraph and MAF.
- A public or test-side `RuntimeAdapter`, `GovernanceAdapter`, `TelemetryProfile`, `RuntimeEvidence`, evidence-provider interface, adapter registry, plugin/discovery system, dynamic framework mapping, or package-import protocol.
- A generalized lifecycle utility or report platform.
- A third framework, second projector, generalized command bus, generalized exactly-once delivery, state/checkpoint browser, state editor, or dashboard.
- Production refactoring for test symmetry. Production behavior changes require a reproduced conformance defect and remain narrowly scoped to that defect.
- Turning scheduled/release real-system checks into a substitute for fast package and architecture checks on every change.

## Decisions

### 1. Use a test-only invariant manifest, not a shared framework model

Add one simple repository-owned, test-only manifest whose rows contain an invariant ID and, for each framework, status, limitation where required, evidence file paths, and explicit commands. Status is limited to `covered`, `partial`, `not_observable`, and `not_applicable`. `partial` and `not_observable` entries require a limitation; `not_applicable` requires a native-semantics rationale. Validation checks only manifest shape, referenced paths, and command presence before the explicit commands run.

The manifest never declares native telemetry fields, lifecycle terms, identity keys, fixture facts, response operations, or expected failure shapes. It has no evidence-provider interface, adapter, registry, dynamic mapping, discovery, or package-import protocol. Native evidence remains in the LangGraph and MAF packages and is referenced only by file path and command.

Alternative considered: define one cross-framework telemetry or runtime-evidence schema. Rejected because two integrations have proved boundary principles, not interchangeable native semantics, and such a schema would become a production abstraction by gravity.

### 2. Keep framework-native oracles package-owned

LangGraph continues to use expected native facts generated through the real callback/instrumentor and real graph/bridge execution. MAF continues to use captured real 1.10.0 workflow/OTel facts, its capability matrix, and native request/response execution. The static manifest points directly to their existing tests, fixtures, harness scenarios, and commands. No framework package implements a conformance provider, and no central runner imports translator, bridge, or test-package internals to discover evidence.

Fixture provenance includes generator path, framework and integration version context, native source, primary oracle, capture fingerprint, and declared doubles. Version, generator, provenance metadata, and fingerprint must mechanically match the captured fixture. Fixture or version changes appear as explicit checked-in diffs and validation provides the regeneration command.

Alternative considered: copy selected native fixtures into a shared corpus. Rejected because copies would detach evidence from its owning framework and encourage field-by-field equivalence.

### 3. Establish a bounded shared invariant inventory

The initial inventory covers only demonstrated common boundaries:

1. native identity remains semantically distinct and exact-match authority is framework-owned;
2. generic projection/Core do not interpret framework-native telemetry keys;
3. actionable control requires explicit native interaction evidence;
4. decision, durable claim, delivery acceptance, and runtime outcome remain separate;
5. claim and receipt authority bind to the exact framework, mission, branch, native identity, and authenticated binding;
6. terminal runtime outcome requires explicit request/delivery correlation and is not inferred from later activity or HTTP/claim/acceptance alone;
7. framework, mission, and branch isolation reject cross-scope control;
8. public metadata is bounded, non-executable, and excludes private control/workflow/checkpoint/state data;
9. disabling governance or failing its auth readiness leaves observability operational;
10. framework flags, authentication, bindings, and control references cannot authorize the other framework;
11. captured telemetry meaning is provenance-locked and unknown telemetry does not acquire stronger semantics;
12. each accepted real framework path remains executable with its declared real components and doubles.

An invariant may name separate framework-owned evidence when native behavior differs. Expanding the list requires evidence from both frameworks or an honest non-covered status and review of whether the item is actually shared.

Alternative considered: combine both capability matrices. Rejected because their rows and native sources are intentionally framework-specific.

### 4. Separate fast, system, and policy gate layers

Expose stable root commands for:

- `conformance:fast`: provenance validation, framework fixture/native-oracle suites, API projection/governance/security tests, and architecture boundary checks suitable for ordinary CI;
- `conformance:system:langgraph` and `conformance:system:maf`: framework-specific real-system paths;
- `conformance:system`: both system paths against isolated state;
- `conformance:report`: deterministic aggregation into human-readable and machine-readable reports;
- `conformance:release`: fast plus both real-system gates with retained diagnostics.

The precise script implementation may use existing `pnpm --filter api-ts exec vitest run ...` and `uv run --package ... pytest ...`/harness entry points. These are documented repository test entry points, not public APIs or operator compatibility contracts, and their internal summary shape may evolve with the repository. Fast gates run on pull requests. Real-system gates run where PostgreSQL and service prerequisites are available, at minimum as an explicit release gate; CI configuration must not silently skip them while reporting success.

Alternative considered: put every real-system scenario in the default broad `pnpm test`/`uv run pytest`. Rejected because service startup and database costs obscure fast failures and encourage flaky blanket retries.

### 5. Bring LangGraph to honest real-system parity without uniform native behavior

Add a LangGraph-owned real-system harness that replaces the mocked AgentLens boundary for the primary system gate with real LangGraph graph/checkpointer execution, real adapter/OTLP export, real Express HTTP and service authentication, real private bridge HTTP, and a real PostgreSQL test database. It retains LangGraph-native `Command(resume=...)`, identity, fixture oracle, and failure behavior. Existing mocked tests remain useful for isolated failure injection but cannot be labeled as the real-system gate.

MAF retains its current real-system harness and is hardened to the same operational contract. Both harness manifests use the same component-state vocabulary (`real`, named test double, or not applicable) only for reporting; they do not require the same components. A deterministic model double remains acceptable when explicitly disclosed.

Alternative considered: weaken the MAF gate to match LangGraph's current mock boundary. Rejected because it would discard proven coverage rather than close the readiness gap.

### 6. Keep each real-system harness isolated and minimal

Each framework harness owns its own setup and cleanup. It uses an isolated database/schema plus mission/branch identifiers, waits for database/API readiness with a bounded policy, never retries a failed conformance assertion, and performs run-owned cleanup in `finally` without masking the primary failure. Port and process management remain local to a harness when needed. Small mechanical helpers may be shared only after implementation demonstrates duplication; no generalized lifecycle utility is designed up front.

Each real-system gate is limited to four proofs: one positive observe/govern/native-continuation path, accepted delivery without terminal outcome, one exact-binding or wrong-scope rejection, and public-output non-disclosure. Broader authentication, correlation, isolation, duplicate, failure, and state-transition matrices remain in fast API, persistence, fixture, and architecture tests. Parallel-run conformance testing is deferred unless current CI already runs the gates concurrently or implementation exposes an actual isolation defect.

Alternative considered: build a shared allocator/process/readiness/cleanup/redaction framework. Rejected because two explicit harnesses do not justify a generalized test platform.

### 7. Enforce architecture boundaries with allowlisted ownership checks

Architecture tests inspect generic projection, explanation, shared interaction/delivery services, public protocol exports, route policy wiring, and framework package dependencies. They fail when:

- raw `agentlens.langgraph.*`, MAF `workflow.*`/`executor.*`, or enrichment keys enter generic projection/Core interpretation;
- framework translators or native identity policies move into public protocol or a generic production interface;
- one framework package imports or interprets the other's native code or telemetry;
- route policies stop passing explicit expected-framework and exact native identity rules;
- a registry, discovery mechanism, second projector, or prohibited public adapter/profile/evidence type appears.

Checks use narrow allowlisted generic production boundaries and public exports. Names in tests, documentation, reports, fixture metadata, change artifacts, archived changes, or other historical artifacts do not fail the checks.

Alternative considered: snapshot whole source files. Rejected because formatting and unrelated edits would create noisy gates without strengthening the boundary.

### 8. Emit only a small deterministic summary

Each command emits deterministic terminal output. Each real-system gate also emits one small machine-readable summary containing framework, gate, result, real components and doubles, scenario results, evidence paths, cleanup result, and rerun command. The summary is repository test output, not a public or long-lived schema, report service, aggregation framework, or compatibility contract.

The summary distinguishes real components from doubles and never derives runtime success from test-process success. The combined and release commands may collect the two summaries mechanically but do not introduce a generalized report model.

Alternative considered: define a versioned report schema and aggregator. Rejected because repository test diagnostics do not warrant a report platform.

### 9. Permit production fixes only through demonstrated defects

If a new gate fails because accepted behavior is missing or unsafe, implementation first records a minimal reproducer and classifies ownership. Fixture, harness, or test defects are fixed in test infrastructure. Production code changes are allowed only for a reproduced conformance defect, remain framework-neutral only when both integrations prove that ownership, and require both framework regression gates. No production refactor is performed solely to make harnesses share code.

Alternative considered: preemptively consolidate translators, bridges, or route modules. Rejected because the accepted boundary explicitly keeps them private and native.

## Risks / Trade-offs

- **[Shared manifest becomes a de facto adapter contract]** -> Limit it to invariant IDs, statuses, evidence references, and execution results; prohibit telemetry fields, native operations, and production imports.
- **[Real-system gates become flaky]** -> Isolate run-owned state, health-check dependencies, bound startup retry, avoid scenario retry, and retain readiness/process/database diagnostics.
- **[CI silently omits expensive gates]** -> Publish separate named check status and require it for release; skipped prerequisites produce `not_run`/failure, never a green pass.
- **[Coverage labels overstate evidence]** -> Validate every `covered` row against executable framework-owned evidence and require limitations/rationales for other statuses.
- **[Fixture meaning drifts after dependency changes]** -> Record versions, generators, native sources, fingerprints, and doubles; require explicit regeneration and review.
- **[Architecture grep creates false positives]** -> Scope checks to production ownership boundaries and pair source scans with behavior tests.
- **[Cleanup damages shared developer state]** -> Use unique schemas/databases and identifiers, verify ownership tokens before deletion, and never truncate shared tables.
- **[Test uniformity drives production redesign]** -> Share only orchestration/report utilities where duplication is mechanical; keep framework commands, native oracles, translators, bridges, and identities explicit.

## Migration Plan

1. Inventory current LangGraph and MAF evidence against the bounded invariant list and record honest statuses/limitations.
2. Add provenance and architecture validation plus stable fast commands without changing production behavior.
3. Add the four-scenario LangGraph real-system path and harden the existing MAF path to the same minimal proof and per-harness isolation rules.
4. Add deterministic terminal output, small per-gate summaries, and public-output checks across both paths.
5. Wire fast gates into pull-request CI and both real-system gates into an explicit CI/release job; run the full release command before declaring the change complete.
6. Publish the shared-versus-framework-specific boundary documentation and strict OpenSpec validation.

Rollback removes the conformance runner and CI jobs while leaving both accepted integrations unchanged. Any narrowly justified production defect fix is rolled back independently according to its own compatibility risk; the conformance evidence remains to demonstrate the regression.

## Open Questions

No blocking design questions remain. During implementation, CI runtime measurements determine whether both real-system gates can be required on every pull request or must remain a required release/scheduled gate, but they must always have an explicit runnable command and cannot be silently reported as passed when not executed.
