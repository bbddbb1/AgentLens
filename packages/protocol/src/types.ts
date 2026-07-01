export type NodeType = 'agent' | 'task' | 'tool' | 'human' | 'memory' | 'team' | 'artifact';
export type NodeStatus = 'idle' | 'active' | 'completed' | 'failed' | 'waiting' | 'reviewing';
export type EdgeType = 'dependency' | 'uses' | 'delegation' | 'critique' | 'review' | 'escalation' | 'data_flow' | 'approval' | 'member_of' | 'produces';
export type EdgeStatus = 'pending' | 'active' | 'completed' | 'failed';

/** Framework- and workload-neutral activity classes derived from runtime evidence. */
export type RuntimeActivityKind =
  | 'agent'
  | 'tool'
  | 'llm'
  | 'retrieval'
  | 'workflow'
  | 'memory'
  | 'artifact'
  | 'human'
  | 'checkpoint'
  | 'runtime';

export type RuntimeExplanationProjectionVersion = 'runtime_explanation.v1';
export type RuntimeExplanationActivityKind =
  | 'agent'
  | 'workflow'
  | 'tool'
  | 'llm'
  | 'retrieval'
  | 'memory'
  | 'artifact'
  | 'human'
  | 'checkpoint';
export type RuntimeExplanationRunOutcome = 'active' | 'waiting' | 'completed' | 'failed';
export type RuntimeExplanationRelationBasis =
  | 'explicit_link'
  | 'trigger_reference'
  | 'decision_reference'
  | 'parent_span';
export type RuntimeExplanationConsistencyCode =
  | 'missing_start'
  | 'orphan_terminal'
  | 'duplicate_terminal'
  | 'timestamp_conflict'
  | 'dangling_trigger_reference'
  | 'dangling_decision_reference'
  | 'dangling_parent_span'
  | 'ambiguous_parallelism'
  | 'shared_span_multiple_invocations'
  | 'branch_fork_cutoff_conflict'
  | 'incomplete_lifecycle';
export type RuntimeExplanationConsistencySeverity = 'info' | 'warning' | 'error';

export interface RuntimeExplanationEvidenceRef {
  event_id: string;
  sequence_num: number;
  timestamp: string;
  branch_id?: string;
  span_id?: string;
  source_event_id?: string;
}

export interface RuntimeExplanationRedaction {
  kind: 'redaction';
  policy_decision: 'redact';
  reason?: string;
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeExplanationAdvisory {
  kind: 'ai_advisory';
  message: string;
  source: 'ai';
}

export type RuntimeExplanationValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[]
  | RuntimeExplanationRedaction;

export interface RuntimeExplanationRelation {
  id: string;
  source_activity_id: string;
  target_activity_id: string;
  basis: RuntimeExplanationRelationBasis;
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeExplanationParallelGroup {
  id: string;
  activity_ids: string[];
  basis: 'explicit' | 'parent_overlap';
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeExplanationMergeGroup {
  id: string;
  predecessor_activity_ids: string[];
  downstream_activity_id: string;
  parallel_group_id: string;
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeExplanationConsistencyFlag {
  code: RuntimeExplanationConsistencyCode;
  severity: RuntimeExplanationConsistencySeverity;
  message: string;
  activity_id?: string;
  relation_id?: string;
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeExplanationActivity {
  id: string;
  kind: RuntimeExplanationActivityKind;
  title: string;
  subtitle?: string;
  action: string;
  status: RuntimeExplanationRunOutcome;
  outcome?: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
  actor?: string;
  source_span_id?: string;
  parent_span_id?: string;
  sequence_num?: number;
  invocation_id?: string;
  inputs?: Record<string, RuntimeExplanationValue>;
  outputs?: Record<string, RuntimeExplanationValue>;
  error?: Record<string, RuntimeExplanationValue>;
  artifacts?: RuntimeExplanationValue[];
  operator_facing_record?: RuntimeOperatorActivityRecord;
  story_critical?: boolean;
  story_critical_limitation?: string;
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeExplanationProjection {
  mission_id: string;
  branch_id: string;
  as_of_sequence_num: number;
  as_of_timestamp?: string;
  projection_version: RuntimeExplanationProjectionVersion;
  run_outcome: RuntimeExplanationRunOutcome;
  frame?: RuntimeFrame;
  run_status?: RunStatus;
  runtime_phase?: RuntimePhaseSummary;
  progress_markers?: RuntimeProgressMarker[];
  selected_activity_state?: RuntimeSelectedActivityState;
  run_duration_ms?: number;
  activities: RuntimeExplanationActivity[];
  relations: RuntimeExplanationRelation[];
  parallel_groups: RuntimeExplanationParallelGroup[];
  merge_groups: RuntimeExplanationMergeGroup[];
  consistency_flags: RuntimeExplanationConsistencyFlag[];
}

export interface RuntimeFrame {
  mission_id: string;
  branch_id: string;
  sequence_num: number;
  as_of_timestamp: string;
  projection_version: string;
}

export interface RuntimePhaseSummary {
  id: string;
  label: string;
  basis: 'recorded' | 'derived' | 'unknown';
  start_sequence_num?: number;
  end_sequence_num?: number;
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

export type RunStatus = 'Active' | 'Waiting' | 'Completed' | 'Failed' | 'Unknown';
export type RuntimePhaseLabel =
  | 'Queued'
  | 'Active Work'
  | 'Waiting'
  | 'Converging'
  | 'Completed'
  | 'Failed'
  | 'Unknown';
export type RuntimeEvidenceFieldCondition =
  | 'recorded'
  | 'not_recorded'
  | 'unavailable'
  | 'redacted'
  | 'encrypted'
  | 'permission_denied'
  | 'oversized'
  | 'absent'
  | 'recorded_empty'
  | 'inconsistent';

export interface RuntimeActivityField<T = RuntimeExplanationValue> {
  value?: T;
  condition: RuntimeEvidenceFieldCondition;
  evidence_refs?: RuntimeExplanationEvidenceRef[];
}

export interface RuntimeProgressMarker {
  sequence_num: number;
  timestamp: string;
  kind: string;
  text: string;
  actor?: string;
}

export interface RuntimeSelectedActivityState {
  kind: 'overview' | 'selected' | 'no_activity';
  activity_id?: string;
  selection_basis?: string;
  reason?: 'frame_overview' | 'no_selectable_activity' | 'missing_activity' | 'incompatible';
}

export interface RuntimeOperatorActivityRecord {
  primary_label: string;
  actor: RuntimeActivityField<string>;
  action: RuntimeActivityField<string>;
  target: RuntimeActivityField<string>;
  status_or_outcome: RuntimeActivityField<string>;
  trigger: RuntimeActivityField;
  input: RuntimeActivityField;
  output: RuntimeActivityField;
  downstream_effect: RuntimeActivityField;
  artifacts: RuntimeActivityField;
  evidence_condition: RuntimeActivityField<string>;
  story_critical_sufficient: boolean;
  limitation?: string;
}

/**
 * Deterministic L1 projection of one runtime activity. The wording is
 * intentionally universal; workload meaning remains in recorded evidence/L2 lenses.
 */
export interface RuntimeActivity {
  id: string;
  kind: RuntimeActivityKind;
  label: string;
  title?: string;
  subtitle?: string;
  action: string;
  outcome: string;
  status: NodeStatus;
  sequence_num?: number;
  timestamp?: string;
  duration_ms?: number;
  actor?: string;
  source_span_id?: string;
  parent_span_id?: string;
  invocation_id?: string;
  operator_facing_record?: RuntimeOperatorActivityRecord;
  story_critical?: boolean;
  story_critical_limitation?: string;
  provenance: 'projection';
}

/**
 * Presentation profile of a `GraphNode` (ROPS inspector dispatch + field
 * surfacing). NOT runtime identity and NOT part of the runtime ontology:
 * it never alters `NodeType`, graph topology, edges, or node merging/hiding,
 * and it never introduces a synthetic hierarchy. It is derived purely from
 * verbatim span attributes + `operation_name` and exists only to choose which
 * first-class Evidence rows a profile-aware inspector renders. `NodeType` stays
 * the stable runtime union above; the profile is a transport-efficient hint
 * so the web does not re-derive it from `metadata`.
 */
export type ProjectionProfile =
  | 'agent' // invoke_agent span
  | 'llm' // llm.call (gen_ai.system / gen_ai.request.model)
  | 'tool' // execute_tool with gen_ai.tool.name (non-retrieval)
  | 'retrieval' // retrieval.search (retrieval.backend / search.query)
  | 'memory' // memory op
  | 'artifact' // artifact op
  | 'workflow_step' // workflow.step / workflow.transition
  | 'mission' // mission.execute / mission.lifecycle
  | 'checkpoint' // runtime.checkpoint.save / load
  | 'human' // human input
  | 'generic'; // unrecognized — minimal identity/lifecycle view

export interface NodePosition {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  status: NodeStatus;
  position: NodePosition;
  agent_id?: string;
  agent_role?: string;
  agent_team?: string;
  agent_type?: string;
  framework?: string;
  iteration?: number;
  confidence?: number;
  summary?: string;
  span_id?: string;
  trace_id?: string;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  error_count?: number;
  metadata?: Record<string, unknown>;
  maturityTier?: 'L1' | 'L2' | 'L3';
  maturity_tier?: 'L1' | 'L2' | 'L3';
  evidenceSpanId?: string;
  evidence_span_id?: string;
  source_span_id?: string;
  source_event_id?: string;
  /** Presentation profile (ROPS dispatch + field surfacing). See `ProjectionProfile`. */
  projection_profile?: ProjectionProfile;
  /** Universal, deterministic action/outcome identity for L1/L2 presentation. */
  activity?: RuntimeActivity;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  status: EdgeStatus;
  animated?: boolean;
  metadata?: Record<string, unknown>;
  evidenceSpanId?: string;
  evidence_span_id?: string;
  source_span_id?: string;
  source_event_id?: string;
}

export interface GraphSnapshot {
  id: string;
  mission_id: string;
  sequence_num: number;
  timestamp: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  branch_id?: string;
  event_type?: string;
  event_description?: string;
  source_event_id?: string;
  source_event_sequence_num?: number;
  phase?: string;
}

export interface Mission {
  id: string;
  objective: string;
  status: string;
  phase: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  metadata: Record<string, unknown>;
  is_encrypted: boolean;
  visibility: string;
  owner_id?: string;
}

export interface MissionAgent {
  agent_id: string;
  agent_name?: string;
  agent_role?: string;
  agent_team?: string;
}

export interface MissionAggregate {
  mission: Mission;
  agents: MissionAgent[];
  snapshots: GraphSnapshot[];
}

export interface SemanticSummaryResult {
  summary: string;
  conflicts: Array<Record<string, unknown>>;
  anomalies: Array<Record<string, unknown>>;
}

/** A single progressive step in the runtime execution narrative. */
export interface RuntimeSummaryProgressEntry {
  sequence_num: number;
  timestamp: string;
  event_type: string;
  actor?: string;
  text: string;
}

export interface RuntimeSummaryObservation {
  text: string;
  sequence_num?: number;
  actor?: string;
}

export interface RuntimeSummaryDecision {
  text: string;
  sequence_num?: number;
  actor?: string;
}

export interface RuntimeSummaryEvidence {
  text: string;
  source?: string;
  sequence_num?: number;
}

export interface RuntimeSummaryAction {
  text: string;
  sequence_num?: number;
  actor?: string;
  status?: string;
}

export interface RuntimeSummaryPendingWork {
  text: string;
  kind: 'interrupt' | 'waiting' | 'blocked' | 'review';
}

export interface RuntimeSummaryWarning {
  text: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface RuntimeSummaryArtifact {
  name: string;
  type?: string;
  sequence_num?: number;
}

export interface RuntimeSummaryInterrupt {
  interrupt_id: string;
  status: string;
  reason?: string;
  agent_id?: string;
}

export type OutputType =
  | 'memory'
  | 'artifact'
  | 'tool'
  | 'message'
  | 'reflection'
  | 'generated_file'
  | 'patch';

export interface ProducedOutput {
  id: string;
  source: string;
  type: OutputType;
  name: string;
  value?: unknown;
  sequence_num: number;
  timestamp: string;
}

export interface RuntimeEventRef {
  event_type: string;
  sequence_num: number;
  timestamp: string;
  actor?: string;
  object?: string;
  payload?: Record<string, unknown>;
}

export interface RuntimeFactWarning {
  code: string;
  message: string;
  sequence_num: number;
  severity?: 'low' | 'medium' | 'high';
}

export interface NodeProjectionFacts {
  role?: string;
  status: NodeStatus;
  status_label: string;
  produced_outputs: ProducedOutput[];
  next_transition?: { target: string; kind: 'handoff' | 'delegation'; reason?: string };
  pending?: string | null;
  warnings: RuntimeFactWarning[];
  requires_human: boolean;
  agent_id?: string;
  agent_type?: string;
  framework?: string;
  iteration?: number;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  error_count?: number;
  source_span_id?: string;
  source_event_id?: string;
  confidence?: number;
  drift_score?: number;
}

export interface NodeProjectionGenerated {
  projection_version: number;
  prompt_version?: string;
  model?: string;
  source: 'deterministic' | 'llm';
  generated_at: string;
  current_understanding?: string;
  highlights?: string[];
  llm_warnings?: string[];
  suggested_title?: string;
}

/** Per-node runtime state projection — facts separated from generated content. */
export interface RuntimeNodeProjection {
  projection_version: number;
  mission_id: string;
  branch_id: string;
  sequence_num: number;
  generated_at: string;
  agent_id: string;
  name: string;
  node_type: NodeType;
  facts: NodeProjectionFacts;
  generated?: NodeProjectionGenerated;
  recent_runtime_events: RuntimeEventRef[];
}

export interface NodeProjectionEnhancement {
  current_understanding: string;
  highlights?: string[];
  llm_warnings?: string[];
  suggested_title?: string;
}

export interface ProjectNodeStateInput {
  mission_id: string;
  branch_id: string;
  agent_id: string;
  events: MissionEventRecord[];
  up_to_sequence_num?: number;
}

/** @deprecated Use RuntimeNodeProjection */
export interface RuntimeAgentSummary {
  agent_id: string;
  name: string;
  role?: string;
  status: string;
  headline: string;
  objective?: string;
  behavior: string;
  recent_actions: string[];
  pending?: string;
}

/**
 * Operator-oriented runtime summary — a disposable projection over the event ledger.
 * Not canonical state; rebuildable from EventEnvelope records at any time.
 */
export interface RuntimeSummary {
  mission_id: string;
  branch_id: string;
  sequence_num: number;
  generated_at: string;
  frame?: RuntimeFrame;
  objective: string;
  status: string;
  run_status?: RunStatus;
  phase: string;
  current_phase?: RuntimePhaseSummary;
  runtime_phase?: RuntimePhaseSummary;
  major_phases?: RuntimePhaseSummary[];
  headline: string;
  progress: RuntimeSummaryProgressEntry[];
  progress_markers?: RuntimeProgressMarker[];
  /** Compact Runtime Story (normally 5-8 key universal activities). */
  activities?: RuntimeActivity[];
  /** Ordered, concise story selection for the summary surface. */
  story_activities?: RuntimeActivity[];
  selected_activity_id?: string;
  selected_activity_state?: RuntimeSelectedActivityState;
  observations: RuntimeSummaryObservation[];
  decisions: RuntimeSummaryDecision[];
  evidence: RuntimeSummaryEvidence[];
  actions: RuntimeSummaryAction[];
  pending_work: RuntimeSummaryPendingWork[];
  warnings: RuntimeSummaryWarning[];
  artifacts: RuntimeSummaryArtifact[];
  interrupts: RuntimeSummaryInterrupt[];
  agents: RuntimeNodeProjection[];
  nodes?: RuntimeNodeProjection[];
  is_blocked: boolean;
  requires_human: boolean;
  source: 'deterministic' | 'llm';
  background_work?: {
    collapsed: boolean;
    visible_activity_count: number;
    hidden_activity_count: number;
    total_activity_count: number;
    disclosure: string;
  };
  /** Optional LLM-enhanced narrative; projection-only, never authoritative. */
  narrative?: string;
}

export interface ProjectRuntimeSummaryInput {
  mission_id: string;
  branch_id: string;
  objective: string;
  status: string;
  phase: string;
  events: MissionEventRecord[];
  up_to_sequence_num?: number;
}

export interface InterruptRecord {
  id: string;
  mission_id: string;
  interrupt_id: string;
  agent_id?: string;
  span_id?: string;
  status: string;
  reason: string;
  resume_url?: string;
  payload: Record<string, unknown>;
  decision?: string;
  decision_comment?: string;
  decision_payload?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  expires_at?: string;
  decided_at?: string;
  resumed_at?: string;
}

export type RuntimeEventType =
  | 'mission.created'
  | 'mission.updated'
  | 'mission.phase_changed'
  | 'mission.status_changed'
  | 'agent.registered'
  | 'span.started'
  | 'span.completed'
  | 'span.failed'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'tool.called'
  | 'tool.completed'
  | 'tool.failed'
  | 'delegation'
  | 'handoff.requested'
  | 'handoff.accepted'
  | 'handoff.rejected'
  | 'critique'
  | 'review.started'
  | 'review.approved'
  | 'review.changes_requested'
  | 'review.rejected'
  | 'escalation'
  | 'memory.written'
  | 'memory.read'
  | 'observation.recorded'
  | 'artifact.created'
  | 'artifact.updated'
  | 'interrupt.requested'
  | 'interrupt.decision'
  | 'interrupt.resumed';

export interface MissionEventRecord {
  id: string;
  mission_id: string;
  branch_id: string;
  sequence_num: number;
  branch_sequence_num: number;
  event_type: RuntimeEventType | string;
  timestamp: string;
  agent_id?: string;
  span_id?: string;
  trace_id?: string;
  parent_span_id?: string;
  source_event_id?: string;
  idempotency_key?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ReplayBranch {
  id: string;
  mission_id: string;
  name: string;
  parent_branch_id?: string;
  forked_from_sequence_num?: number;
  status: 'active' | 'archived';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RuntimeAgentState {
  agent_id: string;
  name?: string;
  role?: string;
  team?: string;
  status: NodeStatus;
  current_task_id?: string;
  current_span_id?: string;
  confidence?: number;
  summary?: string;
  last_event_sequence_num?: number;
  last_reason?: string;
  pending_interrupt_id?: string;
  history: number[];
  metadata: Record<string, unknown>;
}

export interface RuntimeInterruptState {
  interrupt_id: string;
  status: string;
  reason: string;
  agent_id?: string;
  span_id?: string;
  decision?: string;
  decision_comment?: string;
  resume_url?: string;
  payload: Record<string, unknown>;
  decision_payload?: Record<string, unknown>;
  updated_at: string;
}

export type PendingMissionEvent = Omit<EventEnvelope, 'id' | 'sequence_num' | 'branch_sequence_num'>;

export interface InternalRuntimeState {
  mission_id: string;
  branch_id: string;
  status: string;
  phase: string;
  sequence_num: number;
  last_event_id?: string;
  last_event_type?: string;
  last_updated_at?: string;
  agents: Record<string, RuntimeAgentState>;
  interrupts: Record<string, RuntimeInterruptState>;
  nodeMap: Map<string, GraphNode>;
  edgeMap: Map<string, GraphEdge>;
  agentOrder: string[];
}

export interface RuntimeState {
  mission_id: string;
  branch_id: string;
  status: string;
  phase: string;
  sequence_num: number;
  last_event_id?: string;
  last_event_type?: string;
  last_updated_at?: string;
  agents: Record<string, RuntimeAgentState>;
  interrupts: Record<string, RuntimeInterruptState>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ReplayStateResponse {
  mission_id: string;
  branch_id: string;
  total_frames: number;
  duration_seconds: number | null;
  branches: ReplayBranch[];
  events: EventEnvelope[];
  snapshots: GraphSnapshot[];
  current_state: RuntimeState | null;
}

/** Actor types for event attribution — identifies WHO caused an event. */
export type ActorType = 'agent' | 'tool' | 'human' | 'system' | 'policy';

/** Error source classification for root-cause attribution. */
export type ErrorSource = 'model' | 'tool' | 'human' | 'policy' | 'system';

/** Error cause classification for forensic analysis. */
export type ErrorCause =
  | 'hallucination'
  | 'prompt_injection'
  | 'tool_failure'
  | 'timeout'
  | 'permission_denied'
  | 'validation_error'
  | 'unknown';

/** Causal context linking an event to its triggers and dependencies. */
export interface CausalContext {
  parent_span_id?: string;
  tool_call_id?: string;
  decision_for_event_id?: string;
  triggered_by_event_id?: string;
}

/** LLM provenance metadata recorded alongside an event. */
export interface ModelProvenance {
  provider?: string;
  model_name?: string;
  model_version?: string;
  tokens_input?: number;
  tokens_output?: number;
  temperature?: number;
  stop_reason?: string;
}

/** Error attribution metadata. */
export interface ErrorAttribution {
  source?: ErrorSource;
  cause?: ErrorCause;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  recovery_action?: string;
  original_error?: string;
}

/** Policy decision metadata when a governance rule applies. */
export interface PolicyDecision {
  rule_id?: string;
  decision?: 'allow' | 'deny' | 'require_review' | 'redact';
  reason?: string;
}

/**
 * EventEnvelope — the canonical event record for the AgentLens control plane.
 *
 * This extends MissionEventRecord with richer attribution, causal context,
 * provenance, and cryptographic integrity fields. It is the target schema
 * for the immutable event ledger.
 *
 * During migration, events may have nullable envelope fields. The system
 * must tolerate partial envelopes from legacy ingestion paths.
 */
export interface EventEnvelope extends MissionEventRecord {
  /** Actor attribution — WHO caused this event. */
  actor_type?: ActorType;
  actor_id?: string;

  /** Causal context — WHY this event happened. */
  causal?: CausalContext;

  /** Origin framework that produced the source telemetry. */
  origin_framework?: string;

  /** LLM model provenance — WHICH model produced the decision. */
  model?: ModelProvenance;

  /** Error attribution — WHAT went wrong and WHY. */
  error?: ErrorAttribution;

  /** Policy decision — governance rule evaluation. */
  policy?: PolicyDecision;

  /** Source telemetry identifiers preserved for replay/provenance correlation. */
  source_span_id?: string;
  source_event_id?: string;

  /** SHA-256 hash of (payload + metadata + previous_hash) for tamper evidence. */
  content_hash?: string;

  /** Content hash of the previous event in this branch for hash-chain integrity. */
  previous_hash?: string;
}

export interface AuditBranchReport {
  branch_id: string;
  is_valid: boolean;
  event_count: number;
  error_count: number;
}

export interface AuditIntegrityReport {
  is_valid: boolean;
  branch_reports: AuditBranchReport[];
}

export interface MissionAuditEventResponse {
  events: EventEnvelope[];
  integrity: {
    is_valid: boolean;
    hash_chain_status: 'valid' | 'broken';
    branch_id: string;
    total_events: number;
  };
}

export interface OperatorRailContext {
  selected_node_id?: string;
  selected_event_id?: string;
  active_tab: 'run' | 'govern' | 'audit' | 'ask_pi';
}
