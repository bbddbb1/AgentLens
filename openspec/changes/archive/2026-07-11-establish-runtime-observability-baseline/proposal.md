## Why

AgentLens currently persists raw OTLP spans and explicit control records but exposes replay events, graph snapshots, runtime explanations, and audit claims through projections whose authority boundaries are inconsistently documented and incompletely protected. Before adding new runtime-evidence abstractions or framework adapters, the existing span-driven pipeline needs a verified, test-backed baseline so future implementations can be compared without preserving accidental behavior or overstating guarantees.

## What Changes

- Document the implemented authority model: spans, span events, interrupts, and replay branches are durable evidence, while `EventEnvelope`-shaped replay events, graph snapshots, runtime summaries, and runtime explanations are server-side derived projections.
- Add characterization coverage for agent, parent-child, tool success/failure, interrupt, and supported handoff/delegation semantics, including strict no-fabricated-edge and no-failure-as-success rules.
- Treat every valid HTTP `2xx` response, including the API's current `202` responses, as a successful Python OTLP export while preserving `4xx`, `5xx`, and transport failures as failures.
- Add one shared `replay.updated` realtime notification with one best-effort publication attempt after durable ingest succeeds; publication failure does not change the committed ingest response, and a delivered notification causes the Web client to reload replay-derived state without implying that a graph snapshot was persisted.
- Add a minimal explicit version to the authoritative replay/graph projection response so the current span-based projection can later be compared with another projection implementation.
- Replace unconditional cryptographic-validity claims with an honest unsupported or not-verified integrity state; this change does not add hashes, signing, or a durable event ledger.
- Correct only documentation and code comments that directly contradict the verified implementation; preserve the current architecture and public behavior otherwise.

## Capabilities

### New Capabilities

- `span-runtime-projection`: Defines the durable-evidence versus derived-projection authority boundary, deterministic span-to-replay/graph semantics, and explicit projection versioning.
- `otlp-export-reliability`: Defines server/client success and failure behavior for OTLP HTTP export across the full `2xx`, `4xx`, `5xx`, and transport-error classes.
- `replay-update-notification`: Defines the canonical post-ingest realtime signal and Web-client replay reload behavior.
- `runtime-integrity-reporting`: Defines truthful audit and integrity responses when cryptographic verification is not implemented.

### Modified Capabilities

None. The repository has no existing OpenSpec capability specs to modify.

## Impact

- API and projection code in `apps/api-ts/src/routes/missions.ts`, `apps/api-ts/src/services/missionStore.ts`, `apps/api-ts/src/services/runtime/projection.ts`, and `apps/api-ts/src/realtime/`.
- Shared response and realtime protocol types in `packages/protocol/src/types.ts` and related schemas/exports.
- Python exporter behavior and tests in `packages/sdk-core/agentlens_sdk/exporter.py` and `packages/sdk-core/tests/test_exporter.py`.
- WebSocket consumption and replay reload behavior in `apps/web/src/app/missions/[id]/page.tsx`, with focused Web tests.
- Characterization and route coverage in `apps/api-ts/tests/unit/projection.test.ts`, `apps/api-ts/tests/unit/routes.test.ts`, and adjacent contract tests.
- Contradictory authority/integrity documentation, especially `docs/explanation/architecture.md`, `docs/explanation/background.md`, `docs/reference/agent-api.md`, and directly affected protocol comments.
- No new database, framework adapter, infrastructure dependency, schema registry, event-sourcing layer, or UI redesign.
