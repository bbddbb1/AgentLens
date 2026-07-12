# Cross-framework conformance gates

This repository uses one static, test-only invariant manifest at
`tests/conformance/manifest.json`. It records bounded AgentLens invariants,
honest per-framework status (`covered`, `partial`, `not_observable`, or
`not_applicable`), framework-owned evidence paths, limitations, and exact
repository commands. It is not a provider interface, adapter model, registry,
discovery mechanism, or production compatibility contract.

## What is shared

The gates cover native identity separation, the single `span_projection.v1`
boundary, explicit interaction evidence, separate observation/decision/claim/
delivery/outcome state axes, exact binding authority, request-and-delivery
correlation, framework/mission/branch isolation, bounded public output,
independent governance availability, fixture provenance, and repeatable system
execution. Similar invariant names do not require equivalent telemetry fields,
lifecycle names, identities, response APIs, or failure semantics.

## What stays framework-owned

LangGraph owns callback telemetry, thread/run/interrupt/checkpoint identity,
native `Command(resume=...)`, graph/checkpointer execution, and its native-fact
oracle. MAF 1.10.0 owns workflow/executor/request identity, native
`request_info`, response submission, workflow continuation, and its captured
OTel/native-fact oracle. Their translators, bridges, route policies, fixtures,
identity rules, and failure behavior remain in their respective packages.

Fixture manifests record the generator, framework/integration version context,
native evidence source, primary oracle, deterministic fingerprint, declared
doubles, and regeneration command. A mismatch is a checked-in fixture and
provenance diff, not an implicit update.

## Commands

These are repository test entry points, not public or operator compatibility
contracts:

- `pnpm conformance:fast` runs manifest/provenance, framework fixture/native
  oracle, API architecture/governance/security, and web Govern compatibility
  gates.
- `pnpm conformance:system:langgraph` runs the real LangGraph graph/checkpointer,
  callback/OTLP, authenticated Express API, private bridge HTTP, and
  PostgreSQL-backed path. It has no deliberate test double.
- `pnpm conformance:system:maf` runs the real MAF 1.10.0 workflow/OTel,
  authenticated Express API, private bridge HTTP, and PostgreSQL-backed path;
  `DeterministicModelClient` is explicitly disclosed as the only double.
- `pnpm conformance:system` runs the two system gates serially.
- `pnpm conformance:report` validates and prints the two small repository-local
  summaries under `artifacts/conformance/`.
- `pnpm conformance:release` runs fast gates, both system gates, and report
  validation.

The system harnesses run four minimal scenarios: positive native continuation,
accepted delivery without terminal evidence, exact-binding/wrong-scope
rejection, and public-output non-disclosure. They allocate unique mission
identifiers and isolated branch scope within each mission, retry only bounded
readiness probes, never retry an assertion, and delete only their run-owned
mission in cleanup. A failed or skipped prerequisite cannot be reported as a
passing system gate.

## CI layers and boundary decision

Pull-request CI runs the fast layer. The PostgreSQL-backed system gates run in
an explicit system/release job when those services and authentication are
provisioned; retained summaries and logs identify the exact rerun command and
real-versus-double boundary. Parallel-run conformance remains deferred because
the current gate commands are serial and no isolation defect requires it.

The reference local run on 2026-07-12 completed the LangGraph system gate in
about 5.5 seconds and the MAF system gate in about 4.7 seconds with the local
API and PostgreSQL service already ready. Because startup and external service
readiness are environment-dependent, fast gates remain required for pull
requests while the combined PostgreSQL-backed system gate is an explicit
release/CI check using the same stable local commands.

Two integrations justify a test-only manifest and small harness-local output,
not an evidence provider, generalized lifecycle/report platform, public
adapter interface, runtime evidence/profile, registry, discovery mechanism,
third framework, second projector, or production platform expansion. Similar
harness shapes are orchestration similarity; they do not establish equivalent
native meaning.
