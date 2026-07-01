# Data Model: Coherent Runtime Execution Story

## Runtime Frame

Represents the single immutable point of view that every Run UI surface must share.

| Field | Type | Description | Validation |
|---|---|---|---|
| `mission_id` | string | Run identifier. | Required; stable across all related views. |
| `branch_id` | string | Active branch or execution path identifier. | Required; must match the selected replay branch. |
| `sequence_num` | integer | Ledger cutoff for the frame. | Required; `>= 0`; no surface may show evidence after this cutoff. |
| `as_of_timestamp` | ISO-8601 string | Timestamp of the latest included evidence. | Required; must come from evidence at or before `sequence_num`. |
| `projection_version` | string literal | Version of the explanation contract. | Required; used to prevent mixing incompatible projections. |

## Run Status

Represents the single authoritative displayed overall state for the selected frame.

| Field | Type | Description | Validation |
|---|---|---|---|
| `label` | enum | `Active`, `Waiting`, `Completed`, `Failed`, or `Unknown`. | Required; exactly one value per frame. |
| `evidence_refs` | Evidence Reference[] | Supporting evidence for the displayed status when available. | Required unless the status is `Unknown`; when `Unknown`, evidence or a consistency flag must explain why. |

## Runtime Phase

Represents the current or final phase label shown for the selected frame.

| Field | Type | Description | Validation |
|---|---|---|---|
| `id` | string | Stable phase identifier within the frame. | Required. |
| `label` | enum | Workload-neutral phase label. | Required; MUST be one of `Queued`, `Active Work`, `Waiting`, `Converging`, `Completed`, `Failed`, or `Unknown`. |
| `basis` | enum | `recorded`, `derived`, or `unknown`. | Required; basis explains how the fixed phase label was obtained. |
| `start_sequence_num` | integer | First sequence included in the phase window when known. | Optional; non-negative. |
| `end_sequence_num` | integer | Terminal sequence of the phase window when known. | Optional; must be `>= start_sequence_num` when both exist. |
| `evidence_refs` | Evidence Reference[] | Supporting evidence for the phase label or derivation. | Required for `recorded` and `derived`; empty only for `unknown`. |

## Run Explanation

Workload-neutral explanation of the run at one runtime frame.

| Field | Type | Description | Validation |
|---|---|---|---|
| `frame` | Runtime Frame | Shared frame identity. | Required. |
| `run_status` | Run Status | Authoritative displayed overall state for the selected frame. | Required; must be derived only from evidence visible at the frame. |
| `phase` | Runtime Phase | Current or final phase for the selected frame. | Required; use basis `unknown` when no deterministic phase is available. |
| `progress_markers` | Progress Marker[] | Optional subordinate markers that explain recorded ordering or transitions without becoming a second phase authority. | Optional; all emitted markers must be evidence-backed and deterministic for the same frame. |
| `run_duration_ms` | integer | Duration when terminal timing is known. | Optional; non-negative. |
| `activities` | Runtime Activity[] | Ordered meaningful units of work visible at the frame. | Required; one attempt/invocation per activity id. |
| `relations` | Activity Relationship[] | Evidence-backed links between activities. | Required; no timing-only causality. |
| `parallel_groups` | Parallel Group[] | Proven concurrent sibling work. | Optional; emitted only when concurrency is supported. |
| `merge_groups` | Merge Group[] | Proven convergence from prior concurrent work. | Optional; emitted only when downstream linkage is supported. |
| `consistency_flags` | Evidence Condition[] | Missing, contradictory, ambiguous, or otherwise limited evidence. | Required when relevant; never replaced by fabricated facts. |

## Runtime Activity

One meaningful invocation or lifecycle-coalesced unit of work.

| Field | Type | Description | Validation |
|---|---|---|---|
| `id` | string | Stable activity identity. | Required; MUST prefer the applicable `tool_call_id`, LLM request ID, retrieval request ID, interrupt ID, workflow step ID, or artifact ID. Span or event ID is permitted only as a fallback. |
| `kind` | enum | `agent`, `workflow`, `tool`, `llm`, `retrieval`, `memory`, `artifact`, `human`, `checkpoint`. | Required; must remain workload-neutral. |
| `title` | string | Readable activity label. | Required. |
| `subtitle` | string | Secondary label such as operation name. | Optional. |
| `primary_phrase` | string | Deterministic operator-facing story phrase. | Required for any activity rendered in the concise story; must use recorded actor, action, target, outcome, or evidence-role fields when available. |
| `target` | string | The thing acted on when recorded. | Optional. |
| `action` | string | Generic action description. | Required. |
| `status` | enum | `active`, `waiting`, `completed`, `failed`. | Required; derived from lifecycle evidence at the frame. |
| `outcome` | string | Recorded or faithfully derived child-activity outcome. | Optional; must remain distinct from `run_status`. |
| `evidence_role` | string | Why the activity matters to the story, when recorded. | Optional. |
| `story_relevance` | enum | `major`, `supporting`, or `background`. | Required; must be stable for the same frame and evidence. |
| `story_basis` | enum[] | Why the activity is highlighted in the concise story. | Required for `major`; values include `phase_boundary`, `failure_or_wait`, `retry_attempt`, `fan_out_or_merge`, `human_decision`, `produced_output`, `duration_representative`, and `disconnected_region`. |
| `actor` | string | Agent or system actor when recorded. | Optional. |
| `started_at` | ISO-8601 string | First known start time. | Optional; may be absent for orphan terminal evidence. |
| `ended_at` | ISO-8601 string | Terminal time when known. | Optional; must not precede `started_at`. |
| `duration_ms` | integer | Calculated runtime. | Optional; non-negative. |
| `source_span_id` | string | Source span anchor for evidence correlation. | Optional. |
| `parent_span_id` | string | Parent span anchor when recorded. | Optional. |
| `sequence_num` | integer | Earliest sequence at which the activity is visible. | Optional; used for ordering. |
| `inputs` | map | Recorded input summaries or evidence value conditions. | Optional; must distinguish missing, empty, redacted, encrypted, and oversized states. |
| `outputs` | map | Recorded output summaries or evidence value conditions. | Optional; must distinguish missing, empty, redacted, encrypted, and oversized states. |
| `error` | map | Recorded failure or wait detail or evidence value conditions. | Optional; must distinguish absent vs empty vs redacted vs inconsistent. |
| `artifacts` | list | Artifact outputs associated with the activity. | Optional. |
| `evidence_refs` | Evidence Reference[] | Stable links back to ledger evidence. | Required for every explained fact. |

## Operator-Facing Activity Record

Shared operator-facing record consumed by summary, current-event, graph, timeline, and inspector for a selected or story-critical activity.

| Field | Type | Description | Validation |
|---|---|---|---|
| `activity_id` | string | Activity this record describes. | Required; must resolve within the selected frame. |
| `actor` | string or Evidence Value Condition | Recorded actor or an explicit insufficiency condition. | Required as a field; value or condition must be present. |
| `action` | string or Evidence Value Condition | Recorded action or an explicit insufficiency condition. | Required as a field; value or condition must be present. |
| `target` | string or Evidence Value Condition | Recorded target or an explicit insufficiency condition. | Required as a field; value or condition must be present. |
| `status_or_outcome` | string or Evidence Value Condition | Lifecycle status or outcome for operator use. | Required as a field; value or condition must be present. |
| `trigger` | map or Evidence Value Condition | Upstream trigger summary. | Required as a field; value or condition must be present. |
| `input` | map or Evidence Value Condition | Recorded input summary. | Required as a field; value or condition must be present. |
| `output` | map or Evidence Value Condition | Recorded output summary. | Required as a field; value or condition must be present. |
| `downstream_effect` | map or Evidence Value Condition | Downstream work or effect summary. | Required as a field; value or condition must be present. |
| `artifacts` | list or Evidence Value Condition | Produced artifacts or their insufficiency condition. | Required as a field; value or condition must be present. |
| `evidence_condition` | Evidence Condition[] | Conditions limiting interpretation of this record. | Required when any field is incomplete, missing, restricted, or inconsistent. |
| `evidence_refs` | Evidence Reference[] | Supporting evidence for the record. | Required. |

### Operator-Facing Activity Record Rules

- Every authoritative selected activity and every story-critical activity must have exactly one operator-facing activity record for the selected frame.
- Field-level conditions must distinguish `not_recorded`, `unavailable`, `absent`, `recorded_empty`, `redacted`, `encrypted`, `permission_denied`, `oversized`, and `inconsistent`.
- Primary labels and concise story phrases must use the record's recorded `actor`, `action`, `target`, `status_or_outcome`, or `evidence_role` facts when available. `Workflow step`, `Agent invoked`, `Tool called`, `Retrieval searched`, and `Workflow advanced` remain fallback labels only.

### Activity Lifecycle Rules

- An activity may appear without `started_at` when only terminal evidence exists; this must emit an evidence condition instead of inventing a start.
- One span may contain multiple activities when distinct invocation-level identifiers are recorded.
- Retries are separate activities when invocation identity differs, even if parent operation or labels match.
- `waiting` is distinct from `failed` and `active`; it represents an unresolved human or external pause at the selected frame.

## Progress Marker

Optional marker that helps explain sequence, transition, wait, fan-out, convergence, decision, or output without becoming a second phase authority.

| Field | Type | Description | Validation |
|---|---|---|---|
| `id` | string | Stable marker identifier within the frame. | Required. |
| `kind` | enum | `ordering`, `transition`, `wait`, `fan_out`, `convergence`, `decision`, or `output`. | Required; must remain workload-neutral. |
| `label` | string | Operator-facing marker text. | Required; deterministic for the same evidence and frame. |
| `sequence_num` | integer | Primary sequence anchor for marker ordering. | Required; non-negative. |
| `activity_ids` | string[] | Activities referenced by the marker. | Optional; every referenced id must resolve within `activities`. |
| `evidence_refs` | Evidence Reference[] | Supporting evidence for the marker. | Required. |

## Activity Relationship

Evidence-backed connection between two activities.

| Field | Type | Description | Validation |
|---|---|---|---|
| `id` | string | Stable relationship identifier. | Required. |
| `source_activity_id` | string | Upstream activity. | Required. |
| `target_activity_id` | string | Downstream activity. | Required. |
| `basis` | enum | `parent_span`, `trigger_reference`, `decision_reference`, or another explicit recorded linkage. | Required; timing overlap alone is insufficient. |
| `evidence_refs` | Evidence Reference[] | Supporting evidence for the relationship. | Required. |

## Parallel Group

Derived grouping for concurrent sibling work that is supported by evidence.

| Field | Type | Description | Validation |
|---|---|---|---|
| `id` | string | Stable parallel-group id. | Required. |
| `activity_ids` | string[] | Concurrent activities. | Required; minimum length 2. |
| `basis` | enum | Why the group is considered concurrent. | Required; must be evidence-backed. |
| `evidence_refs` | Evidence Reference[] | Supporting references. | Required. |

## Merge Group

Derived grouping for convergence after prior parallel work.

| Field | Type | Description | Validation |
|---|---|---|---|
| `id` | string | Stable merge-group id. | Required. |
| `predecessor_activity_ids` | string[] | Upstream activities that converge. | Required; minimum length 2. |
| `downstream_activity_id` | string | Activity reached after convergence. | Required. |
| `parallel_group_id` | string | Related parallel group. | Required when merge is proven from parallel work. |
| `evidence_refs` | Evidence Reference[] | Supporting references. | Required. |

## Evidence Reference

Stable route from a rendered fact back to recorded evidence.

| Field | Type | Description | Validation |
|---|---|---|---|
| `event_id` | string | Event identifier. | Required. |
| `sequence_num` | integer | Event sequence. | Required. |
| `timestamp` | ISO-8601 string | Event timestamp. | Required. |
| `branch_id` | string | Branch containing the evidence. | Required. |
| `span_id` | string | Span anchor when present. | Optional. |
| `source_event_id` | string | Upstream source-event link when present. | Optional. |

## Evidence Condition

Structured explanation of why the story is partial, ambiguous, or limited.

| Field | Type | Description | Validation |
|---|---|---|---|
| `code` | string | Machine-readable condition code. | Required. |
| `severity` | enum | `info`, `warning`, or stronger policy-defined severity. | Required. |
| `message` | string | Operator-readable disclosure. | Required. |
| `activity_id` | string | Related activity when scoped. | Optional. |
| `relation_id` | string | Related relationship when scoped. | Optional. |
| `evidence_refs` | Evidence Reference[] | Evidence supporting the condition. | Required. |

## Compatibility Contract

Defines how evolved runtime-story payloads remain safe for older consumers.

| Field | Type | Description | Validation |
|---|---|---|---|
| `projection_version` | string | Served runtime explanation version such as `runtime_explanation.v1` or `runtime_explanation.v2`. | Required. |
| `compatibility_mode` | enum | `native`, `downgraded`, or `legacy`. | Required. |
| `fallback_notes` | string[] | Disclosures about fields or semantics omitted for older consumers. | Required when `compatibility_mode` is not `native`. |

## Evidence Value Condition

Structured explanation of why a particular value cannot be shown as an ordinary recorded summary.

| Field | Type | Description | Validation |
|---|---|---|---|
| `kind` | enum | `missing`, `recorded_empty`, `redaction`, `encrypted`, `oversized`, `unavailable_in_view`, or `inconsistent`. | Required. |
| `message` | string | Operator-readable disclosure for the value state. | Required. |
| `metadata` | map | Permitted metadata such as byte count, content type, or preview limit. | Optional; must not leak protected content. |
| `evidence_refs` | Evidence Reference[] | Evidence supporting the condition. | Required. |

## Domain Decoration

Optional workload-specific labeling or context layered on top of the generic runtime story.

| Field | Type | Description | Validation |
|---|---|---|---|
| `label_overrides` | map | Optional display-only naming. | Must not change activity identity or kind. |
| `context_badges` | list | Optional workload hints. | Must remain subordinate to the generic explanation. |
| `evidence_refs` | Evidence Reference[] | Source for the decoration when it is evidence-backed. | Recommended. |

## View Selection Context

Shared client state for synchronized navigation across summary, current-event, sidebar, graph, timeline, and inspector.

| Field | Type | Description | Validation |
|---|---|---|---|
| `frame` | Runtime Frame | Current shared frame. | Required. |
| `selected_activity_state` | enum | Activity-context authority state for the frame. | Required; MUST be `overview`, `selected`, or `no_activity`. `overview` is permitted even when selectable activities exist. `selected` requires one authoritative selected activity. `no_activity` is reserved for frames with no selectable activities. |
| `selection_basis` | string | Visible basis for a default selected activity. | Optional; REQUIRED when `selected_activity_state = selected` and the selection was chosen by the UI rather than explicit operator input, such as `latest_event` or `current_event`. Prohibited for `no_activity`. |
| `selected_activity_id` | string | Focused activity. | Required when `selected_activity_state = selected`; prohibited when `selected_activity_state = overview` or `selected_activity_state = no_activity`; when present, must resolve within `frame.activities`. |
| `selected_node_id` | string | Graph node anchor for rendering. | Optional. |
| `selected_evidence_ref` | Evidence Reference | Permitted evidence-reference target. | Optional; must belong to the selected frame and preserve all authorization and safe-preview restrictions. |

### View Selection Context Rules

- No frame may retain a stale `selected_activity_id` from an earlier frame.
- `overview` means the frame is intentionally shown without an authoritative selected activity, even if selectable activities exist.
- `no_activity` means the frame exposes no selectable activities and all stale prior selection authority must be cleared.
- Current-event, summary, graph, timeline, sidebar, and inspector must consume the same `selected_activity_state`, `selection_basis`, and `selected_activity_id` for the same frame.
