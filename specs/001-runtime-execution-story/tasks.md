# Tasks: Coherent Runtime Execution Story

**Input**: Design documents from `/specs/001-runtime-execution-story/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED for runtime-affecting behavior. This plan covers deterministic projection, historical and branched frame boundaries, evidence and provenance conditions, contract compatibility, and domain-specific plus generic/non-domain fixture validation.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g. `US1`, `US2`, `US3`)
- Every task includes exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared corpus fixtures, reusable assertions, and validation scaffolding for the runtime-story feature

- [x] T001 Create the golden runtime-story corpus manifest and loader skeleton in `apps/api-ts/tests/fixtures/runtimeStoryCorpus.ts`
- [x] T002 [P] Create shared runtime-story assertion helpers in `apps/api-ts/tests/helpers/runtimeStoryAssertions.ts`
- [x] T003 [P] Create shared web fixture builders for summary, graph, timeline, and inspector states in `apps/web/tests/fixtures/runtimeStoryFixtures.ts`
- [x] T004 [P] Create the engineering-acceptance worksheet in `specs/001-runtime-execution-story/checklists/runtime-story.md`
- [x] T005 [P] Create the optional product-validation worksheet in `specs/001-runtime-execution-story/usability-results.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the stable frame-aware contract, deterministic projection rules, and fixture coverage that block all user stories

**CRITICAL**: No user story work should begin until this phase is complete

- [x] T006 Document versioned explanation and summary compatibility, downgrade behavior, and fallback disclosures in `specs/001-runtime-execution-story/contracts/runtime-story-contract.md` and `packages/protocol/README.md`
- [x] T007 [P] Extend protocol types for `RuntimeFrame`, `RunStatus`, fixed `RuntimePhase`, `ProgressMarker`, compatibility metadata, evidence-value conditions, the shared operator-facing activity record, and explicit `selected_activity_state` handling for no-activity frames in `packages/protocol/src/types.ts` and `packages/protocol/src/index.ts`
- [x] T008 [P] Implement deterministic `run_status`, fixed phase vocabulary and basis, `progress_markers`, shared selected/story-critical operator-facing activity records, explicit frame-overview versus selected-activity authority, explicit no-activity-frame selection clearing, terminal-status sufficiency independent of displayable I/O, and activity sufficiency metadata in `packages/protocol/src/projections/explanationProjection.ts`
- [x] T009 [P] Implement deterministic summary derivation for important activities, story-critical gating, progress markers, basis-visible frame-overview or default-selection disclosure, and collapsed-background disclosure in `packages/protocol/src/projections/summaryProjection.ts`
- [x] T010 [P] Freeze the first stable `runtime_explanation.v1`, reject unsupported versions, and validate REST/realtime consumers in `apps/api-ts/tests/unit/runtimeContractFreeze.test.ts`, `apps/api-ts/tests/unit/routes.test.ts`, and `apps/web/tests/unit/runtimeExplanationContract.test.ts`. No speculative v2 is created.
- [x] T011 [P] Add projection tests proving overlapping siblings never create causal edges without explicit evidence in `apps/api-ts/tests/unit/explanationProjection.test.ts`
- [x] T012 [P] Add historical and branched-frame exclusion tests for later statuses, phases, selections, retries, artifacts, and decisions in `apps/api-ts/tests/unit/explanationProjection.test.ts` and `apps/api-ts/tests/unit/routes.test.ts`
- [x] T013 [P] Add projection tests for late or out-of-order records, timestamp conflicts, lifecycle conflicts, and frame-ordering guarantees in `apps/api-ts/tests/unit/explanationProjection.test.ts`
- [x] T014 [P] Add scaffold fixture coverage for Corpus A, Corpus B, and Corpus C plus LLM, workflow-step, agent, repeated tool, repeated retrieval, repeated LLM, frame-overview-with-selectable-activities, no-activity-frame, explicit terminal-status-without-displayable-I/O, hidden-graph-context, and sparse insufficiency operator-facing-activity-record cases in `apps/api-ts/tests/fixtures/runtimeStoryCorpus.ts` and `apps/web/tests/fixtures/runtimeStoryFixtures.ts`
- [x] T015 Thread version-aware frame identity, `run_status`, phase basis, and paired summary or explanation transport through `apps/api-ts/src/services/missionStore.ts`, `apps/api-ts/src/routes/extras.ts`, and `apps/api-ts/src/routes/missions.ts`
- [x] T056 [P] Add projection tests proving activity identity prefers `tool_call_id`, LLM request ID, retrieval request ID, interrupt ID, workflow step ID, and artifact ID over span or event ID; cover fallback identity and multiple activities recorded within one span in `apps/api-ts/tests/unit/explanationProjection.test.ts`
- [x] T057 Implement invocation-first activity identity precedence, span or event fallback, and multiple-activities-per-span handling in `packages/protocol/src/projections/explanationProjection.ts`

**Checkpoint**: Stable contracts, invocation-first activity identity, deterministic projection rules, and required validation corpora are ready for independent story delivery

---

## Phase 3: User Story 1 - Understand a Run at a Glance (Priority: P1)

**Goal**: Let an operator open a run and immediately understand the authoritative frame, run status, workload-neutral runtime phase, major participants, important activities, and optional progress markers

**Independent Test**: Open a previously unseen complex run at a selected frame and verify the summary alone communicates authoritative `run_status`, authoritative phase plus basis, principal participants, operator-facing activity phrases, and any subordinate progress markers without opening detailed permitted recorded evidence

### Tests for User Story 1 *(required for runtime behavior)*

- [x] T016 [P] [US1] Add summary-projection tests for `run_status`, fixed phase labels, phase basis, deterministic activity ranking, primary label quality, fallback-only enforcement for `Workflow step`, `Agent invoked`, `Tool called`, `Retrieval searched`, and `Workflow advanced`, and story-critical sufficiency gating in `apps/api-ts/tests/unit/summaryProjection.test.ts`
- [x] T017 [P] [US1] Add summary contract tests for frame identity, unknown fallbacks, progress-marker subordination, collapsed-background disclosure, and story-critical operator-facing activity record availability in `apps/web/tests/unit/explanationContract.test.ts`

### Implementation for User Story 1

- [x] T018 [US1] Expose summary-facing `run_status`, fixed runtime phase, progress markers, activity phrase metadata, fallback-only generic-label enforcement, and story-critical operator-facing activity records from `packages/protocol/src/projections/explanationProjection.ts` and `packages/protocol/src/projections/summaryProjection.ts`
- [x] T019 [US1] Thread paired frame identity, `run_status`, phase label and basis, and progress-marker data into runtime-summary responses in `apps/api-ts/src/services/missionStore.ts` and `apps/api-ts/src/routes/extras.ts`
- [x] T020 [US1] Render authoritative frame identity, `run_status`, runtime phase and basis, and participant summary in `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx`
- [x] T021 [US1] Render operator-facing important activity phrases, story-critical limitation disclosure, subordinate progress markers, and collapsed-background disclosure in `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx`
- [x] T022 [US1] Align summary loading and stale-state disclosure to the selected explanation frame in `apps/web/src/app/missions/[id]/page.tsx`, `apps/web/src/hooks/useRuntimeSummary.ts`, and `apps/web/src/hooks/useRuntimeExplanation.ts`

**Checkpoint**: User Story 1 is independently functional and can serve as the MVP summary experience

---

## Phase 4: User Story 2 - Follow Execution Across Views (Priority: P2)

**Goal**: Keep summary, graph, timeline, sidebar, and inspector locked to the same runtime frame and authoritative selected activity while preserving graph context and truthful timeline behavior

**Independent Test**: Select an important activity from summary, graph, timeline, and inspector in turn and confirm every other surface preserves the same frame tuple, authoritative selected activity, relationship basis, and surrounding context or explicitly discloses incompatibility

### Tests for User Story 2 *(required for runtime behavior)*

- [x] T023 [P] [US2] Add shared-frame and activity-context store tests covering clearly labeled frame-overview mode, visible default-selection basis, authoritative selected-activity mode, and stale-selection clearing for no-activity or overview frames in `apps/web/tests/unit/stores.test.ts`
- [x] T024 [P] [US2] Add cross-surface agreement tests for summary, current-event, graph, timeline, sidebar, and inspector, including one shared frame-keyed `run_status` or `runtime_phase` authority object, basis-visible frame-overview or default-selection authority, explicit same-frame conflict failures, and consistent operator-facing activity records for selected LLM, workflow-step, agent, tool, retrieval, repeated LLM, repeated tool, and repeated retrieval activities, in `apps/web/tests/unit/explanationContract.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T025 [P] [US2] Add graph-context tests for parent or trigger visibility, evidence-backed parallel groups, evidence-backed fan-out or convergence, hidden recorded context disclosure with inspectable paths, and disconnected-region or uncertain-relationship disclosure in `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T026 [P] [US2] Add timeline tests for lifecycle-noise reduction, permitted event detail, and frame-preserving historical navigation in `apps/web/tests/unit/runtimeExplainability.test.ts`

### Implementation for User Story 2

- [x] T027 [US2] Preserve the authoritative frame tuple, frame-overview-versus-selected-activity authority, visible default-selection basis, and no-activity or overview-frame stale-selection clearing behavior in `apps/web/src/stores/replayStore.ts` and `apps/web/src/stores/graphStore.ts`
- [x] T028 [US2] Implement shared frame-keyed `run_status` or `runtime_phase` authority plus shared activity-context, default-selection-basis disclosure, and operator-facing activity record handoff across summary, current-event, timeline, graph, and inspector in `apps/web/src/lib/runtimeFocus.ts`, `apps/web/src/app/missions/[id]/page.tsx`, and `apps/web/src/components/layout/RightSidebar.tsx`
- [x] T029 [US2] Replace exclusive timeline filtering with context-preserving focus and permitted event-detail disclosure in `apps/web/src/components/timeline/MissionTimeline.tsx` and `apps/web/src/components/timeline/TimelineEventCard.tsx`
- [x] T030 [US2] Render graph context for parent or trigger, evidence-backed siblings or parallel work, downstream work, evidence-backed convergence, hidden recorded context with inspectable disclosure, uncertain or missing relationship regions, and story-critical label or limitation disclosure in `apps/web/src/components/graph/MissionGraph.tsx`, `apps/web/src/components/graph/GraphLegend.tsx`, and `apps/web/src/components/graph/EdgeInspector.tsx`
- [x] T031 [US2] Disclose frame, status, phase, selection, and representational incompatibilities instead of drifting authority or independently deriving competing same-frame values in `apps/web/src/components/layout/RightSidebar.tsx` and `apps/web/src/components/rops/RopsInspector.tsx`
- [x] T032 [US2] Thread graph snapshot cutoff and explanation-frame agreement through `apps/api-ts/src/services/missionStore.ts` and `apps/api-ts/src/routes/missions.ts`

**Checkpoint**: User Stories 1 and 2 both work independently, and cross-view frame drift is blocked

---

## Phase 5: User Story 3 - Diagnose Failures, Waits, and Missing Evidence (Priority: P3)

**Goal**: Let operators distinguish failures, waits, retries, incomplete lifecycles, and evidence or value conditions without fabricated or collapsed truth

**Independent Test**: Use runs with retries, waits, missing lifecycle events, recorded-empty values, redacted values, encrypted values, oversized previews, permission-restricted previews, and contradictory evidence; confirm the UI exposes each condition distinctly and links back to permitted evidence

### Tests for User Story 3 *(required for runtime behavior)*

- [x] T033 [P] [US3] Add projection tests for recorded-empty, redacted, encrypted, oversized, permission-restricted, and inconsistent value conditions in `apps/api-ts/tests/unit/explanationProjection.test.ts`
- [x] T034 [P] [US3] Add retry, wait, incomplete-lifecycle, closed-span-`UNSET`, explicit terminal-`tool.called`, terminal-status-without-displayable-I/O, and child-outcome-vs-run-status tests in `apps/api-ts/tests/unit/explanationProjection.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T035 [P] [US3] Add inspector-priority contract tests for trigger, input, output, status or outcome, error or wait reason, downstream activity, artifacts, evidence condition, and provenance or raw IDs last, all sourced from one shared operator-facing activity record, in `apps/web/tests/unit/explanationContract.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T036 [P] [US3] Add authorization and redaction tests proving field-level `not_recorded`, `unavailable`, `absent`, `recorded_empty`, `redacted`, `encrypted`, `permission-denied`, `oversized`, and `inconsistent` disclosures plus permitted evidence boundaries in `apps/web/tests/unit/runtimeExplainability.test.ts` and `apps/web/tests/unit/ropsPresentation.test.ts`

### Implementation for User Story 3

- [x] T037 [US3] Implement explicit evidence-condition, evidence-value-condition, shared operator-facing activity record field disclosure generation, and terminal-lifecycle interpretation that keeps explicit terminal status authoritative even when inputs or outputs cannot be displayed in `packages/protocol/src/projections/explanationProjection.ts`
- [x] T038 [US3] Carry evidence-value metadata and authorization-aware evidence routes through `apps/api-ts/src/services/missionStore.ts` and `apps/web/src/lib/api.ts`
- [x] T039 [US3] Reorder inspector content around debugging priorities and shared operator-facing activity record sections in `apps/web/src/components/rops/RopsInspector.tsx` and `apps/web/src/components/layout/RightSidebar.tsx`
- [x] T040 [US3] Distinguish not-recorded, unavailable, absent, recorded-empty, redacted, encrypted, oversized, permission-restricted, and inconsistent values in `apps/web/src/components/timeline/TimelineEventCard.tsx`, `apps/web/src/components/timeline/MissionTimeline.tsx`, and `apps/web/src/components/rops/RopsInspector.tsx`
- [x] T041 [US3] Surface waits, retries, incomplete-lifecycle conditions, terminal-status-without-I/O completion semantics, and disconnected-region diagnostics in `apps/web/src/components/layout/RightSidebar.tsx` and `apps/web/src/components/graph/MissionGraph.tsx`
- [x] T042 [US3] Preserve progressive disclosure to permitted evidence references and safe previews in `apps/web/src/components/rops/RopsEvidence.tsx` and `apps/web/src/lib/rops/nodeEvidence.ts`

**Checkpoint**: User Stories 1-3 are independently functional, and debugging truthfulness is preserved under sparse or conflicting evidence

---

## Phase 6: User Story 4 - Validate Generic Use Across Workloads (Priority: P4)

**Goal**: Prove the execution story remains generic across BSOps and non-BSOps corpora without allowing domain decoration to redefine core runtime meaning

**Independent Test**: Run the same comprehension and debugging checks against Corpus A, Corpus B, and Corpus C and confirm each uses the same frame, status, phase, causality, evidence, and disclosure rules

### Tests for User Story 4 *(required for runtime behavior)*

- [x] T043 [P] [US4] Add corpus-driven projection tests for Corpus A, Corpus B, and Corpus C in `apps/api-ts/tests/unit/projection.test.ts` and `apps/api-ts/tests/unit/projectionProfile.test.ts`
- [x] T044 [P] [US4] Add corpus-driven web alignment tests across summary, graph, timeline, and inspector in `apps/web/tests/unit/explanationContract.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T045 [P] [US4] Add two-interaction evidence-navigation assertions in `apps/web/tests/unit/runtimeExplainability.test.ts`

### Implementation for User Story 4

- [x] T046 [US4] Populate Corpus A, Corpus B, and Corpus C fixtures from the shared scaffold with the required coverage characteristics, including an LLM node with missing input or output, a weak workflow-step node, an agent node with downstream activity, repeated tool, repeated retrieval, repeated LLM, frame-overview-with-selectable-activities, no-activity-frame, explicit terminal-status-without-displayable-I/O, hidden-recorded-graph-context, same-frame status or phase conflict fixtures, and sparse insufficient-information cases, in `apps/api-ts/tests/fixtures/runtimeStoryCorpus.ts` and `apps/web/tests/fixtures/runtimeStoryFixtures.ts`
- [x] T047 [US4] Enforce L2 decoration boundaries in `apps/api-ts/src/services/runtime/projection.ts`, `packages/protocol/src/types.ts`, and `apps/web/src/lib/rops/provenance.ts`
- [x] T048 [US4] Keep generic runtime labels primary and workload decoration secondary in `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx` and `apps/web/src/components/rops/RopsInspector.tsx`
- [x] T049 [US4] Document external BSOps-harness fallback handling and in-repo substitutes in `docs/reference/rops.md`, `packages/protocol/README.md`, and `specs/001-runtime-execution-story/quickstart.md`

**Checkpoint**: All four user stories are independently functional and validated across the required workload classes

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finish accessibility, performance, documentation, and acceptance validation across the complete feature

- [x] T050 [P] Implement keyboard, focus, label, and non-color cue remediations in `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx`, `apps/web/src/components/timeline/MissionTimeline.tsx`, `apps/web/src/components/graph/MissionGraph.tsx`, and `apps/web/src/components/layout/RightSidebar.tsx`
- [x] T051 [P] Add accessibility regression tests for keyboard reachability, visible focus, authoritative labels, and non-color cues in `apps/web/tests/unit/explanationContract.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T052 [P] Add frame-switch and activity-selection latency checks against the golden corpus in `apps/web/tests/unit/uxFidelity.test.ts` and `apps/web/tests/unit/uxFidelityAdversarial.test.ts`
- [x] T053 [P] Update validation guidance and acceptance scenarios in `specs/001-runtime-execution-story/quickstart.md`, `docs/reference/rops.md`, and `packages/protocol/README.md`
- [x] T054 Run the engineering-acceptance scenarios from `specs/001-runtime-execution-story/quickstart.md` and record findings in `specs/001-runtime-execution-story/checklists/runtime-story.md`
- [ ] T055 If product-validation research is explicitly in sprint scope, record the 12-person comparative usability results in `specs/001-runtime-execution-story/usability-results.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup** has no dependencies and can start immediately.
- **Phase 2: Foundational** depends on Setup completion and blocks all story work.
- **Phase 3: User Story 1** depends on Foundational completion and defines the MVP.
- **Phase 4: User Story 2** depends on Foundational completion.
- **Phase 5: User Story 3** depends on Foundational completion.
- **Phase 6: User Story 4** depends on Foundational completion plus the core behaviors from User Stories 1-3.
- **Phase 7: Polish** depends on the desired user stories being complete.
- **Phase 8: Convergence - Surface Authority** depends on the relevant US1-US3 surface behaviors being present and refines cross-surface authority gaps found after initial implementation.
- **Phase 9: Convergence - Final Authority Alignment** depends on Phase 8 completion and closes remaining cross-surface authority, contract-consumption, and timeline-authority gaps before implementation resumes.

### User Story Dependencies

- **US1 (P1)**: No dependency on other user stories once Foundational work is complete.
- **US2 (P2)**: No dependency on US3 or US4 once Foundational work is complete.
- **US3 (P3)**: No dependency on US2 or US4 once Foundational work is complete.
- **US4 (P4)**: Depends on US1-US3 behaviors being present so the corpora can validate them across workloads.

### Within Each User Story

- Story tests must be written and fail before implementation changes for that story.
- Shared types and projection changes precede API wiring.
- API wiring precedes UI rendering and synchronization work.
- UI rendering precedes validation and disclosure refinement.

### Parallel Opportunities

- `T002`, `T003`, `T004`, and `T005` can run in parallel after `T001`.
- `T007`, `T008`, `T009`, `T010`, `T011`, `T012`, `T013`, `T014`, and `T056` can run in parallel once `T006` defines the compatibility contract.
- `T057` begins after the activity-identity tests in `T056` are written and failing.
- Within US1, `T016` and `T017` can run in parallel.
- Within US2, `T023`, `T024`, `T025`, and `T026` can run in parallel.
- Within US3, `T033`, `T034`, `T035`, and `T036` can run in parallel.
- Within US4, `T043`, `T044`, and `T045` can run in parallel.
- In Polish, `T050`, `T051`, `T052`, and `T053` can run in parallel.

---

## Parallel Example: User Story 2

```bash
# Launch the User Story 2 tests together:
Task: "Add shared-frame and activity-context store tests covering clearly labeled frame-overview mode, visible default-selection basis, authoritative selected-activity mode, and stale-selection clearing in apps/web/tests/unit/stores.test.ts"
Task: "Add cross-surface agreement tests for summary, graph, timeline, sidebar, and inspector in apps/web/tests/unit/explanationContract.test.ts and apps/web/tests/unit/runtimeExplainability.test.ts"
Task: "Add graph-context tests for parent or trigger visibility, evidence-backed parallel groups, evidence-backed fan-out or convergence, hidden recorded context disclosure, and disconnected-region disclosure in apps/web/tests/unit/runtimeExplainability.test.ts"
Task: "Add timeline tests for lifecycle-noise reduction, permitted event detail, and frame-preserving historical navigation in apps/web/tests/unit/runtimeExplainability.test.ts"
```

## Parallel Example: User Story 3

```bash
# Launch the User Story 3 tests together:
Task: "Add projection tests for recorded-empty, redacted, encrypted, oversized, permission-restricted, and inconsistent value conditions in apps/api-ts/tests/unit/explanationProjection.test.ts"
Task: "Add retry, wait, incomplete-lifecycle, closed-span-UNSET, explicit terminal-tool.called, terminal-status-without-displayable-I/O, and child-outcome-vs-run-status tests in apps/api-ts/tests/unit/explanationProjection.test.ts and apps/web/tests/unit/runtimeExplainability.test.ts"
Task: "Add inspector-priority contract tests for trigger, inputs, outputs, outcome, error or wait reason, downstream activity, and artifacts in apps/web/tests/unit/explanationContract.test.ts and apps/web/tests/unit/runtimeExplainability.test.ts"
Task: "Add authorization and redaction tests proving permitted evidence references and safe evidence previews never expose protected content beyond policy in apps/web/tests/unit/runtimeExplainability.test.ts and apps/web/tests/unit/ropsPresentation.test.ts"
```

## Parallel Example: User Story 4

```bash
# Launch the User Story 4 corpus tests together:
Task: "Add corpus-driven projection tests for Corpus A, Corpus B, and Corpus C in apps/api-ts/tests/unit/projection.test.ts and apps/api-ts/tests/unit/projectionProfile.test.ts"
Task: "Add corpus-driven web alignment tests across summary, graph, timeline, and inspector in apps/web/tests/unit/explanationContract.test.ts and apps/web/tests/unit/runtimeExplainability.test.ts"
Task: "Add two-interaction evidence-navigation assertions in apps/web/tests/unit/runtimeExplainability.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Validate the summary-only comprehension flow against one selected frame
5. Stop for review before expanding into deeper cross-view work

### Incremental Delivery

1. Build the shared deterministic frame, compatibility, and projection foundation
2. Deliver US1 as the MVP comprehension story
3. Deliver US2 to lock graph, timeline, sidebar, and inspector onto the same frame while preserving context
4. Deliver US3 to make failures, waits, retries, and evidence gaps truthful and diagnosable
5. Deliver US4 to prove the feature remains generic across required workload classes
6. Finish with accessibility, latency, and acceptance-validation work

### Parallel Team Strategy

1. One engineer owns shared protocol or API foundation while another prepares shared fixtures and web test scaffolding.
2. After Foundational work completes:
   Engineer A: US1 summary experience
   Engineer B: US2 graph or timeline synchronization and graph semantics
   Engineer C: US3 evidence-condition diagnostics and inspector prioritization
3. US4 and Polish begin once the core behaviors exist across the first three stories.

---

## Notes

- [P] tasks target different files and avoid incomplete-task dependencies.
- Each story stays independently testable against its own acceptance check.
- Runtime behavior tests are intentionally first-class because the constitution requires deterministic, frame-consistent validation.
- The suggested MVP scope is **User Story 1 only** after Setup and Foundational phases complete.

---

## Phase 8: Convergence - Surface Authority

- [x] T058 Add web alignment tests covering the page-level Current Event card and sidebar Reconstructed Runtime matrix so they match the selected frame's authoritative status and runtime phase in `apps/web/tests/unit/explanationContract.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts` per FR-003, FR-020, SC-001 (missing)
- [x] T059 Align the page-level Current Event card and the sidebar Reconstructed Runtime matrix with the selected frame's authoritative status and runtime phase, or disclose incompatibility, in `apps/web/src/app/missions/[id]/page.tsx` and `apps/web/src/components/replay/BranchExplorer.tsx` per FR-001, FR-003, FR-020, SC-001 (partial)
- [x] T060 [P] [US2] Add current-event authority tests proving the page-level Current Event card adopts the same authoritative selected activity, `run_status`, and `runtime_phase` as summary, graph, timeline, sidebar, and inspector, clears stale selection for no-activity frames, and fails on cases where frame phase is `Completed` while runtime status is `Active`, selected activity outcome is `Completed` while lifecycle or status remains `active`, or current-event shows an `active` event as authoritative frame status instead of clearly labeled historical or current-event metadata, in `apps/web/tests/unit/explanationContract.test.ts` and `apps/web/tests/unit/runtimeExplainability.test.ts`
- [x] T061 [US2] Align the page-level Current Event card with the selected frame's authoritative selected activity, shared frame-keyed `run_status` or `runtime_phase` authority, and operator-facing activity record, remove stale prior selection when the frame has no selectable activity, and ensure current-event metadata cannot compete with authoritative frame status or phase unless explicitly disclosed as non-authoritative historical metadata, in `apps/web/src/app/missions/[id]/page.tsx` and `apps/web/src/components/layout/RightSidebar.tsx`

## Phase 9: Convergence - Final Authority Alignment

- [x] T062 CRITICAL: Introduce one frame-keyed selected-activity authority, clear stale selection on no-activity frames, and make summary, graph, timeline, current-event, and inspector resolve repeated LLM, tool, and retrieval focus by invocation identity before span or event fallback in `apps/web/src/stores/replayStore.ts`, `apps/web/src/stores/graphStore.ts`, `apps/web/src/lib/runtimeFocus.ts`, `apps/web/src/app/missions/[id]/page.tsx`, `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx`, `apps/web/src/components/timeline/MissionTimeline.tsx`, and `apps/web/src/components/graph/MissionGraph.tsx` per FR-011, FR-020, FR-035, SC-002, SC-009, Constitution V (partial)
- [x] T063 CRITICAL: Add the shared operator-facing activity record and explicit field-level evidence-condition transport, then consume that record across summary, current-event, timeline, sidebar, and inspector instead of raw `title`, `action`, `status`, or `outputs.output` fallbacks in `packages/protocol/src/types.ts`, `packages/protocol/src/projections/explanationProjection.ts`, `packages/protocol/src/projections/summaryProjection.ts`, `apps/api-ts/src/services/missionStore.ts`, `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx`, `apps/web/src/components/timeline/TimelineEventCard.tsx`, `apps/web/src/components/layout/RightSidebar.tsx`, and `apps/web/src/components/rops/RopsInspector.tsx` per FR-036, FR-037, SC-010, Constitution II (missing)
- [x] T064 Replace the remaining legacy runtime-summary contract usage with authoritative frame-keyed `run_status`, fixed `runtime_phase` plus basis, and story-critical limitation disclosures in `packages/protocol/src/types.ts`, `packages/protocol/src/projections/summaryProjection.ts`, `apps/api-ts/src/services/missionStore.ts`, `apps/api-ts/src/services/runtimeSummary.ts`, and `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx` per FR-003, FR-020, FR-028, FR-029, SC-001 (partial)
- [x] T065 Remove competing snapshot-phase authority from the timeline phase rail and render authoritative runtime-phase or progress-marker context without collapsing repeated invocations or hiding full-frame context in `apps/web/src/components/timeline/MissionTimeline.tsx` and `apps/web/src/components/timeline/TimelineEventCard.tsx` per FR-003, FR-013, FR-028, FR-029, SC-001 (contradicts)

## Phase 10: Convergence

- [x] T066 Align the runtime-story contract types and projection outputs to explicit `overview`, `selected`, and `no_activity` activity-context states with visible `selection_basis`, and stop auto-selecting the first activity whenever selectable work exists in `packages/protocol/src/types.ts`, `packages/protocol/src/projections/explanationProjection.ts`, and `packages/protocol/src/projections/summaryProjection.ts` per FR-011, SC-002, and plan: Frame overview is a first-class authority state (contradicts)
- [x] T067 Add regression tests for frame-overview authority, visible default-selection basis, and stale-selection clearing across explanation, summary, API, and web stores in `apps/api-ts/tests/unit/explanationProjection.test.ts`, `apps/api-ts/tests/unit/summaryProjection.test.ts`, `apps/web/tests/unit/stores.test.ts`, and `apps/web/tests/unit/explanationContract.test.ts` per US2/AC7, FR-011, and SC-002 (missing)
- [x] T068 Surface the authoritative activity-context mode and visible default-selection basis across summary, current-event, sidebar, graph, timeline, and replay state in `apps/web/src/stores/replayStore.ts`, `apps/web/src/lib/runtimeFocus.ts`, `apps/web/src/components/runtime/RuntimeSummaryPanel.tsx`, `apps/web/src/components/layout/RightSidebar.tsx`, and `apps/web/src/app/missions/[id]/page.tsx` per FR-011, FR-020, US2/AC7, and SC-002 (partial)
- [x] T069 [P] Add projection regression tests proving `tool.called` with terminal `gen_ai.tool.status` is terminal lifecycle evidence for tool or retrieval invocations, including `completed` and `failed` closure on `tool.called`, no requirement for a separate `tool.completed` event, and preservation of explicit terminal status when displayable input or output is absent, redacted, encrypted, permission-denied, or oversized, in `apps/api-ts/tests/unit/explanationProjection.test.ts` per FR-007, FR-008, and the convergence gap on terminal `tool.called` coverage (missing)
- [x] T070 Treat terminal `gen_ai.tool.status` on `tool.called` as authoritative terminal lifecycle evidence in `packages/protocol/src/projections/explanationProjection.ts`, so explicit `completed` or `failed` status closes the tool or retrieval invocation without requiring a separate terminal event and without being overridden by missing or protected displayable I/O conditions, per FR-007, FR-008, and the convergence gap on terminal `tool.called` behavior (missing)
- [x] T071 [P] Add web regression tests proving that when recorded graph context is hidden by overview zoom, standard zoom, or selected-node focus, the UI discloses that recorded nodes or edges are hidden yet inspectable, and distinguishes hidden recorded context from genuinely missing relationship evidence without inferring causality from timestamps, overlap, or layout, in `apps/web/tests/unit/runtimeExplainability.test.ts` and `apps/web/tests/unit/explanationContract.test.ts` per FR-014, FR-033, and the convergence gap on hidden recorded graph context disclosure (missing)
- [x] T072 Disclose and preserve inspectable hidden recorded graph context across zoom, filtering, and focus modes in `apps/web/src/components/graph/MissionGraph.tsx`, `apps/web/src/components/graph/GraphLegend.tsx`, `apps/web/src/components/graph/EdgeInspector.tsx`, and `apps/web/src/lib/runtimeFocus.ts`, so hidden recorded neighbors or edges remain distinct from genuinely missing relationship evidence and no competing causal story is derived from timestamps, overlap, or layout, per FR-014, FR-033, and the convergence gap on hidden recorded graph context disclosure (missing)
