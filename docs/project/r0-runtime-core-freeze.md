# AgentLens R0 Runtime Core Freeze

## 1. Verdict

`R0_REFROZEN`

The first R0 freeze declaration was invalidated by an adversarial post-freeze
audit. The audit reproduced under-scoped evidence/activity identity,
autocommit frame reconstruction, lossy branch Governance copying, non-unique
control authority, unadmitted expiry mutation, decision/continuation
conflation, and executable credentials in telemetry. Those were correctness
defects in the claimed frozen boundary, not new product requirements.

The repaired universal Runtime Core is refrozen at the repository state
containing the original R0 commits plus:

- `98568cd` — immutable evidence/frame membership;
- `21ceb12` — canonical Runtime meaning;
- `c9520c9` — downstream surface convergence;
- `d4782fd` — field-level evidence provenance;
- `cb640a3` — evidence-bounded causal presentation;
- `04fd784` — independent Governance state authority;
- `f91efdf` — fail-closed control authority;
- `a8820e4` — trace-scoped evidence and collision-safe activity identity;
- `1a51048` — transactional frame and exact branch reconstruction;
- `ab944c0` — unique control authority and credential isolation;
- `43db169` — duplicate binding registration rejection;
- the adversarial contract/proof commit that contains this revision.

The machine-backed inventory is
[`contracts/runtime-core.freeze.json`](../../contracts/runtime-core.freeze.json). The
small cross-framework semantic corpus is
[`contracts/runtime-core.semantic-goldens.json`](../../contracts/runtime-core.semantic-goldens.json).

## 2. Frozen contracts

### L0 evidence and frames

- Source timestamps are exact decimal nanoseconds through ingest, persistence,
  read, chronology, and duration logic.
- Evidence admission is a mission-local immutable PostgreSQL `INTEGER` cursor.
- Corrections append revisions within the exact
  `(mission, branch, trace, span)` source scope. Reuse of a span id in another
  trace is independent evidence, not a correction.
- A selected frame sees the latest revision admitted at or before its cutoff.
- Branch, span, and Governance inputs are read in one PostgreSQL
  `REPEATABLE READ READ ONLY` transaction.
- A frame is the exact tuple of mission, branch, admission sequence, as-of
  timestamp, and projection version.
- A child branch inherits the immutable parent prefix selected at fork time.
- Evidence references preserve event/admission identity and field-level
  recorded, derived, or unknown provenance.

### L1 Runtime meaning

- Invocation-first activity identity and the documented unambiguous fallback.
  Explicit invocation ids remain source-local: unambiguous established ids are
  preserved, while collisions across trace/branch scopes are deterministically
  qualified rather than merged.
- Existing activity kinds only: agent, workflow, tool, LLM, retrieval, memory,
  artifact, human, and checkpoint.
- Activity lifecycle, activity outcome, run status/outcome, and Runtime phase.
- Only explicitly supported relationship bases: explicit link, trigger
  reference, decision reference, and parent span. Parentage, adjacency,
  chronology, and overlap do not establish causality. Parallel grouping
  requires explicit evidence.
- Consistency diagnostics, field evidence conditions, and provenance basis.

### Governance authority

- Request lifecycle, decision state, delivery state, and Runtime outcome are
  independent axes.
- Decision recording and delivery acceptance never establish Runtime
  continuation. Only canonical Runtime evidence does.
- Mutation requires a current, explicit, unambiguous, actionable binding.
- Known-disabled, missing, conflicting, stale, expired, resolved, historical,
  and unsupported control states fail closed.
- Legacy-token mutation is available only to records explicitly persisted with
  that compatibility mode.
- Non-null legacy-token hashes are globally unique. Ambiguous historical
  duplicates are all invalidated rather than resolved by row order.
- Framework binding registration is serialized on its DB control identity and
  protected by partial unique indexes. Exactly one active authority can exist.
- Expiry removes actionability but does not mutate request lifecycle without an
  admitted transition.
- A generic `resume` decision records only decision state. Only the dedicated
  legacy-token endpoint retains the explicit compatibility continuation.
- Executable tokens/control references are control-plane inputs, never
  recorded telemetry or public/runtime evidence.

## 3. Semantic authority maps

```text
L0 immutable span/control evidence at one frame
  -> private framework normalization
  -> workload-neutral canonical facts
  -> RuntimeExplanation v1
  -> Summary / Graph / Timeline / Inspector / product narrative
```

Framework adapters own native vocabulary translation. The internal universal
projector owns activity identity, lifecycle, outcome, relationships,
diagnostics, and evidence basis. Downstream views are derivatives and may not
parse framework vocabulary to change that meaning.

```text
request evidence -> request lifecycle
operator action  -> decision state
bridge receipt   -> delivery state
Runtime evidence -> Runtime outcome
```

Each arrow has its own append-only admission history. No arrow implies a later
one.

## 4. Known limitations

- Sparse adapters can truthfully produce partial or unknown meaning.
- Native framework IDs and metadata are provenance/extensions, not universal
  identity.
- Runtime completion is not task verification, Assurance, or business success.
- RuntimeSummary remains a transitional derivative compatibility surface. It
  is not a second Runtime semantic authority.
- The repository-wide Python Ruff baseline currently reports 491 pre-existing
  style/modernization findings. The TypeScript lint/typecheck, builds, Runtime
  correctness suites, PostgreSQL acceptance, and authenticated local system
  gates pass. Ruff debt is release hygiene outside the frozen semantic
  boundary; it was not suppressed or reclassified as a passing gate.
- Three non-conformance MAF unit files can stall during process shutdown under
  the installed MAF 1.10.0 stack. The bounded MAF conformance corpus and every
  real system scenario complete and pass. The stalled broad package run is not
  treated as proof.
- Identity can only be as exact as recorded scope. If a source reuses both
  trace and invocation identifiers inside one mission/branch without another
  explicit execution identifier, AgentLens reports the recorded identity; it
  does not invent one from timing or order.

## 5. Legacy compatibility boundary

Pre-R0-A rows are migrated deterministically, but their historical
immutability cannot be recreated retroactively. Frames admitted after the
R0-A migration have immutable admission/revision membership.

Repository evidence shows RuntimeExplanation was introduced after the only
recorded `0.1.0` release, all current consumers are in-repository or first-party
safety harnesses, and the protocol packages are private. Therefore the
post-R0 contract is the first stable `runtime_explanation.v1` baseline; earlier
uses of the literal are experimental, not a supported predecessor wire
contract. No speculative v2 compatibility layer is created. Discovery of a
previously supported external v1 deployment would require an explicit
compatibility review rather than silent reinterpretation.

The refreeze migration preserves every admission cursor. It reranks former
cross-trace revision chains inside their correct trace partitions, removes
provably synthetic child Governance rows, recursively removes plaintext
control credentials from historical JSON, invalidates every member of an
ambiguous legacy-token set, and revokes every member of an ambiguous active
binding set. A fresh unambiguous binding is required after revocation.

## 6. Deferred concepts

Problems, Reliability Visibility, Deterministic Assurance, semantic completion
evaluation, A2A product semantics, retry/message/fan-out/join ontology,
execution replay, generalized control protocols, policy DSLs, auto-remediation,
future adapters, and scale/data-plane work remain outside R0.

### Future-pressure falsification

| Pressure case | Frozen-Core disposition |
|---|---|
| Third framework with different native IDs | Preserve native IDs as extension/provenance and translate only supported neutral facts. |
| Several invocations in one span | Use explicit invocation identity; report ambiguity rather than invent order-based identity. |
| Sparse telemetry | Preserve partial/unknown meaning. |
| Late or corrected telemetry | Admit it to a later immutable frame/revision; never rewrite the earlier frame. |
| Opaque remote/A2A peer | Keep opaque or model in a future L2 lens; do not infer universal activity meaning. |
| Assurance later disagrees with Runtime completion | Keep Assurance separate; Runtime completion is not task verification. |
| Distributed source clocks disagree | Preserve exact source chronology and use admission, not source time, for frame membership. |
| Explicit handoff exists in only one framework | Record only the explicitly supported relation; absence remains unknown. |
| Governance action is observable but has no valid binding | Report unavailable and reject mutation. |

None of these cases requires a new activity kind, relationship kind, lifecycle,
outcome, evidence, frame, or Governance concept.

## 7. Architecture guards

- Strict Zod schemas validate RuntimeExplanation v1, its frame tuple,
  provenance/evidence, query, realtime envelope, and Governance axes.
- REST and realtime publication share one validated serializer. The web REST
  and WebSocket paths share one decoder and reject wrong mission, branch,
  version, or frame before state mutation.
- Semantic goldens pin generic, LangGraph, and MAF lifecycle/outcome meaning.
- AST-backed guards prohibit framework-private vocabulary in universal and
  downstream semantic modules and keep projector implementations on the
  explicit internal package subpath.
- Contract guards reject overlap/chronology/generic dependency as causal or
  parallel authority.
- PostgreSQL frame/history/branch and Governance corpora enforce immutable
  cutoffs and fail-closed mutation.
- `pnpm conformance:r0-refreeze` is the aggregate adversarial guard. It exits
  non-zero when real PostgreSQL configuration is absent, runs the lock-barrier
  frame race, identity collisions, migration ambiguity, branch collisions,
  credential scans, Governance authority corpus, semantic/contract/provenance/
  causal guards, and fast cross-framework conformance.
- CI now targets the repository's actual default branch (`master`) and runs
  both the mandatory adversarial PostgreSQL gate and authenticated release gate.

### Documentation convergence audit

| Surface | Baseline classification | R0-D disposition |
|---|---|---|
| Constitution | MATCH | Preserved without weakening. |
| Runtime plan/spec/tasks | STALE | Aligned to the implemented R0 boundary and executable contract. |
| Runtime data model | CONTRADICTORY | Marked non-normative where historical proposed shapes differ from v1. |
| Root/API/web READMEs | UNDERDOCUMENTED | Updated to the span/control authority and validated RuntimeExplanation path. |
| Architecture explanation | CONTRADICTORY | Current authority separated from historical target-state ledger text. |
| Semconv reference | OVERCLAIM | Removed the unsupported claim that the entire reference was already frozen. |
| Old roadmap | STALE | Marked superseded by the post-R0 direction. |
| Conformance and adapter capability matrices | MATCH | Retained as test/capability evidence, not a public semantic registry. |

## 8. Validation evidence

The freeze checkout produced these results:

- `pnpm lint`: passed.
- `pnpm build`: passed, including protocol, API, and production web build.
- `pnpm test`: API 436 passed / 8 PostgreSQL tests skipped in the generic run;
  web 195 passed.
- `pnpm conformance:r0-refreeze`, with both PostgreSQL URLs configured: 8 API
  files / 113 tests passed, followed by the complete fast conformance corpus.
  The required integration file contributed 8 real PostgreSQL tests; none
  skipped. The same 8 tests also passed from a fresh empty PostgreSQL 16
  database, proving migration and clean-install behavior.
- The negative environment probe exited 2 when PostgreSQL configuration was
  absent, proving the aggregate gate cannot turn `NOT RUN` into `PASSED`.
- `pnpm conformance:release`: passed.
  - manifest: 8 passed;
  - LangGraph fast corpus: 37 passed;
  - MAF fast corpus: 14 passed;
  - API conformance: 36 passed;
  - web conformance: 20 passed;
  - LangGraph system: positive, accepted-without-terminal, wrong-scope, and
    public-output scenarios all passed with cleanup passed;
  - MAF system: the same four scenarios all passed with cleanup passed.
- Focused SDK credential-boundary tests:
  `uv run pytest packages/sdk-core/tests/test_agent.py packages/otel-semconv/tests/test_attributes.py -q`
  passed 41 tests.

The real system gates used the built Express API, service authentication,
real OTLP/HTTP, real LangGraph/MAF runtimes, private bridge HTTP, and an
isolated PostgreSQL 16 container. MAF retains only its declared deterministic
model client double; the LangGraph gate has no declared double.

## 9. Verification debt

None of the previously unavailable correctness gates remains unavailable in
this environment. PostgreSQL, authenticated LangGraph, and authenticated MAF
system proofs all ran. The Ruff failures and broad MAF shutdown stall are known
tooling/test-hygiene limitations, not unavailable evidence and not hidden as
verification debt. They do not conceal a known Runtime semantic defect because
the affected R0 paths are exercised by the passing bounded and real-system
corpora.

## 10. Future extension rule

> A future adapter succeeds when it can translate into the frozen Runtime Core
> without changing universal activity identity, lifecycle, outcome,
> relationship, evidence, frame, or Governance authority semantics.

When an integration needs more information, prefer a framework extension, an
L2 lens, or partial/unknown capability before changing Core. A change to the
frozen concepts requires an explicit successor-contract and migration review.

## 11. Final challenge

Yes. AgentLens can stop redesigning its universal Runtime Core and build
Reliability Visibility, Deterministic Assurance, A2A cross-runtime workloads,
Problems, and Verified Governance on top of it. Those products may add L2
judgment and capability, but they must not reinterpret Runtime completion as
verification, delivery as continuation, correlation as causation, or
observation as mutation authority.
