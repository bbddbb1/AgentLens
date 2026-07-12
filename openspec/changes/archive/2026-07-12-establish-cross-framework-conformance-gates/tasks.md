## 1. Evidence Inventory and Gate Contract

- [x] 1.1 Inventory the accepted LangGraph fixtures, capability matrix, projection/API tests, governance tests, bridge harnesses, security tests, and real/mock boundaries against every shared invariant, recording exact commands and evidence paths.
- [x] 1.2 Inventory the accepted MAF fixtures, capability matrix, projection/API tests, governance tests, `run_system_harness.py` scenarios, security tests, and real/mock boundaries against the same invariants without translating MAF terms into LangGraph terms.
- [x] 1.3 Add one static test-only manifest with invariant IDs and per-framework status, limitation/rationale, evidence file paths, and explicit repository commands, with no provider interface, adapter, registry, dynamic mapping, discovery, or package-import protocol.
- [x] 1.4 Add simple manifest validation that rejects unknown statuses, absent limitations/rationales, duplicate invariant IDs, missing evidence paths, and missing commands.

## 2. Framework-Owned Evidence and Provenance

- [x] 2.1 Populate the static manifest with direct LangGraph native-fact fixture, package/API test, real-graph scenario, limitation, and command references while retaining LangGraph identity and lifecycle terminology.
- [x] 2.2 Populate the static manifest with direct MAF 1.10.0 fixture, capability-row, package/API test, real-system scenario, limitation, and command references while retaining workflow/executor/request terminology.
- [x] 2.3 Extend both fixture manifests with generator, framework/integration version context, native evidence source, primary oracle, deterministic fingerprint, and explicit real-component/test-double provenance.
- [x] 2.4 Add mechanical provenance tests that require version, generator, native source, metadata, declared doubles, and fingerprint to match each captured fixture and provide the exact regeneration command on mismatch.
- [x] 2.5 Verify fixture or version changes appear as explicit checked-in fixture/provenance/fingerprint diffs and that unknown telemetry, incomplete identity, failure, non-causal/later activity, explicit interaction, and correlated continuation retain their native meaning.

## 3. Architecture and Production Boundary Gates

- [x] 3.1 Extend focused API architecture tests proving generic projection, explanation, and shared Core services do not inspect LangGraph or MAF native telemetry keys and continue to emit only `span_projection.v1`.
- [x] 3.2 Add ownership checks proving each framework keeps its private translator, bridge, native identity policy, fixture oracle, and route policy and neither framework package imports or interprets the other.
- [x] 3.3 Add checks that explicit route modules still pass expected-framework, required-native-key, and consistency-key policies directly to the private matcher and that exact binding scope is not weakened.
- [x] 3.4 Add prohibited-abstraction checks for public `RuntimeAdapter`, `GovernanceAdapter`, `TelemetryProfile`, `RuntimeEvidence`, adapter/profile/policy registries, discovery or plugin mechanisms, second projectors, and generalized command buses, scoped narrowly to generic production boundaries and public exports and excluding tests, docs, reports, fixtures, and historical artifacts.
- [x] 3.5 Document any architecture failure as a concrete conformance defect before changing production code; keep any required fix minimal and run both framework regression suites without otherwise consolidating production modules.

## 4. Shared Governance, Isolation, and Outcome Gates

- [x] 4.1 Compose framework-owned tests proving only explicit LangGraph interrupt or MAF `request_info` evidence creates actionable control and that checkpoints, nesting, overlap, later activity, and unknown telemetry do not.
- [x] 4.2 Add cross-framework state-axis coverage for observation, decision, durable one-time claim, delivery acceptance, and runtime outcome, including accepted-without-terminal-evidence and runtime-failure-after-acceptance cases.
- [x] 4.3 Add exact claim and receipt authority cases for wrong framework, mission, branch, native identity, binding/control reference, binding generation, expired lease, and authenticated-but-nonmatching bindings without state mutation.
- [x] 4.4 Add explicit request-and-delivery correlation cases for success/failure and negative cases for HTTP success, claim, accepted receipt, checkpoint creation, shared workflow/thread identity, and unrelated later activity.
- [x] 4.5 Add fast cross-scope tests proving framework, mission, branch, decision, binding, delivery, and outcome isolation for both frameworks; add parallel-run conformance only if current CI is concurrent or implementation reproduces an isolation defect.

## 5. Authentication, Feature Independence, and Public Safety

- [x] 5.1 Add a framework flag/authentication matrix proving disabled or auth-unready governance remains non-actionable while observability works and that enabling/authenticating either framework does not affect the other.
- [x] 5.2 Add cross-framework control rejection cases proving a LangGraph flag, credential, binding, or control reference cannot enable, authenticate, claim, acknowledge, or control MAF and vice versa.
- [x] 5.3 Run shared public-output scans over interactions, realtime payloads, replay, graph, explanation, audit, UI fixtures, harness logs, and reports for both frameworks.
- [x] 5.4 Verify public and diagnostic output excludes raw or recoverable control references, credentials, workflow/graph objects, queues, checkpoints/state, secrets, and sensitive response values while retaining bounded native identity metadata and actionable redacted failures.

## 6. LangGraph Real-System Gate

- [x] 6.1 Add a LangGraph-owned real-system harness manifest distinguishing real graph/checkpointer execution, callback/OTLP path, Express HTTP, service authentication, private bridge HTTP, PostgreSQL persistence, and every test double.
- [x] 6.2 Replace the mocked AgentLens boundary for the primary LangGraph system gate with a real API process, real database initialization, real authenticated binding registration/claim/receipt HTTP, real telemetry ingestion, and real public reads while preserving mock tests for isolated failure injection.
- [x] 6.3 Exercise a real explicit interrupt and native `Command(resume=...)` path from telemetry observation through decision, durable claim, accepted delivery, correlated terminal evidence, persistence, and public projection.
- [x] 6.4 Limit the LangGraph real-system gate to accepted delivery without terminal outcome, one exact-binding or wrong-scope rejection, and public-output non-disclosure alongside the positive path; keep broader negative cases in fast tests.
- [x] 6.5 Verify LangGraph native identity, checkpoint ownership, graph behavior, failure behavior, and expected-native-fact oracle remain package-owned and unchanged by the system harness.

## 7. MAF Real-System Gate Hardening

- [x] 7.1 Audit `packages/sdk-maf/tests/run_system_harness.py` against the lifecycle contract and retain real MAF 1.10.0 workflow/Agent/Tool, OTel/OTLP, Express HTTP/authentication, bridge HTTP, and PostgreSQL assertions plus its declared deterministic model double.
- [x] 7.2 Make the selected MAF system scenarios use isolated database/schema and mission/branch state, deterministic identifiers where required by native assertions, and no dependence on prior scenario rows.
- [x] 7.3 Add bounded database/API readiness handling and deterministic run-owned cleanup without retrying conformance assertion failures.
- [x] 7.4 Limit the MAF real-system gate to one positive continuation, accepted delivery without terminal outcome, one exact-binding or wrong-scope rejection, and public-output non-disclosure; retain its broader negative matrix as fast package/API/persistence/fixture coverage.
- [x] 7.5 Verify hardening does not alter MAF telemetry meaning, native response APIs, fixture oracle, private bridge execution, or exact 1.10.0 identity policy.

## 8. Per-Harness Lifecycle and Small Summaries

- [x] 8.1 Implement isolated database/schema and mission/branch state directly in each harness, keeping port and process handling harness-local; share only a small mechanical helper if duplicated implementation demonstrates a need.
- [x] 8.2 Implement bounded PostgreSQL/API readiness checks independently in each harness and never retry a conformance assertion failure.
- [x] 8.3 Implement `finally` cleanup of each harness's run-owned resources and preserve both primary and cleanup results in terminal output.
- [x] 8.4 Defer parallel-run conformance tests unless CI already runs the gates concurrently or implementation reproduces an isolation defect.
- [x] 8.5 Add deterministic terminal output and one small machine-readable summary per real-system gate containing framework, gate, result, real components/doubles, four scenario results, evidence paths, cleanup result, and rerun command.
- [x] 8.6 Verify summaries contain no private output and are repository test diagnostics only, with no versioned schema, aggregation framework, report service, or inferred runtime outcome.

## 9. Stable Commands and CI/Release Wiring

- [x] 9.1 Add documented repository root commands for `conformance:fast`, `conformance:system:langgraph`, `conformance:system:maf`, `conformance:system`, `conformance:report`, and `conformance:release` using `uv` for Python and focused `pnpm --filter api-ts exec vitest run ...` commands for API tests; do not promise public or operator compatibility.
- [x] 9.2 Wire the fast fixture, provenance, architecture, governance, isolation, authentication, and public-output gates into pull-request CI with invariant-specific failure output.
- [x] 9.3 Add an explicit PostgreSQL-backed real-system CI/release job for both frameworks, retain reports/logs, and ensure missing prerequisites or skipped execution cannot publish a passing result.
- [x] 9.4 Measure real-system duration and document whether the combined gate is required per pull request or as a required release/scheduled check without changing the stable local commands.
- [x] 9.5 Add smoke tests for every root command and verify deterministic terminal failures and small summaries include framework, gate, evidence location, component/double boundary, cleanup result where applicable, and an exact rerun command.

## 10. Documentation and Final Validation

- [x] 10.1 Publish cross-framework conformance documentation listing the static manifest, bounded shared invariants, per-framework statuses/evidence/limitations, repository commands, CI layers, fixture provenance rules, minimal system scenarios, and real-versus-double manifests.
- [x] 10.2 Update the code-grounded boundary report with the new test-only orchestration classification, retained framework-specific ownership, any demonstrated Core defect corrections, remaining coupling, avoided abstractions, and deferred candidates.
- [x] 10.3 Explicitly document why similar harness/summary shapes do not justify an evidence provider, generalized lifecycle/report platform, public adapter interface, runtime evidence/profile, registry, discovery mechanism, third framework, second projector, or production platform expansion.
- [x] 10.4 Run focused LangGraph and MAF package suites, API architecture/governance/projection/security suites, web Govern compatibility tests, both real-system gates, report validation, and the full `conformance:release` command.
- [x] 10.5 Run relevant builds and lint/type checks, then run `openspec validate establish-cross-framework-conformance-gates --type change --strict --json` and resolve only issues within this change's conformance scope.
