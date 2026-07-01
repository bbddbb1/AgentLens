# Contract: Runtime Story

## Purpose

Define the shared frame and activity contract that keeps the Run UI's summary, graph, timeline, and inspector aligned for the same execution moment.

## External Interfaces

### 1. Runtime explanation endpoint

**Route**: `GET /api/v1/missions/:missionId/explanation`

**Query parameters**:

- `branch_id` (optional string)
- `sequence_num` (optional integer)

**Response**: `RuntimeExplanationProjection`

**Required guarantees**:

- The response is scoped to exactly one frame.
- The frame identity includes `mission_id`, `branch_id`, `sequence_num`, `as_of_timestamp`, and `projection_version`.
- `run_status` only reflects evidence available at that frame and remains distinct from any child-activity outcome.
- The response includes one required current or final phase object using the fixed workload-neutral labels `Queued`, `Active Work`, `Waiting`, `Converging`, `Completed`, `Failed`, or `Unknown`, with basis `recorded`, `derived`, or `unknown`.
- The response includes one frame-scoped activity-context authority state that is either `overview`, `selected`, or `no_activity`; when the state is `selected` by default, the visible `selection_basis` is included, and when the state is `overview` or `no_activity`, any stale prior selection is cleared.
- Any `progress_markers` are optional subordinate context and must not compete with or override the single authoritative phase.
- Explicit terminal lifecycle status, including terminal status recorded on start-like events such as `tool.called`, is sufficient completion evidence even when displayable input, output, result-count, error, or safe-preview data is absent or unavailable.
- Activities, relations, parallel groups, merge groups, and consistency flags are evidence-backed.
- Missing, inconsistent, redacted, encrypted, recorded-empty, and oversized value states remain explicit instead of being silently normalized.

### 2. Runtime summary endpoint

**Route**: `GET /api/v1/missions/:missionId/runtime-summary`

**Query parameters**:

- `branch_id` (optional string)
- `sequence_num` (optional integer)
- `enhance` (optional boolean-like flag for non-core decoration)

**Response**: `RuntimeSummary`

**Required guarantees**:

- `sequence_num` and `generated_at` must match the explanation frame used to derive the summary.
- The summary is derivative, not authoritative over the explanation.
- Important activities and any summary-visible progress markers are selected by the same deterministic prioritization used by the explanation contract.
- The summary must display the same `run_status`, runtime phase label, and phase basis as the paired explanation or disclose inability to represent them.
- The summary must display the same frame-overview versus selected-activity authority state as the paired explanation; when a default activity is selected, the same visible selection basis must be shown, and when the paired explanation is in `overview` or `no_activity`, the summary must not retain a stale activity selection.
- Optional enhancement must not redefine frame identity, activity identity, outcome, causality, or evidence conditions.

## Contract Evolution

- Existing consumers of `runtime_explanation.v1` and paired summary payloads MUST remain supported until all in-repo consumers migrate.
- If fixed phase labels and basis, `progress_markers`, explicit compatibility metadata, or other required semantics cannot be represented faithfully in `runtime_explanation.v1`, the server MUST expose a versioned `runtime_explanation.v2` contract and document downgrade behavior for `v1` consumers.
- Downgrade behavior MUST disclose omitted fields or weakened semantics instead of silently fabricating or collapsing them.
- Compatibility tests MUST cover native `v2`, downgraded `v1`, and mixed-client request behavior.

### 3. Graph snapshot source

**Current sources**:

- `GET /api/v1/missions/:missionId/graph`
- `GET /api/v1/missions/:missionId/graph/snapshots`

**Required guarantees**:

- The graph surface must expose or derive a snapshot whose cutoff matches the selected frame and its `as_of_timestamp`.
- Graph nodes that participate in the runtime story must preserve the activity/span anchors needed to correlate with explanation activities and inspector evidence.
- The graph must not imply causality that is absent from the explanation or recorded evidence, and must disclose disconnected or uncertain regions when relations are unavailable.

### 4. Realtime update stream

**Current events**:

- `runtime.summary.updated`
- `runtime.explanation.updated`
- `graph.snapshot.created`
- `interrupt.created`
- `interrupt.decided`
- `interrupt.resumed`

**Required guarantees**:

- Realtime payloads are only applied to the currently selected frame when their branch and sequence align.
- A later update must not silently overwrite a historical frame selection.

## Cross-Surface Invariants

1. Summary, sidebar, current-event, graph, timeline, and inspector must resolve from the same `{ mission_id, branch_id, sequence_num, as_of_timestamp, projection_version }` frame tuple.
2. `RuntimeSummary.sequence_num` must equal `RuntimeExplanationProjection.as_of_sequence_num` and `RuntimeSummary.generated_at` must equal the frame's `as_of_timestamp` for the paired response shown in the UI.
3. The UI must not reconstruct explanation meaning from recorded replay events when the authoritative explanation payload is absent.
4. Cross-view activity context must agree on one frame-scoped authority state: `overview`, `selected`, or `no_activity`. When the state is `selected` by default, summary, sidebar, current-event, graph, timeline, and inspector all disclose the same `selection_basis`; when the state is `overview` or `no_activity`, no surface may retain a stale prior activity as authoritative.
5. Cross-view focus uses `activity.id` as the stable synchronization key when the authority state is `selected`. Activity identity MUST prefer an applicable `tool_call_id`, LLM request ID, retrieval request ID, interrupt ID, workflow step ID, or artifact ID; span or event ID is fallback-only, and one span may contain multiple activities.
6. Timing overlap alone is insufficient to create a causal relationship, fan-out, parallel group, or convergence relationship in the graph, summary, timeline, sidebar, current-event, or inspector.
7. Missing relationship evidence and hidden-but-recorded relationship context are distinct states. If recorded relationship context is outside the current graph view because of filtering, focus, or zoom, the surface discloses that hidden context and preserves a path to inspect it; it must not describe the activity as isolated or treat the context as not recorded.
8. Explicit terminal lifecycle status, including terminal status on `tool.called` or another start-like event, remains sufficient terminal evidence even when displayable inputs, outputs, or safe-preview values are absent, restricted, or oversized.
9. A historical frame must exclude outcomes, artifacts, retries, or human decisions recorded after its cutoff.
10. Cross-view agreement includes frame identity, `run_status`, runtime phase label and basis, activity-context authority state, default-selection basis when applicable, selected activity identity and status, relationship basis, and evidence-condition classification.
11. Evidence conditions and value conditions render consistently across every surface and permitted evidence-reference path. No explanatory surface may expose redacted, encrypted, permission-denied, or oversized content beyond its permitted safe evidence preview.
12. If a story element cannot be faithfully represented in a surface, that surface discloses the incompatibility and links to a supporting surface or evidence route.
13. Optional workload decoration may improve labels but must not redefine activity kind, identity, lifecycle, outcome, topology, or provenance.

## Test Expectations

- Engineering acceptance tests prove invocation-first activity identity, fallback-only span or event identity, multiple activities within one span, truthful activity construction, retry separation, safe-preview enforcement, historical-frame correctness, and that sibling overlap without explicit evidence never creates causal edges.
- API/store tests prove frame-aware transport and update behavior, including `as_of_timestamp`, `run_status`, phase-basis agreement, frame-overview versus selected-activity authority, default-selection basis, and stale-selection clearing.
- Web contract tests prove summary, sidebar, current-event, timeline, graph, and inspector stay aligned to the same payload, disclose incompatible or omitted story elements honestly, distinguish hidden recorded graph context from not-recorded relationship evidence, honor terminal-status sufficiency without displayable I/O, and do not backfill missing meaning client-side.
- Engineering validation uses one BSOps update or diagnosis corpus, one generic HITL corpus, and one sparse or conflict-heavy corpus with disconnected and incompatible-view cases.
- Comparative usability studies remain optional product validation unless explicitly added to sprint scope.
