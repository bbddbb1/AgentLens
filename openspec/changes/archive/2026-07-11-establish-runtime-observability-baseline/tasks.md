## 1. Shared Runtime Contracts

- [x] 1.1 Add the shared `span_projection.v1` constant/type and expose it additively on replay, current-graph, and graph-snapshots response contracts.
- [x] 1.2 Add a shared typed `replay.updated` mission realtime message carrying `mission_id` and `branch_id`, and use it at the API/Web boundary.
- [x] 1.3 Widen shared audit integrity contracts to represent verified-valid, verified-invalid, and unsupported/not-verified states with an explanatory reason.

## 2. Span-to-Projection Characterization

- [x] 2.1 Add focused `projectReplay()`/`projectTraceSnapshot()` tests for a single agent lifecycle, parent-child spans, and tool success and failure.
- [x] 2.2 Add projection tests for explicit interrupts, supported handoff/delegation, missing or unresolved relationship targets, and timing overlap without causal evidence.
- [x] 2.3 Tighten projection logic only where characterization exposes fabricated/dangling edges or explicit failures represented as success, preserving deterministic evidence-backed behavior.
- [x] 2.4 Add API contract tests proving replay and graph responses expose `span_projection.v1` while retaining existing response fields.

## 3. OTLP Export Success Semantics

- [x] 3.1 Extend Python exporter tests to cover HTTP `200`, `202`, representative `400` and `500`, and request exception/timeout outcomes.
- [x] 3.2 Update `AgentLensOtlpJsonExporter.export()` to accept every HTTP `2xx` response and keep all non-`2xx` and transport errors as failures.
- [x] 3.3 Add ingest route tests that lock successful `/api/v1/ingest/otlp` and `/v1/traces` responses to HTTP `202` and preserve validation failures.

## 4. Canonical Replay Update Notification

- [x] 4.1 Extend `MissionStore.ingestSpans()` results and tests to return the request's single resolved mission/branch identifiers and expose the existing duplicate-`batch_id` no-op outcome without adding generalized idempotency or content comparison.
- [x] 4.2 Make one best-effort branch-scoped `replay.updated` publication attempt with the resolved identifiers after each evidence-changing commit, contain realtime transport failures, and prove validation, persistence failure, and existing duplicate-batch no-op paths make no attempt.
- [x] 4.3 Verify the existing realtime manager provides normal best-effort transport for the shared `replay.updated` message without claiming exactly-once delivery or changing interrupt, sandbox, summary, or explanation event meanings.
- [x] 4.4 Update the Web mission page to reload the matching branch when `replay.updated` is delivered, remove the ingest-refresh dependency on `graph.snapshot.created`, and add focused message-handling tests including other-branch and existing-event cases.

## 5. Truthful Integrity Reporting

- [x] 5.1 Change `getAuditEvents()` and `verifyMissionIntegrity()` to return unsupported/not-verified results for populated and empty streams, with unit and route coverage.
- [x] 5.2 Update audit-store fallbacks and the Web Audit surface to render a neutral unsupported/not-verified state without synthesizing validity or claiming cryptographic proof, and add Web tests.
- [x] 5.3 Confirm the integrity changes add no hash generation, signatures, durable `EventEnvelope` ledger, or new persistence tables.

## 6. Authority Documentation

- [x] 6.1 Correct present-tense persistence and replay claims in `docs/explanation/architecture.md` and `docs/explanation/background.md` to describe spans/control records as durable evidence and replay/graph outputs as derived.
- [x] 6.2 Correct directly contradictory claims in `docs/reference/agent-api.md`, `docs/reference/rops.md`, and relevant `packages/protocol/src/types.ts` comments without rewriting aspirational roadmap material.
- [x] 6.3 Review changed documentation against `apps/api-ts/src/db/postgres.ts`, `MissionStore.getReplayFromTelemetry()`, and `projectReplay()` so every authority statement is traceable to current code.

## 7. Verification

- [x] 7.1 Run focused API projection, route, audit, and realtime tests and resolve regressions within this change's scope.
- [x] 7.2 Run the Python SDK exporter test suite and relevant package lint/type checks.
- [x] 7.3 Run Web unit tests and TypeScript checks for replay reload and integrity presentation, then record any unrelated pre-existing failures separately.
- [x] 7.4 Validate the completed OpenSpec change and confirm no `RuntimeEvidence`, `TelemetryProfile`, adapter, ledger, hash-chain, infrastructure, or broad UI work entered the implementation.
