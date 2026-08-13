# Implementation Plan: Coherent Runtime Execution Story

**Branch**: `master` | **Date**: 2026-06-30 | **Spec**: `/specs/001-runtime-execution-story/spec.md`

**Input**: Feature specification from `/specs/001-runtime-execution-story/spec.md`

## Summary

Unify the Run UI around one evidence-backed runtime frame so summary, graph, timeline, and inspector all describe the same execution moment, authoritative run status, authoritative workload-neutral runtime phase and basis, and one authoritative activity context that is either a clearly disclosed frame overview or exactly one authoritative selected activity. When the UI chooses a default selected activity, it must disclose the selection basis; when it does not, it must preserve the truthful frame-overview state and clear any stale prior selection. The implementation should extend the shared `RuntimeExplanationProjection` and `RuntimeSummary` pipeline in `packages/protocol`, tighten frame-aware API delivery in `apps/api-ts`, and align the `apps/web` selection/state flow so every surface consumes the same `{ mission_id, branch_id, sequence_num, as_of_timestamp, projection_version }` frame identity, deterministic story-selection rules, subordinate progress-marker rules, explicit terminal-status semantics that do not depend on displayable I/O, evidence-backed fan-out and convergence rules, and one deterministic operator-facing activity record for every authoritative selected activity and every activity promoted as story-critical, without introducing BSOps-specific core concepts or AI-generated core summaries.

## R0 Closure Amendment (2026-08-13)

This amendment supersedes older plan language where it conflicts with the
implemented R0 boundary. L0 authority is the span-backed PostgreSQL evidence
store plus append-only Governance history, immutable admission cursors,
revision selection, and branch cutoffs. `EventEnvelope` is a derived replay
compatibility shape, not a separately persisted authoritative ledger.

Framework vocabulary is translated once by private API normalizers. The
workload-neutral L1 projector owns activity identity, lifecycle, outcome,
supported explicit relations, diagnostics, and provenance. Story selection,
ranking, narrative, and causal wording are L2 presentation and are not frozen
L1 facts. The executable frozen boundary and validation evidence are recorded
in `contracts/runtime-core.freeze.json` and
`docs/project/r0-runtime-core-freeze.md`.

## Plan Delta: Node Information Sufficiency

This delta adds one focused requirement to the existing plan: every selected activity and every story-critical activity must become an operator-readable execution unit through one shared, deterministic, evidence-backed operator-facing activity record delivered from L1 projection through API transport into summary, graph, timeline, and inspector.

- **Shared operator-facing activity record**: Extend the existing projection and summary contracts so each authoritative selected activity and each story-critical activity carries the same operator-facing activity record for `actor`, `action`, `target`, `status_or_outcome`, `trigger`, `input`, `output`, `downstream_effect`, `artifacts`, and `evidence_condition`, plus field-level evidence-value conditions for any unavailable value.
- **Explicit missing-information disclosure**: Every field in that record remains present even when its value cannot be shown. The record must explicitly disclose `not_recorded`, `unavailable`, `redacted`, `encrypted`, `permission_denied`, `oversized`, `absent`, `recorded_empty`, or `inconsistent` rather than silently omitting the field.
- **Story-critical gating**: Summary and graph promotion logic must treat sufficiency as deterministic L1 metadata. An activity lacking enough recorded `actor`, `action`, `target`, or `status_or_outcome` evidence must not be promoted as strongly story-critical unless the promotion itself exposes the incompleteness limitation.
- **Projection boundary**: Sufficiency stays inside workload-neutral, evidence-backed activity metadata derived from recorded telemetry. The plan adds no new semantic layer, no hidden-intent inference, no domain diagnosis, and no BSOps-specific ontology.
- **Single-source delivery**: Summary, graph, timeline, inspector, and current-event must consume the same operator-facing activity record for the same frame and activity identity. Per-surface reconstruction of actor/action/target/outcome semantics is out of scope because it risks authority drift.
- **Operator-facing labels and inspector order**: Primary labels MUST use recorded `actor`, `action`, `target`, `status_or_outcome`, and `evidence_role` fields when available. `Workflow step`, `Agent invoked`, `Tool called`, `Retrieval searched`, and `Workflow advanced` are prohibited as primary labels when stronger recorded context exists and MAY appear only as fallback labels. The inspector should prioritize `trigger`, `input`, `output`, `outcome`, `downstream_effect`, `artifacts`, and `evidence_condition` ahead of raw identifiers and telemetry attributes.
- **Focused validation matrix**: The plan must validate the shared operator-facing activity record and its insufficiency disclosures against at least one LLM activity, one workflow-step activity, one agent activity, one tool activity, one retrieval activity, repeated LLM, repeated tool, and repeated retrieval invocations, plus sparse or missing-evidence cases.

## Plan Delta: Terminal Evidence, Activity Context, and Inspectable Graph Context

This delta tightens three authority boundaries that the revised spec now makes explicit: terminal lifecycle evidence is independently sufficient, activity context may truthfully remain at frame-overview, and fan-out or convergence meaning requires recorded relationship evidence even when some context is hidden from the current graph view.

- **Terminal status is sufficient without displayable I/O**: Projection logic must treat recorded terminal lifecycle evidence, including explicit terminal status on start-like lifecycle events such as `tool.called`, as independently sufficient to close an activity. Recorded input, output, result-count, error, and safe-preview data may enrich the activity record, but missing, redacted, encrypted, permission-denied, oversized, absent, or otherwise undisplayable I/O must not cause a terminal activity to render as active.
- **Frame overview is a first-class authority state**: The shared frame context must support two truthful modes for the same frame: a clearly labeled frame-overview state or exactly one authoritative selected activity. Default selection is optional rather than mandatory, but whenever the UI chooses one it must expose the basis, such as latest event or current event, and every surface must consume the same basis-aware state.
- **Recorded relationship evidence gates fan-out and convergence**: Parallel groups, fan-out markers, merge groups, convergence phrases, and graph context disclosure must be emitted only when recorded relationship evidence supports them. Timestamp overlap, visual grouping, proximity, or layout remain insufficient.
- **Hidden graph context stays disclosed and inspectable**: When recorded parent, sibling, downstream, parallel, or convergence context exists outside the current graph view because of filtering, focus, or zoom, the surface must disclose that hidden context and preserve a path to inspect it. This hidden-context disclosure must remain distinct from not-recorded or uncertain relationship evidence.
- **Single-source delivery across surfaces**: Summary, sidebar, current-event, graph, timeline, and inspector must consume the same frame-keyed activity-context state, the same terminal-status semantics, and the same relationship-evidence disclosures. No surface may independently decide that a terminal activity is still active because its I/O is not displayable, or that hidden context is absent because it is off-screen.

## Technical Context

**Language/Version**: TypeScript 5.x across the primary implementation surface, running on Node.js >=20; React 19.2 and Next.js 16.2 in the web app. Python 3.11 workspace packages remain adjacent but are not the primary target for this feature.

**Primary Dependencies**: Next.js App Router, React, Zustand, `@xyflow/react`, Framer Motion, Express, Zod, `@agentlens/protocol`, Vitest.

**Storage**: PostgreSQL-backed span revisions, mission-local evidence admissions, append-only Governance transitions, and immutable branch cutoffs; Redis-backed realtime notifications; S3-compatible artifact storage; deterministic in-memory projections derived from selected frame evidence. Derived replay events are not an authoritative persisted event ledger.

**Testing**: Workspace Vitest suites in `apps/api-ts` and `apps/web`, especially projection, route, store, and contract tests; existing pytest coverage is peripheral to this feature.

**Target Platform**: Browser-based Run UI in `apps/web` backed by Node services in `apps/api-ts`.

**Project Type**: Monorepo web application with a shared TypeScript protocol/projection package and supporting Python SDK packages.

**Performance Goals**: On the golden validation corpus, keep same-frame cross-view focus synchronization within 250 ms p95 after an activity selection and keep already-recorded frame switches fully aligned within 1.0 second p95 in the reference local inspection environment.

**Constraints**: Every surface must honor one explicit runtime frame including time; activity identity must prefer invocation-level identifiers over span or event identifiers and allow multiple activities within one span; preserve evidence provenance, redaction, encrypted-value, oversized-preview, recorded-empty, permission-restricted, and missing/inconsistent evidence disclosure; every selected or story-critical activity must use one shared operator-facing activity record with explicit field-level evidence conditions; every frame must expose either a clearly labeled frame-overview state or exactly one authoritative selected activity, and any default selected activity must disclose its basis while frames without selectable activities disclose the no-activity state and clear stale prior selection; explicit terminal lifecycle evidence must remain sufficient even when displayable I/O is absent; fan-out and convergence semantics must require recorded relationship evidence; hidden recorded graph context must remain disclosed and inspectable rather than collapsing into not-recorded evidence; no explanatory surface may expose protected content beyond its permitted safe evidence preview; keep the activity taxonomy workload-neutral; use the fixed core phase vocabulary `Queued`, `Active Work`, `Waiting`, `Converging`, `Completed`, `Failed`, or `Unknown`; keep progress markers subordinate to that single phase authority; keep hard engineering acceptance separate from non-blocking product validation; satisfy keyboard and assistive-technology requirements for the core flow; do not depend on AI-authored summaries; do not redesign the UI, add visual-polish scope, add BSOps-specific core types, or introduce a new ontology; avoid a broad product architecture rewrite.

**Scale/Scope**: Expected work spans shared projection/types in `packages/protocol`, frame-aware route/store plumbing in `apps/api-ts`, and coordinated summary/graph/timeline/inspector state and rendering in `apps/web`, validated against one BSOps update/diagnosis corpus plus two non-BSOps corpora: a generic HITL multi-agent run and a sparse or conflict-heavy run with disconnected and incompatible-view cases. Engineering acceptance is gated by the corpus-based hard criteria in the spec; comparative usability research remains a separate, explicitly scoped product-validation track.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`PASS`: The design satisfies the ratified AgentLens Constitution before research and
after Phase 1 design.

- **Passive observability**: The feature explains recorded execution and explicitly
  rejects AI-authored core meaning, hidden intent, and BSOps-specific core reasoning.
- **L0 evidence**: `research.md`, `data-model.md`, and the runtime-story contract require
  evidence references and distinct missing, inconsistent, and redacted conditions.
- **L1 determinism**: The shared `RuntimeExplanationProjection` remains the one
  workload-neutral, deterministic projection for a selected frame, including
  activity-information sufficiency and story-critical gating metadata.
- **L2 isolation**: BSOps meaning is optional decoration and cannot change activity
  identity, lifecycle, outcome, topology, causality, provenance, or frame.
- **Stable contracts**: The plan extends existing projection and summary contracts; it
  adds no BSOps node kinds, domain ontology, or separate story authority, and any
  incompatible summary or explanation semantics must use explicit versioning,
  fallback behavior, and compatibility disclosure.
- **Frame consistency**: Summary, sidebar, current-event, graph, timeline, and inspector use the frame tuple
  `{ mission_id, branch_id, sequence_num, as_of_timestamp, projection_version }`,
  show one authoritative run status, one authoritative runtime phase, and one
  authoritative activity-context mode for that frame, and exclude later evidence.
- **Cross-workload validation**: The named corpus includes a BSOps golden run, a generic
  HITL corpus, and a sparse or conflict-heavy non-BSOps corpus with disconnected and
  incompatible-view cases.

Post-Phase 1 re-check: `PASS`. The data model and contract preserve evidence provenance,
one shared frame, deterministic projection, and the L1/L2 boundary without a
constitution exception.

## Design Focus For This Delta

### Projection and Protocol

- Extend the shared activity model with one operator-facing activity record that is deterministic, evidence-backed, and frame-scoped.
- Represent both value payloads and field conditions explicitly so every required field can render either a permitted value or a specific insufficiency condition.
- Represent story-critical sufficiency as L1 metadata attached to activities or summary selections, not as a UI-only heuristic and not as domain reasoning.
- Treat explicit terminal lifecycle status and recorded end-time closure as sufficient lifecycle evidence independent of whether displayable inputs or outputs exist.
- Represent frame-overview versus selected-activity context as one explicit frame-scoped authority state, including the visible basis for any default selected activity.
- Represent fan-out, parallelism, and convergence only from recorded relationship evidence, plus explicit hidden-context disclosure when some recorded relationship context is outside the current graph view.

### API Delivery

- Transport the same selected-frame operator-facing activity record through runtime explanation and runtime summary responses without per-surface reshaping of core semantics.
- Keep compatibility and fallback behavior explicit if any new fields are additive to existing explanation or summary versions.
- Preserve authorization boundaries so safe previews, evidence references, and field-condition disclosures never reveal protected content.
- Transport one frame-scoped activity-context state that can truthfully express either frame overview or a selected activity, including any default-selection basis.
- Transport relationship-context disclosures that distinguish hidden-but-recorded graph context from not-recorded or uncertain relationship evidence.

### UI Consumption

- Treat the shared operator-facing activity record as the source of truth for selected-activity and story-critical rendering in summary, graph, timeline, inspector, and current-event.
- Use the shared record to build primary labels, concise story phrases, and inspector sections so the same activity does not explain itself differently by surface.
- Support both frame-overview and selected-activity modes without inventing a selection; when a default selection exists, disclose its basis consistently across current-event, summary, graph, timeline, sidebar, and inspector.
- Clear current-event, summary, graph, timeline, sidebar, and inspector selection authority whenever the selected frame has no selectable activity or when the authoritative mode returns to frame overview instead of retaining stale focus from a prior frame.
- When a story-critical activity lacks enough recorded actor/action/target/outcome context, show the limitation with the activity rather than silently promoting a stronger story than the evidence supports.
- Keep terminal activity status rendering tied to shared terminal-evidence rules rather than to the presence of displayable input/output previews.
- Disclose hidden recorded graph context with an inspectable path, and keep that disclosure visually and semantically distinct from missing relationship evidence.

### Test Strategy

- Add projection and contract coverage for one LLM activity, one workflow-step activity, one agent activity, one tool activity, and one retrieval activity, plus repeated LLM, repeated tool, and repeated retrieval invocations, each proving the shared operator-facing activity record is populated from evidence-backed fields and remains distinguishable across surfaces.
- Add sparse and missing-evidence fixtures proving every required field discloses the right insufficiency condition instead of disappearing.
- Add cross-surface agreement tests proving summary, current-event, graph, timeline, and inspector consume the same operator-facing activity record for the same frame and selected activity, and proving stale selection is cleared when a frame has no selectable activity or truthfully remains in frame-overview mode.
- Add story-critical gating tests proving insufficient actor/action/target/outcome evidence either blocks strong promotion or forces explicit incompleteness disclosure.
- Add lifecycle tests proving explicit terminal status on `tool.called` and other start-like events is independently sufficient even when input/output previews are absent or undisplayable.
- Add graph-context tests proving fan-out and convergence are emitted only from recorded relationship evidence, and that hidden recorded context remains inspectable and distinct from not-recorded or uncertain relationship evidence.

## Project Structure

### Documentation (this feature)

```text
specs/001-runtime-execution-story/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   `-- runtime-story-contract.md
`-- tasks.md
```

### Source Code (repository root)

```text
apps/
|-- api-ts/
|   |-- src/
|   |   |-- routes/
|   |   `-- services/
|   `-- tests/unit/
`-- web/
    |-- src/
    |   |-- app/missions/[id]/
    |   |-- components/graph/
    |   |-- components/rops/
    |   |-- components/runtime/
    |   |-- components/timeline/
    |   |-- hooks/
    |   |-- lib/
    |   `-- stores/
    `-- tests/unit/

packages/
`-- protocol/
    |-- src/types.ts
    `-- src/projections/
```

**Structure Decision**: Keep the feature inside the existing monorepo boundaries: shared runtime-story semantics in `packages/protocol`, transport and frame selection plumbing in `apps/api-ts`, and synchronized Run UI consumption in `apps/web`. The node-information sufficiency delta must extend the existing projection, summary, and surface-consumption paths rather than adding a new service, semantic layer, app, or domain-specific package.

## Complexity Tracking

No constitution-driven violations or special justifications are currently required.
