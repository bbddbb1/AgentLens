# Feature Specification: Coherent Runtime Execution Story

**Feature Branch**: `master` (no branch-creation hook configured)

**Created**: 2026-06-29

**Status**: Draft

**Input**: User description: "Improve AgentLens so that operators can more easily understand and debug complex multi-agent runtime executions. Make the Run UI feel like a coherent execution story across summary, graph, timeline, and inspector, using BSOps update/diagnosis runs as the primary golden scenario while preserving AgentLens as a generic runtime observability and debugging product."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Understand a Run at a Glance (Priority: P1)

An operator opens a current or completed run and sees a concise, coherent account of its purpose-neutral runtime progression: the run state, current or final phase, major participants, important workflow activities, significant outcomes, and any waits or failures.

**Why this priority**: The product goal is not met if an operator must reconstruct the run by reading low-level recorded fragments before understanding what happened.

**Independent Test**: Present a previously unseen complex run to an operator with the summary as the entry point. The story is successful if the operator can identify the authoritative run status, authoritative current or final runtime phase, principal agent responsibilities, and the most important activities without opening detailed permitted recorded evidence.

**Acceptance Scenarios**:

1. **Given** a completed multi-agent run with workflow, tool, retrieval, and model activities, **When** an operator opens the run, **Then** the operator sees one authoritative completed status, one authoritative current or final runtime phase, responsible agents, operator-facing activity phrases, optional progress markers, and the final outcome.
2. **Given** an active run, **When** an operator opens the run, **Then** summary, sidebar, current-event, graph, timeline, and inspector present the same authoritative status and runtime phase for the selected frame or explicitly disclose that they cannot represent them.
3. **Given** a run whose available evidence is incomplete, **When** an operator opens the run, **Then** unavailable facts are disclosed as missing or unknown and are not presented as recorded facts.
4. **Given** recorded actor, action, target, outcome, or evidence-role fields, **When** an important activity appears in the primary story, **Then** its phrase uses those fields and does not rely only on span names, telemetry event names, or generic labels such as "Workflow step" or "Tool called."
5. **Given** an active run containing completed child activities, **When** an operator opens or selects one of those activities, **Then** the run remains labeled with its authoritative run status while the child is separately labeled with its completed activity outcome.

---

### User Story 2 - Follow Execution Across Views (Priority: P2)

An operator moves between summary, graph, timeline, and inspector while retaining the same execution context and understanding how an activity relates to its trigger, concurrent work, downstream work, and outcome.

**Why this priority**: Each view currently exposes useful fragments, but debugging requires them to tell the same story and preserve a shared point in the execution.

**Independent Test**: Select an important activity from each supported surface in turn. Every surface must adopt the same authoritative selected activity for that frame, show the nearest representable equivalent, or disclose incompatibility; no surface may retain a previous selection as authoritative.

**Acceptance Scenarios**:

1. **Given** an activity shown in any execution surface, **When** the operator selects it, **Then** summary, sidebar, current-event, graph, timeline, and inspector share one authoritative selected activity for the selected runtime frame and no surface continues presenting a previous selection as authoritative.
2. **Given** a selected activity with recorded relationship evidence, **When** the operator inspects it in the graph, **Then** enough surrounding context remains visible to understand its parent or trigger, relevant siblings or parallel group, downstream work, and convergence when recorded.
3. **Given** an operator viewing a historical point in a run, **When** the operator changes views, **Then** no view silently switches to the final run state or combines data from a different frame.
4. **Given** a selected activity with no recorded relationship evidence, **When** the operator inspects it in the graph, **Then** the activity is disclosed as isolated or uncertain without hiding the rest of the selected frame.
5. **Given** repeated tool, retrieval, or LLM invocations, **When** the operator moves among summary, graph, timeline, and inspector, **Then** each invocation remains distinguishable from the others.
6. **Given** recorded relationships that are outside the current graph view because of filtering, focus, or zoom, **When** the operator inspects the selected activity, **Then** the UI discloses that related context exists but is currently hidden and does not describe the activity as isolated.
7. **Given** a selected frame before an explicit operator selection, **When** the Run UI establishes its activity context, **Then** it shows either a clearly labeled frame-overview state or exactly one authoritative default selected activity. If a default is selected, the basis—such as latest event or current event—is visible, and no selection from a previous frame remains authoritative.

---

### User Story 3 - Diagnose Failures, Waits, and Missing Evidence (Priority: P3)

An operator investigating a problem can quickly locate the first relevant failure, human wait, incomplete activity, or evidence gap and understand the recorded input, output, error, artifact, and surrounding execution context.

**Why this priority**: Readability is valuable, but the feature must also reduce the time and effort required to debug real runtime problems.

**Independent Test**: Use runs containing a failed activity followed by a retry, a human wait, a missing lifecycle event, and a redacted payload. The operator must be able to distinguish each condition and reach a permitted evidence reference or safe evidence preview without treating absence or redaction as a successful empty value.

**Acceptance Scenarios**:

1. **Given** a child activity that fails and is later retried successfully, **When** the operator inspects the run, **Then** both attempts and their outcomes are understandable and the overall run outcome is not incorrectly derived from the failed attempt alone.
2. **Given** a run waiting for human input, **When** the operator inspects the run, **Then** the wait, the activity that requested it, and the recorded reason are visible without implying a later decision.
3. **Given** missing, contradictory, or redacted evidence, **When** the operator inspects the affected activity, **Then** the UI distinguishes missing, inconsistent, and deliberately hidden information and provides a permitted evidence reference or safe evidence preview.
4. **Given** a selected or story-critical activity, **When** the operator inspects its activity record, **Then** actor, action, target, status or outcome, trigger, input, output, downstream effect, artifacts, and evidence condition are shown when recorded and permitted, and every unavailable field discloses its specific evidence condition.
5. **Given** an activity without enough recorded actor, action, target, or outcome information, **When** it is promoted as story-critical, **Then** the UI discloses the missing information that limits interpretation.
6. **Given** a closed span with an end time, no recorded failure evidence, and telemetry status `UNSET`, **When** the activity is explained, **Then** it is presented as completed rather than active and the absence of an explicit success status may be disclosed.
7. **Given** a tool lifecycle event named `tool.called` that records an explicit terminal tool status, **When** the activity is explained, **Then** that status is sufficient completion evidence. Recorded input, output, result count, error, or safe-preview evidence may enrich the activity record, but missing or undisplayable input or output MUST NOT cause the completed activity to appear active.

---

### User Story 4 - Validate Generic Use Across Workloads (Priority: P4)

An operator receives the same quality of runtime explanation for BSOps and non-BSOps multi-agent runs without encountering BSOps-specific core activity types or requiring BSOps-specific product behavior.

**Why this priority**: BSOps is the primary complexity test, but allowing it to define the core experience would undermine AgentLens as a general runtime observability product.

**Independent Test**: Run the same operator comprehension and debugging tasks against one representative BSOps update/diagnosis run and at least two non-BSOps multi-agent runs. All must use the same generic runtime concepts and interaction model.

**Acceptance Scenarios**:

1. **Given** a BSOps update or diagnosis run, **When** an operator opens it without optional domain decoration, **Then** the generic execution story remains sufficient to understand runtime progression, participants, major activities, waits, failures, and outputs.
2. **Given** a non-BSOps multi-agent run, **When** an operator opens it, **Then** the same summary, graph, timeline, inspector, evidence, and missing-information behaviors are available.
3. **Given** workload-specific telemetry, **When** it cannot be expressed as a generic runtime fact, **Then** it remains available as domain decoration or permitted recorded evidence and does not alter core activity identity, lifecycle, outcome, causality, or topology.

### Edge Cases

- A run contains no explicit workflow root, goal, or phase evidence.
- A run is still active while some child activities have completed or failed.
- A failed child activity is retried and the run later succeeds.
- Multiple tool or model invocations are recorded within one parent operation.
- Activities overlap in time but have no recorded causal relationship.
- A fan-out has no explicit convergence evidence, or a convergence has incomplete upstream evidence.
- Events arrive late, out of order, or with conflicting timestamps or lifecycle states.
- An activity has a completion event but no start event, or a start event but no terminal event.
- A branch inherits earlier evidence but must exclude evidence after its fork point.
- The selected historical frame predates a final run outcome, artifact, human decision, or retry.
- Inputs, outputs, or errors are absent, empty, redacted, encrypted, or too large for a readable preview.
- Workload-specific events have no generic runtime interpretation.
- No activities can be confidently related to one another.
- An activity or relation is available in one view but not representable in another.
- A surface cannot faithfully represent the authoritative status, runtime phase, or selected activity for the selected frame.
- The selected activity has relationship evidence that is only partially representable in the graph.
- The only available activity labels are span names, telemetry event names, or generic activity-kind labels.
- Progress markers are unavailable even though the current or final runtime phase is known.
- Repeated tool, retrieval, or LLM invocations share one span but have distinct invocation-level identifiers.
- A selected or story-critical activity has only some of the required operator-facing activity-record fields.
- An activity has insufficient recorded actor, action, target, or outcome information to support a strong story-critical interpretation.
- A run remains active because run-level terminal evidence is absent while one or more child activities are completed.
- A closed span has an end time and telemetry status `UNSET` but no failure, cancellation, or error evidence.
- A lifecycle event has a start-like event name and an explicit terminal status but no displayable input or output.
- A span-level record and one or more invocation-level identifiers describe the same recorded operation.
- Recorded graph relationships exist but are outside the current view because of filtering, focus, or zoom.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Summary, sidebar, current-event, graph, timeline, and inspector MUST describe one explicitly selected runtime frame.
- **FR-002**: The Run UI MUST prevent or visibly disclose any attempt to combine information from different runtime frames, including stale status, phase, or selected-activity authority.
- **FR-003**: One selected runtime frame MUST have exactly one authoritative displayed run status and exactly one authoritative displayed current or final runtime phase. Summary, sidebar, current-event, graph, timeline, and inspector MUST present those same values or explicitly disclose that they cannot represent them. Conflicting status or phase values for the same frame are prohibited. Run status and runtime phase MUST remain distinct from the outcome of any individual child activity.
- **FR-004**: Primary node and activity labels MUST use operator-facing phrases built from recorded actor, action, target, outcome, and evidence-role fields when available. Span names, telemetry event names, and generic labels such as "Workflow step," "Agent invoked," "Tool called," "Retrieval searched," and "Workflow advanced" MAY appear only as fallbacks and MUST NOT replace available recorded context.
- **FR-005**: The core execution story and its activity phrases MUST use only deterministic, evidence-backed, workload-neutral runtime concepts. They MUST NOT infer hidden intent, business diagnosis, or BSOps-specific meaning unless that meaning is recorded and shown only as permitted domain decoration.
- **FR-006**: Each explained activity MUST identify, when recorded, who or what performed it, the action and target, lifecycle status, timing, outcome, evidence role, and relevant input or output summary.
- **FR-007**: Repeated lifecycle records for one invocation MUST be presented as one understandable activity, while distinct invocations sharing a parent operation MUST remain distinguishable. Activity identity MUST prefer an applicable invocation-level identifier—`tool_call_id`, LLM request ID, retrieval request ID, interrupt ID, workflow step ID, or artifact ID—over `span_id` or `event_id`. `span_id` or `event_id` MAY be used only as a fallback. One span MAY contain multiple distinct invocation activities, and a span-level record MUST NOT create a competing duplicate activity for an operation already represented by invocation-level identity unless the span records a separate activity of its own.
- **FR-008**: Retries and multiple attempts MUST preserve their individual outcomes and MUST not cause the overall run outcome to be inferred incorrectly. Authoritative run status and runtime phase MUST be labeled as frame-level facts; selected activity status or outcome MUST be labeled separately as an activity-level fact. An active run MUST NOT cause a completed child activity to appear active, and a completed child activity MUST NOT imply that the run is complete.
- **FR-009**: Activity relationships MUST be shown only when supported by recorded evidence; timing overlap alone MUST NOT be presented as causality.
- **FR-010**: Proven concurrent work and convergence MUST be identifiable without implying unsupported ordering or cause-and-effect.
- **FR-011**: A selected runtime frame MUST have either a clearly labeled frame-overview state or exactly one authoritative selected activity. If the UI chooses a default selected activity, it MUST visibly disclose the selection basis, such as latest event or current event. If the frame contains no selectable activities, summary, sidebar, current-event, graph, timeline, and inspector MUST disclose the no-activity frame overview. After explicit selection from summary, graph, timeline, or inspector, every surface MUST focus that activity, show the nearest evidence-backed representable equivalent, or disclose incompatibility. No surface may retain a selection from a previous frame as authoritative.
- **FR-012**: The inspector MUST prioritize the authoritative selected activity's trigger, recorded inputs, recorded outputs, outcome, error or wait reason, downstream activity, and produced artifacts before telemetry identifiers and attributes.
- **FR-013**: The timeline MUST reduce repetitive lifecycle noise while preserving access to the underlying permitted recorded events.
- **FR-014**: Selecting an activity in the graph MUST preserve or disclose the recorded parent or trigger, relevant siblings or parallel group, downstream activity, and convergence required to understand the selected activity. Recorded context hidden by filtering, focus, or zoom MUST be disclosed and inspectable. Missing relationship evidence MUST be disclosed as not recorded or uncertain and MUST remain distinct from recorded relationship evidence that is merely hidden.
- **FR-015**: Every explained fact or relationship MUST provide a permitted evidence reference or safe evidence preview.
- **FR-016**: Missing evidence, inconsistent evidence, and deliberately hidden evidence MUST be represented as distinct conditions and MUST NOT be replaced by fabricated or inferred facts.
- **FR-017**: Redaction and access restrictions applied to recorded inputs, outputs, errors, or artifacts MUST remain effective in every explanatory view and preview.
- **FR-018**: Historical views MUST exclude outcomes, decisions, activities, and artifacts that were not yet available at the selected frame.
- **FR-019**: Sparse or partially instrumented runs MUST degrade to a truthful partial story and disclose important gaps rather than fail or claim completeness.
- **FR-020**: The same recorded evidence and selected frame MUST produce the same authoritative run status, authoritative runtime phase, selected-activity authority, and core execution meaning across all Run UI surfaces.
- **FR-021**: The feature MUST NOT require an AI-generated summary or any new external summarization dependency to provide its core execution story.
- **FR-022**: BSOps MUST NOT be a core dependency, and BSOps-specific names, events, phases, or entities MUST NOT become core runtime activity types.
- **FR-023**: Optional domain-specific decoration MAY improve secondary labels or context, including recorded workload-specific phase names, but MUST NOT change the authoritative core runtime phase, activity identity, lifecycle, outcome, causality, topology, frame, or evidence provenance.
- **FR-024**: Workload-specific information that lacks a generic runtime interpretation MUST remain available as domain decoration or permitted recorded evidence without being promoted into an unsupported core explanation.
- **FR-025**: Existing access to detailed traces, graph data, timeline records, inspector details, permitted evidence references, and safe evidence previews MUST remain available through progressive disclosure.
- **FR-026**: The feature scope MUST remain focused on the Run UI's readability and debugging usefulness and MUST NOT require a BSOps-specific dashboard, a new domain ontology, or a broad product architecture rewrite.
- **FR-027**: A runtime frame MUST be identified by run identity, branch or execution-path identity, sequence cutoff, as-of timestamp, and explanation version; all explanatory surfaces MUST disclose the same frame identity when rendering the same story.
- **FR-028**: The authoritative core runtime phase MUST use exactly one fixed workload-neutral label: `Queued`, `Active Work`, `Waiting`, `Converging`, `Completed`, `Failed`, or `Unknown`. Its basis MUST be disclosed as `recorded`, `derived`, or `unknown`. Recorded workload-specific phase names MAY appear only as secondary domain decoration and MUST NOT redefine core phase, lifecycle, outcome, topology, or provenance.
- **FR-029**: The summary MAY show optional progress markers to explain recorded ordering, transitions, waits, fan-out, convergence, decisions, or outputs. Progress markers MUST remain subordinate to the single authoritative runtime phase and MUST NOT become a second phase authority.
- **FR-030**: If no evidence-backed relationship can be established for an activity or region of the run, the UI MUST render it as isolated, disconnected, or uncertain rather than inventing topology, ordering, or causality, while retaining the surrounding selected-frame context.
- **FR-031**: Late, out-of-order, or contradictory records MUST be ordered by recorded frame membership and sequence cutoff while preserving their original timestamps and MUST surface any timestamp or lifecycle conflicts explicitly.
- **FR-032**: When an authoritative status, runtime phase, selected activity, relation, or evidence condition cannot be faithfully represented in a surface, that surface MUST disclose the incompatibility or omission and provide a path to a supporting surface, permitted evidence reference, or safe evidence preview.
- **FR-033**: Recorded-empty values MUST remain distinguishable from absent values. Redacted, encrypted, oversized, permission-restricted, or otherwise unreadable values MUST disclose their specific condition and preserve access restrictions. No explanatory surface may expose protected content beyond its permitted safe evidence preview; only allowed metadata and permitted evidence references may remain available.
- **FR-034**: Any new runtime explanation or summary semantics that are not backward-compatible with existing consumers MUST be introduced through an explicit versioned contract, documented compatibility impact, migration path, and fallback behavior for older consumers.
- **FR-035**: Repeated tool, retrieval, and LLM invocations MUST remain distinguishable as separate activities in summary, graph, timeline, and inspector, including when multiple invocations share one span.
- **FR-036**: Every authoritative selected activity and every activity promoted as story-critical in summary or graph MUST expose one operator-facing activity record that answers, when recorded and permitted: actor, action, target, status or outcome, trigger, input, output, downstream effect, artifacts, and evidence condition.
- **FR-037**: For every operator-facing activity-record field, the UI MUST explicitly disclose whether information is not recorded, unavailable, redacted, encrypted, permission-denied, oversized, absent, recorded-empty, or inconsistent. A field MUST NOT disappear silently because its value cannot be shown.
- **FR-038**: An activity without sufficient recorded actor, action, target, or outcome information MUST NOT be presented as a strong story-critical item unless the UI also discloses the missing information that limits interpretation.
- **FR-039**: The authoritative displayed run status and runtime phase for a selected frame MUST come from one shared, deterministic, frame-scoped core explanation based only on permitted recorded evidence within that frame. No surface may establish a competing run status or phase from its own node state, event-name interpretation, hover state, or isolated telemetry field.
- **FR-040**: A recorded end time is terminal lifecycle evidence. A closed span with telemetry status `UNSET` and no recorded failure, cancellation, or error evidence MUST be presented as a completed activity, not an active activity. The UI MAY disclose that an explicit success status was not recorded.
- **FR-041**: An event whose name appears start-like, including `tool.called`, MUST be accepted as completion evidence when the same event records an explicit terminal lifecycle status, including terminal `gen_ai.tool.status`. That terminal status is sufficient terminal evidence. Recorded input, output, result count, error, or safe-preview evidence MAY enrich the activity record, but absence or non-displayability of those values MUST NOT override the explicit terminal status.
- **FR-042**: When no relationship evidence was recorded, the graph MUST disclose that the relationship is not recorded or is uncertain and MUST NOT infer topology from timestamps, overlap, proximity, or layout. When relationship evidence exists but is hidden by filtering, focus, or zoom, the graph MUST disclose that related context exists outside the current view and MUST provide a way to inspect that context; it MUST NOT describe the activity as isolated.

### Execution Story Rules

- **Runtime frame authority**: Run identity, branch or execution path, sequence cutoff, as-of time, and explanation version identify the selected frame. One shared, deterministic, frame-scoped core explanation over permitted recorded evidence supplies one authoritative displayed run status and one authoritative displayed current or final runtime phase. Activity context is either a clearly labeled frame overview or exactly one authoritative selected activity. Any default selection MUST disclose its basis, and frame changes MUST clear stale selection authority. Individual surfaces MUST NOT establish competing frame facts.
- **Frame status versus activity outcome**: Run status and runtime phase describe the selected frame. Activity status or outcome describes one invocation. Both MUST remain separately labeled even when an active run contains completed activities.
- **Terminal evidence interpretation**: Recorded terminal evidence takes precedence over start-like event names and non-terminal telemetry defaults. A span end time without failure evidence means the activity is closed; telemetry status `UNSET` does not make that closed activity active. An explicit terminal lifecycle status recorded on `tool.called` or another start-like event is sufficient completion evidence even when input, output, result count, error, or safe-preview values are absent or cannot be displayed.
- **Invocation identity**: Invocation-level identity is authoritative when recorded. A containing span remains supporting evidence or represents a separate activity only when it records independent work; it MUST NOT compete with invocation activities for the same operation.
- **Run status vocabulary**: The authoritative displayed run status MUST be one of `Active`, `Waiting`, `Completed`, `Failed`, or `Unknown`.
- **Runtime phase vocabulary**: The authoritative displayed runtime phase MUST be one of `Queued`, `Active Work`, `Waiting`, `Converging`, `Completed`, `Failed`, or `Unknown`. Its recorded, derived, or unknown basis MUST remain visible.
- **Secondary workload context**: Recorded workload-specific phase names and business context MAY appear as secondary domain decoration only. Removing every domain decoration MUST leave the authoritative status, runtime phase, activity story, and evidence conditions understandable.
- **Progress markers**: Optional progress markers MAY show recorded ordering, transitions, waits, fan-out, convergence, decisions, or outputs. They MUST NOT compete with or replace the authoritative runtime phase.
- **Operator-facing activity phrases**: Important activities MUST be described using recorded actor, action, target, outcome, and evidence-role information when available. "Workflow step," "Agent invoked," "Tool called," "Retrieval searched," and "Workflow advanced" are fallback labels only. A fallback label MUST NOT conceal missing actor, action, target, or outcome information when that absence limits interpretation.
- **Operator-facing activity records**: Every selected or story-critical activity MUST expose actor, action, target, status or outcome, trigger, input, output, downstream effect, artifacts, and evidence condition when recorded and permitted. Each unavailable field MUST remain visible through its specific evidence condition rather than silent omission.
- **Deterministic meaning**: Given the same permitted recorded evidence and selected frame, activity phrases and progress markers MUST have the same meaning. They MUST NOT infer intent, diagnosis, causality, or domain meaning that was not recorded.
- **Progressive disclosure**: If activities or details are omitted from the concise story, the UI MUST disclose that additional recorded work exists and preserve a path to the full permitted activity set and its permitted evidence references.
- **Graph relationship disclosure**: The story MUST preserve or disclose the recorded parent or trigger, relevant siblings or parallel group, downstream activity, and convergence required by the selected-graph context contract. Relationship evidence that was not recorded remains distinct from relationship evidence outside the current graph view. Neither condition permits invented topology; hidden recorded context MUST remain inspectable and MUST NOT be presented as isolation.

### Non-Functional Requirements

- **NFR-001**: On the golden validation corpus, selecting a different activity within an already-loaded frame MUST synchronize summary, sidebar, current-event, graph, timeline, and inspector focus within 250 ms p95 in the reference local inspection environment.
- **NFR-002**: On the golden validation corpus, switching to another already-recorded frame in the same run MUST present a synchronized loading or stale-state disclosure immediately and fully aligned content within 1.0 second p95 in the reference local inspection environment.
- **NFR-003**: The core Run UI flow for selecting an activity, changing frames, switching surfaces, and reaching permitted supporting evidence MUST be keyboard reachable, have a visible focus indicator, and expose authoritative selected activity, run status, runtime phase and basis, and evidence-condition labels to assistive technology.

### Scope and Boundaries

**In scope**:

- A coherent operator-facing execution story across the existing Run UI surfaces.
- Consistent handling of current and historical runtime frames.
- Generic activity lifecycle, responsibility, relationships, concurrency, convergence, outcomes, evidence, and evidence gaps.
- Progressive disclosure from explanation to permitted recorded evidence.
- Validation with complex BSOps and non-BSOps runs.

**Out of scope**:

- A BSOps operations dashboard or BSOps-specific core workflow model.
- New AI-authored run summaries or diagnosis recommendations.
- Inventing business-domain activity categories in AgentLens core.
- Replacing the recorded runtime evidence ledger or treating an explanation as ground truth.
- Broad changes unrelated to Run UI comprehension and debugging.

### Key Entities

- **Runtime Frame**: The immutable point of view for a run, including its run identity, branch or execution path, sequence cutoff, time, and explanation version.
- **Run Status**: The single authoritative displayed overall state of the selected runtime frame, distinct from every child activity status or outcome.
- **Run Phase**: The single authoritative displayed workload-neutral current or final runtime phase at one frame, together with its recorded, derived, or unknown basis.
- **Progress Marker**: An optional evidence-backed marker that helps explain recorded ordering or transitions without becoming a second phase authority.
- **Selected Activity Authority**: The one activity, when activity-selection mode is active, that every surface treats as authoritative for the selected runtime frame. A frame may instead have a clearly labeled frame-overview state. Default selection requires a visible basis, and neither overview nor selection may retain stale authority from another frame.
- **Run Explanation**: The workload-neutral account of run status, timing, major activities, relationships, concurrency, convergence, and consistency at one runtime frame.
- **Runtime Activity**: One meaningful invocation or lifecycle-coalesced unit of work performed by an agent, workflow, tool, model, retrieval system, memory system, artifact producer, human interaction, or checkpoint. Invocation-level identity takes precedence over `span_id` or `event_id`, and one span may support multiple activities.
- **Operator-Facing Activity Phrase**: A deterministic activity description built from permitted recorded actor, action, target, outcome, and evidence-role information.
- **Operator-Facing Activity Record**: The selected or story-critical activity view that exposes actor, action, target, status or outcome, trigger, input, output, downstream effect, artifacts, and evidence condition, including explicit conditions for fields that cannot be shown.
- **Activity Relationship**: A recorded, evidence-backed connection between activities, such as parentage, trigger, or explicit linkage.
- **Permitted Evidence Reference**: An authorization-preserving route from an explained fact to the recorded event or span that supports it.
- **Safe Evidence Preview**: A permitted summary of recorded evidence that preserves authorization, redaction, encryption, and oversized-value restrictions.
- **Evidence Condition**: A structured indication that evidence is missing, inconsistent, redacted, hidden from the current view, or otherwise insufficient for a stronger claim; relationship evidence that was not recorded remains distinct from recorded relationship context hidden by the current graph view.
- **Evidence Value Condition**: A structured indication that a specific recorded value is empty, absent, redacted, encrypted, oversized, or unreadable in the current view.
- **Domain Decoration**: Optional workload-specific labeling or context that remains subordinate to the generic runtime explanation and cannot redefine its core facts.

### Golden Validation Corpus

- **Corpus A - BSOps update/diagnosis**: One representative BSOps run with at least three recorded execution transitions or progress markers, workflow plus tool plus retrieval or model activity, explicit or derivable fan-out and convergence, one failure or human wait, one retry or repeated attempt, and at least one redacted, encrypted, or oversized value condition. Fan-out or convergence is derivable only from recorded relationship evidence, never from timestamp overlap, visual layout, or proximity. This corpus MAY be satisfied by a documented update or diagnosis replay or an equivalent fixture with the same coverage characteristics.
- **Corpus B - Generic HITL multi-agent**: One non-BSOps run with human wait or resume, artifact creation, memory activity, and at least one sparse or partially instrumented region.
- **Corpus C - Generic sparse or conflict-heavy**: One non-BSOps run with late or out-of-order events, missing lifecycle evidence, at least one disconnected activity or relation, and at least one story element that a surface must disclose as unavailable or incompatible.

### Evaluation Protocol

- **Cross-view agreement** means that summary, sidebar, current-event, graph, timeline, and inspector agree on frame identity, authoritative run status, authoritative runtime phase and basis, and activity context: either frame overview or the authoritative selected activity. When a default activity is selected, its basis also agrees across surfaces. A surface may substitute the nearest evidence-backed representable equivalent only when it explicitly discloses the incompatibility.
- **Selected-graph context preservation** means that selecting an activity preserves or discloses the recorded parent or trigger, relevant siblings or parallel group, downstream activity, and convergence when available. Hidden recorded context remains disclosed and inspectable; absent relationship evidence is shown as not recorded or uncertain and is never conflated with hidden context.
- **Operator-facing story quality** means that primary activity phrases use permitted recorded actor, action, target, outcome, or evidence-role information when available and do not consist only of span names, telemetry event names, or generic activity-kind labels.
- **Repeated invocation clarity** means that separate tool, retrieval, and LLM invocation identities remain distinguishable in summary, graph, timeline, and inspector even when they share a span.
- **Activity-record sufficiency** means that every selected or story-critical activity exposes every required field when recorded and permitted, and explicitly identifies the evidence condition for every field that cannot be shown.
- **Standard comprehension question set** consists of the same eight questions for baseline and comparison runs:
  1. What is the run's current or final state?
  2. What is the authoritative current or final runtime phase, and is it recorded, derived, or unknown?
  3. Which participants carried the primary responsibility?
  4. What was the first relevant failure, wait, or evidence gap?
  5. Which activity triggered the selected downstream activity?
  6. Where did parallel work begin and converge, if anywhere?
  7. What output, artifact, or decision mattered most to the run outcome?
  8. Where is the permitted supporting evidence for that conclusion?
- **Comprehension and usability cohort** means 12 operators or reviewers who are familiar with runtime observability but have not previously studied the selected validation runs.
- **Comparative usability baseline** means the pre-feature Run UI evaluated with the same corpus, same question set, same participant cohort, and counterbalanced run order.

## Success Criteria *(mandatory)*

### Hard Engineering Acceptance Gates

- **SC-001**: For every selected frame in the golden validation corpus, summary, sidebar, current-event, graph, timeline, and inspector MUST present exactly one authoritative run status and one authoritative current or final runtime phase, or explicitly disclose inability to represent either value. Any conflicting displayed value is an acceptance failure; an inability disclosure may replace an unavailable value but MUST NOT accompany a contradictory value.
- **SC-002**: Every selected frame MUST expose either a clearly labeled frame-overview state or exactly one authoritative selected activity across summary, sidebar, current-event, graph, timeline, and inspector. A default selection MUST visibly identify its basis, such as latest event or current event. After explicit selection, every applicable surface MUST adopt that activity, show the nearest evidence-backed equivalent with disclosure, or disclose incompatibility. Retaining a stale selection from another frame, hiding a default-selection basis, or presenting competing selected activities is an acceptance failure.
- **SC-003**: Selecting a graph node MUST preserve or disclose all recorded context needed to understand parent or trigger, relevant siblings or parallel group, downstream activity, and convergence. Hidden recorded context MUST remain inspectable, and missing relationship evidence MUST remain explicitly distinct from hidden relationship evidence. Hiding context without disclosure, conflating hidden context with missing evidence, or suppressing the rest of the selected frame is an acceptance failure.
- **SC-004**: Every primary node or activity label MUST use an operator-facing phrase based on permitted recorded actor, action, target, outcome, or evidence-role information when available. A primary label that uses only a span name, telemetry event name, "Workflow step," "Agent invoked," "Tool called," "Retrieval searched," or "Workflow advanced" when stronger recorded context exists is an acceptance failure.
- **SC-005**: Across all historical and branched-frame tests, 100% of surfaces MUST exclude later statuses, phases, selections, outcomes, decisions, retries, activities, and artifacts that were not yet recorded at the selected frame.
- **SC-006**: Across all missing, inconsistent, redacted, encrypted, oversized, permission-restricted, and unavailable-evidence scenarios, 100% of surfaces MUST avoid presenting unavailable information as recorded fact and MUST preserve the correct evidence condition and permitted access boundary.
- **SC-007**: Corpus A, Corpus B, and Corpus C MUST each satisfy the same frame authority, status and phase authority, selected-activity authority, invocation identity, repeated-invocation clarity, graph-context, phrase-quality, activity-record sufficiency, historical-exclusion, evidence-condition, and debugging requirements without BSOps-specific core activity or phase types.
- **SC-008**: For every explained activity and relationship in the golden validation corpus, an operator MUST be able to reach a permitted evidence reference or safe evidence preview in no more than two interactions.
- **SC-009**: Repeated tool, retrieval, and LLM invocations MUST remain distinguishable in summary, graph, timeline, and inspector. Merging separate invocation identities or presenting them as an indistinguishable repeated label is an acceptance failure.
- **SC-010**: Every selected or story-critical activity MUST expose the complete operator-facing activity record when fields are recorded and permitted. Silent omission of an unavailable field, or strong story-critical promotion without disclosure of insufficient actor, action, target, or outcome information, is an acceptance failure.
- **SC-011**: For every selected frame, all surfaces MUST obtain authoritative run status and runtime phase from the same frame-scoped core explanation and MUST label those frame facts separately from selected activity status or outcome. A completed child displayed as active because the run remains active, or a run displayed as complete because a child completed, is an acceptance failure.
- **SC-012**: Every closed-span scenario with an end time, telemetry status `UNSET`, and no failure, cancellation, or error evidence MUST display the activity as completed rather than active. Treating `UNSET` as evidence that the closed activity remains active is an acceptance failure.
- **SC-013**: Every lifecycle scenario in which `tool.called` or another start-like event records an explicit terminal status, including terminal `gen_ai.tool.status`, MUST treat that event as completion evidence whether or not displayable input, output, result count, error, or safe-preview evidence is present. Ignoring terminal status because of the event name or missing displayable values is an acceptance failure.
- **SC-014**: When invocation-level identity and a containing span describe the same operation, the UI MUST expose only the invocation activity as authoritative and retain the span as supporting evidence. Duplicate or competing span-level and invocation-level activities for the same operation fail acceptance; distinct invocation identities within one span MUST remain separate.
- **SC-015**: Graph validation MUST distinguish relationship evidence that was not recorded from recorded relationships hidden by filtering, focus, or zoom. Hidden recorded relationships MUST remain inspectable. Inventing missing topology, describing hidden recorded relationships as isolation, or failing to disclose and preserve access to hidden related context is an acceptance failure.

### Non-Blocking Product Validation Goals

These goals measure product usefulness but do not block engineering acceptance for this sprint unless formal UX research is explicitly included in sprint scope.

- **PVG-001**: In a first-use comprehension study, at least 80% of participants identify the authoritative run status, authoritative runtime phase, principal responsibilities, and most important activities within 60 seconds without opening detailed permitted recorded evidence.
- **PVG-002**: At least 90% of participants locate the first relevant failure, wait, or explicitly disclosed evidence gap within 2 minutes in representative complex runs.
- **PVG-003**: With the 12-person cohort and comparative baseline defined in Evaluation Protocol, median time to answer the standard eight-question comprehension set improves by at least 40%.

## Assumptions

- Operators already have permission to view the run and its permitted evidence; this feature does not redefine authorization.
- Existing telemetry remains the source of truth, and explanation quality is bounded by the completeness and correctness of recorded evidence.
- The current Run UI surfaces—summary, sidebar, graph, timeline, inspector, and permitted recorded evidence—remain the primary interaction model.
- BSOps update/diagnosis runs provide the primary complex golden data set, supplemented by at least two structurally different non-BSOps multi-agent data sets.
- A selected runtime frame includes enough identity and cutoff information to keep current, historical, and branched views distinct.
- Existing authorization, redaction, encryption, and data-handling rules apply equally to explanatory summaries, permitted evidence references, and safe evidence previews.
- Workload-specific decoration is optional; the generic execution story must remain useful when all such decoration is absent.
- The reference local inspection environment used for NFR timing checks is documented alongside the chosen validation corpus so results are reproducible.
- This specification does not introduce a separate long-running analysis step; any synchronized story must still be produced from the selected frame's recorded evidence.
