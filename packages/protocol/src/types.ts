export type NodeType = 'agent' | 'task' | 'tool' | 'human' | 'memory' | 'team' | 'artifact';
export type NodeStatus = 'idle' | 'active' | 'completed' | 'failed' | 'waiting' | 'reviewing';
export type EdgeType = 'dependency' | 'uses' | 'delegation' | 'critique' | 'review' | 'escalation' | 'data_flow' | 'approval' | 'member_of' | 'produces';
export type EdgeStatus = 'pending' | 'active' | 'completed' | 'failed';

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
  confidence?: number;
  summary?: string;
  span_id?: string;
  trace_id?: string;
  metadata?: Record<string, unknown>;
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
