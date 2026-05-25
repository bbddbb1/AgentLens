import { randomUUID } from 'node:crypto';
import {
  AgentAttributes,
  AgentEvents,
  AgentSpanKind,
  type AttributeMap,
  type EdgeStatus,
  type EdgeType,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type MissionEventRecord,
  type NodeStatus,
  type OtlpSpan,
  type ReplayBranch,
  type RuntimeAgentState,
  type RuntimeInterruptState,
  type RuntimeState,
} from '@agentlens/protocol';

const ROOT_BRANCH_ID = 'main';

type PendingMissionEvent = Omit<MissionEventRecord, 'id' | 'sequence_num' | 'branch_sequence_num'>;

interface InternalRuntimeState {
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

const ATTR = {
  AGENT_ID: AgentAttributes.ID,
  AGENT_NAME: AgentAttributes.NAME,
  AGENT_ROLE: AgentAttributes.ROLE,
  AGENT_TEAM: AgentAttributes.TEAM,
  AGENT_GOAL: AgentAttributes.GOAL,
  AGENT_TASK: AgentAttributes.TASK,
  AGENT_CONFIDENCE: AgentAttributes.CONFIDENCE,
  AGENT_FRAMEWORK: AgentAttributes.FRAMEWORK,
  AGENT_SPAN_KIND: 'agent.span.kind',
  TOOL_NAME: AgentAttributes.TOOL_NAME,
  TOOL_STATUS: AgentAttributes.TOOL_STATUS,
  TOOL_INPUT: AgentAttributes.TOOL_INPUT,
  TOOL_OUTPUT: AgentAttributes.TOOL_OUTPUT,
  DELEGATION_TARGET: AgentAttributes.DELEGATION_TARGET,
  DELEGATION_REASON: AgentAttributes.DELEGATION_REASON,
  HANDOFF_TARGET: AgentAttributes.HANDOFF_TARGET,
  HANDOFF_REASON: AgentAttributes.HANDOFF_REASON,
  CRITIQUE_TARGET: AgentAttributes.CRITIQUE_TARGET,
  CRITIQUE_RESULT: AgentAttributes.CRITIQUE_RESULT,
  REVIEW_TARGET: AgentAttributes.REVIEW_TARGET,
  REVIEW_RESULT: AgentAttributes.REVIEW_RESULT,
  ESCALATION_TARGET: AgentAttributes.ESCALATION_TARGET,
  ESCALATION_REASON: AgentAttributes.ESCALATION_REASON,
  MEMORY_KEY: AgentAttributes.MEMORY_KEY,
  INTERRUPT_ID: AgentAttributes.INTERRUPT_ID,
  INTERRUPT_REASON: AgentAttributes.INTERRUPT_REASON,
  INTERRUPT_RESUME_URL: AgentAttributes.INTERRUPT_RESUME_URL,
  HUMAN_DECISION: AgentAttributes.HUMAN_DECISION,
  HUMAN_INPUT: AgentAttributes.HUMAN_INPUT,
  ARTIFACT_NAME: 'artifact.name',
  ARTIFACT_TYPE: 'artifact.type',
} as const;

function attr(attrs: AttributeMap | undefined, key: string): string | undefined {
  const value = attrs?.[key];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(',') : String(value);
}

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function nanoToIso(value: number | string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date().toISOString();
  return new Date(Math.floor(numeric / 1_000_000)).toISOString();
}

function compareTimestamp(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

const EVENT_PRIORITY: Record<string, number> = {
  'agent.registered': 0,
  'mission.created': 0,
  'mission.updated': 0,
  'mission.phase_changed': 0,
  'mission.status_changed': 0,
  'span.started': 10,
  'task.started': 20,
  'tool.called': 20,
  'delegation': 30,
  'handoff.requested': 30,
  'handoff.accepted': 30,
  'handoff.rejected': 30,
  'critique': 40,
  'review.started': 40,
  'review.approved': 40,
  'review.changes_requested': 40,
  'review.rejected': 40,
  'escalation': 50,
  'memory.written': 50,
  'artifact.created': 50,
  'artifact.updated': 50,
  'interrupt.requested': 60,
  'interrupt.decision': 70,
  'interrupt.resumed': 80,
  'tool.completed': 90,
  'tool.failed': 90,
  'task.completed': 90,
  'task.failed': 90,
  'span.completed': 100,
  'span.failed': 100,
};

function comparePendingEvents(left: PendingMissionEvent, right: PendingMissionEvent): number {
  const byTime = compareTimestamp(left.timestamp, right.timestamp);
  if (byTime !== 0) return byTime;
  const bySpan = (left.span_id ?? '').localeCompare(right.span_id ?? '');
  if (bySpan !== 0) return bySpan;
  const byPriority = (EVENT_PRIORITY[left.event_type] ?? 500) - (EVENT_PRIORITY[right.event_type] ?? 500);
  if (byPriority !== 0) return byPriority;
  return left.event_type.localeCompare(right.event_type);
}

function createPendingEvent(input: PendingMissionEvent): PendingMissionEvent {
  return {
    ...input,
    payload: input.payload ?? {},
    metadata: input.metadata ?? {},
  };
}

function spanStatusToNodeStatus(statusCode: string): NodeStatus {
  if (statusCode === 'OK') return 'completed';
  if (statusCode === 'ERROR') return 'failed';
  return 'active';
}

function edge(type: EdgeType, input: Omit<GraphEdge, 'type'>): GraphEdge {
  return { ...input, type };
}

function createDefaultBranch(missionId: string): ReplayBranch {
  const now = new Date().toISOString();
  return {
    id: ROOT_BRANCH_ID,
    mission_id: missionId,
    name: 'Main',
    status: 'active',
    metadata: {},
    created_at: now,
    updated_at: now,
  };
}

export function createEmptyRuntimeState(
  missionId: string,
  branchId = ROOT_BRANCH_ID,
  status = 'active',
  phase = 'planning',
): RuntimeState {
  return {
    mission_id: missionId,
    branch_id: branchId,
    status,
    phase,
    sequence_num: -1,
    agents: {},
    interrupts: {},
    nodes: [],
    edges: [],
  };
}

function createInternalRuntimeState(
  missionId: string,
  branchId = ROOT_BRANCH_ID,
  status = 'active',
  phase = 'planning',
): InternalRuntimeState {
  return {
    mission_id: missionId,
    branch_id: branchId,
    status,
    phase,
    sequence_num: -1,
    agents: {},
    interrupts: {},
    nodeMap: new Map<string, GraphNode>(),
    edgeMap: new Map<string, GraphEdge>(),
    agentOrder: [],
  };
}

function cloneNode(node: GraphNode): GraphNode {
  return {
    ...node,
    position: { ...node.position },
    metadata: node.metadata ? { ...node.metadata } : undefined,
  };
}

function cloneEdge(edgeValue: GraphEdge): GraphEdge {
  return {
    ...edgeValue,
    metadata: edgeValue.metadata ? { ...edgeValue.metadata } : undefined,
  };
}

function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.sort((left, right) => {
    if (left.position.y !== right.position.y) return left.position.y - right.position.y;
    if (left.position.x !== right.position.x) return left.position.x - right.position.x;
    return left.id.localeCompare(right.id);
  });
}

function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.sort((left, right) => left.id.localeCompare(right.id));
}

function serializeRuntimeState(state: InternalRuntimeState): RuntimeState {
  return {
    mission_id: state.mission_id,
    branch_id: state.branch_id,
    status: state.status,
    phase: state.phase,
    sequence_num: state.sequence_num,
    last_event_id: state.last_event_id,
    last_event_type: state.last_event_type,
    last_updated_at: state.last_updated_at,
    agents: Object.fromEntries(
      Object.entries(state.agents)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([agentId, agentState]) => [
          agentId,
          {
            ...agentState,
            history: [...agentState.history],
            metadata: { ...agentState.metadata },
          },
        ]),
    ),
    interrupts: Object.fromEntries(
      Object.entries(state.interrupts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([interruptId, interruptState]) => [
          interruptId,
          {
            ...interruptState,
            payload: { ...interruptState.payload },
          },
        ]),
    ),
    nodes: sortNodes(Array.from(state.nodeMap.values()).map(cloneNode)),
    edges: sortEdges(Array.from(state.edgeMap.values()).map(cloneEdge)),
  };
}

function ensureAgentPosition(state: InternalRuntimeState, agentId: string): number {
  const existingIndex = state.agentOrder.indexOf(agentId);
  if (existingIndex >= 0) return existingIndex;
  state.agentOrder.push(agentId);
  return state.agentOrder.length - 1;
}

function ensureAgentNode(
  state: InternalRuntimeState,
  agentId: string,
  input: {
    name?: string;
    role?: string;
    team?: string;
    confidence?: number;
    summary?: string;
    span_id?: string;
    trace_id?: string;
    metadata?: Record<string, unknown>;
  } = {},
): GraphNode {
  const existing = state.nodeMap.get(agentId);
  if (existing) {
    const next: GraphNode = {
      ...existing,
      label: input.name ?? existing.label,
      status: existing.status,
      agent_role: input.role ?? existing.agent_role,
      agent_team: input.team ?? existing.agent_team,
      confidence: input.confidence ?? existing.confidence,
      summary: input.summary ?? existing.summary,
      span_id: input.span_id ?? existing.span_id,
      trace_id: input.trace_id ?? existing.trace_id,
      metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
    };
    state.nodeMap.set(agentId, next);
    return next;
  }

  const index = ensureAgentPosition(state, agentId);
  const node: GraphNode = {
    id: agentId,
    type: 'agent',
    label: input.name ?? agentId,
    status: 'idle',
    position: { x: index * 250, y: 0 },
    agent_id: agentId,
    agent_role: input.role,
    agent_team: input.team,
    confidence: input.confidence,
    summary: input.summary,
    span_id: input.span_id,
    trace_id: input.trace_id,
    metadata: { ...(input.metadata ?? {}) },
  };
  state.nodeMap.set(agentId, node);
  return node;
}

function updateNodeStatus(state: InternalRuntimeState, nodeId: string, status: NodeStatus, summary?: string): void {
  const node = state.nodeMap.get(nodeId);
  if (!node) return;
  state.nodeMap.set(nodeId, {
    ...node,
    status,
    summary: summary ?? node.summary,
  });
}

function ensureTaskNode(
  state: InternalRuntimeState,
  agentId: string,
  taskId: string,
  label: string,
  spanId?: string,
  traceId?: string,
): GraphNode {
  const existing = state.nodeMap.get(taskId);
  if (existing) return existing;
  const index = ensureAgentPosition(state, agentId);
  const node: GraphNode = {
    id: taskId,
    type: 'task',
    label: label.slice(0, 80),
    status: 'active',
    position: { x: index * 250, y: 150 },
    summary: label,
    span_id: spanId,
    trace_id: traceId,
  };
  state.nodeMap.set(taskId, node);
  return node;
}

function ensureToolNode(
  state: InternalRuntimeState,
  agentId: string,
  toolId: string,
  toolName: string,
  spanId?: string,
  traceId?: string,
): GraphNode {
  const existing = state.nodeMap.get(toolId);
  if (existing) return existing;
  const index = ensureAgentPosition(state, agentId);
  const node: GraphNode = {
    id: toolId,
    type: 'tool',
    label: toolName,
    status: 'active',
    position: { x: index * 250 + 125, y: 300 },
    span_id: spanId,
    trace_id: traceId,
  };
  state.nodeMap.set(toolId, node);
  return node;
}

function ensureHumanNode(state: InternalRuntimeState, humanId: string): GraphNode {
  const existing = state.nodeMap.get(humanId);
  if (existing) return existing;
  const node: GraphNode = {
    id: humanId,
    type: 'human',
    label: humanId,
    status: 'waiting',
    position: { x: 0, y: -150 },
  };
  state.nodeMap.set(humanId, node);
  return node;
}

function ensureMemoryNode(state: InternalRuntimeState, memoryKey: string, agentId?: string): GraphNode {
  const memoryId = `mem-${sanitizeId(memoryKey)}`;
  const existing = state.nodeMap.get(memoryId);
  if (existing) return existing;
  const index = agentId ? ensureAgentPosition(state, agentId) : 0;
  const node: GraphNode = {
    id: memoryId,
    type: 'memory',
    label: memoryKey,
    status: 'active',
    position: { x: index * 250 + 200, y: 150 },
  };
  state.nodeMap.set(memoryId, node);
  return node;
}

function ensureArtifactNode(state: InternalRuntimeState, artifactName: string, agentId?: string, artifactType?: string): GraphNode {
  const artifactId = `artifact-${sanitizeId(artifactName)}`;
  const existing = state.nodeMap.get(artifactId);
  if (existing) return existing;
  const index = agentId ? ensureAgentPosition(state, agentId) : 0;
  const node: GraphNode = {
    id: artifactId,
    type: 'artifact',
    label: artifactName,
    status: 'active',
    position: { x: index * 250 + 200, y: 350 },
    metadata: artifactType ? { artifact_type: artifactType } : {},
  };
  state.nodeMap.set(artifactId, node);
  return node;
}

function setEdge(state: InternalRuntimeState, nextEdge: GraphEdge): void {
  state.edgeMap.set(nextEdge.id, nextEdge);
}

function upsertAgentState(
  state: InternalRuntimeState,
  agentId: string,
  input: Partial<RuntimeAgentState> & {
    name?: string;
    role?: string;
    team?: string;
    metadata?: Record<string, unknown>;
  } = {},
): RuntimeAgentState {
  const current = state.agents[agentId];
  const next: RuntimeAgentState = {
    agent_id: agentId,
    name: input.name ?? current?.name,
    role: input.role ?? current?.role,
    team: input.team ?? current?.team,
    status: input.status ?? current?.status ?? 'idle',
    current_task_id: input.current_task_id ?? current?.current_task_id,
    current_span_id: input.current_span_id ?? current?.current_span_id,
    confidence: input.confidence ?? current?.confidence,
    summary: input.summary ?? current?.summary,
    last_event_sequence_num: input.last_event_sequence_num ?? current?.last_event_sequence_num,
    last_reason: input.last_reason ?? current?.last_reason,
    pending_interrupt_id: input.pending_interrupt_id ?? current?.pending_interrupt_id,
    history: input.history ?? current?.history ?? [],
    metadata: { ...(current?.metadata ?? {}), ...(input.metadata ?? {}) },
  };
  state.agents[agentId] = next;
  return next;
}

function appendAgentHistory(agentState: RuntimeAgentState, sequenceNum: number, reason: string): RuntimeAgentState {
  return {
    ...agentState,
    last_event_sequence_num: sequenceNum,
    last_reason: reason,
    history: [...agentState.history, sequenceNum],
  };
}

function updateAgentStatus(
  state: InternalRuntimeState,
  agentId: string,
  status: NodeStatus,
  sequenceNum: number,
  reason: string,
  extras: Partial<RuntimeAgentState> = {},
): void {
  const current = upsertAgentState(state, agentId, { status, ...extras });
  const next = appendAgentHistory(
    {
      ...current,
      status,
      ...extras,
    },
    sequenceNum,
    reason,
  );
  state.agents[agentId] = next;
  updateNodeStatus(state, agentId, status, extras.summary ?? next.summary);
}

function eventDescription(event: MissionEventRecord): string {
  const payload = event.payload;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : event.agent_id;
  switch (event.event_type) {
    case 'task.started':
      return `${agentId ?? 'Agent'} started task ${String(payload.task ?? 'task')}`;
    case 'task.completed':
      return `${agentId ?? 'Agent'} completed task ${String(payload.task ?? 'task')}`;
    case 'task.failed':
      return `${agentId ?? 'Agent'} failed task ${String(payload.task ?? 'task')}`;
    case 'tool.called':
      return `${agentId ?? 'Agent'} called ${String(payload.tool_name ?? 'tool')}`;
    case 'interrupt.requested':
      return `${agentId ?? 'Agent'} requested interrupt`;
    case 'interrupt.resumed':
      return `${agentId ?? 'Agent'} resumed after interrupt`;
    case 'handoff.requested':
    case 'handoff.accepted':
    case 'handoff.rejected':
    case 'delegation':
      return `${agentId ?? 'Agent'} handed off to ${String(payload.target_agent_id ?? 'agent')}`;
    default:
      return event.event_type;
  }
}

function snapshotFromState(state: InternalRuntimeState, event: MissionEventRecord): GraphSnapshot {
  const serialized = serializeRuntimeState(state);
  return {
    id: `${state.branch_id}:${event.sequence_num}`,
    mission_id: state.mission_id,
    branch_id: state.branch_id,
    sequence_num: event.sequence_num,
    timestamp: event.timestamp,
    nodes: serialized.nodes,
    edges: serialized.edges,
    event_type: event.event_type,
    event_description: eventDescription(event),
    source_event_id: event.id,
    source_event_sequence_num: event.sequence_num,
    phase: state.phase,
  };
}

export function normalizeSpansToMissionEvents(
  missionId: string,
  spans: OtlpSpan[],
  branchId = ROOT_BRANCH_ID,
): PendingMissionEvent[] {
  const pending: PendingMissionEvent[] = [];
  const seenAgents = new Set<string>();

  const sortedSpans = [...spans].sort((left, right) => {
    if (left.start_time_unix_nano !== right.start_time_unix_nano) {
      return left.start_time_unix_nano - right.start_time_unix_nano;
    }
    if (left.end_time_unix_nano !== right.end_time_unix_nano) {
      return left.end_time_unix_nano - right.end_time_unix_nano;
    }
    return left.span_id.localeCompare(right.span_id);
  });

  for (const span of sortedSpans) {
    const attrs = span.attributes ?? {};
    const agentId = attr(attrs, ATTR.AGENT_ID);
    const agentName = attr(attrs, ATTR.AGENT_NAME);
    const agentRole = attr(attrs, ATTR.AGENT_ROLE);
    const agentTeam = attr(attrs, ATTR.AGENT_TEAM);
    const task = attr(attrs, ATTR.AGENT_TASK);
    const confidence = asNumber(attr(attrs, ATTR.AGENT_CONFIDENCE));
    const spanKind = attr(attrs, ATTR.AGENT_SPAN_KIND) ?? '';
    const startTimestamp = nanoToIso(span.start_time_unix_nano);
    const endTimestamp = nanoToIso(span.end_time_unix_nano);

    if (agentId && !seenAgents.has(agentId)) {
      seenAgents.add(agentId);
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: 'agent.registered',
          timestamp: startTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            name: agentName,
            role: agentRole,
            team: agentTeam,
            summary: attr(attrs, ATTR.AGENT_GOAL),
            confidence,
            framework: attr(attrs, ATTR.AGENT_FRAMEWORK),
          },
        }),
      );
    }

    pending.push(
      createPendingEvent({
        mission_id: missionId,
        branch_id: branchId,
        event_type: 'span.started',
        timestamp: startTimestamp,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
        payload: {
          agent_id: agentId,
          agent_name: agentName,
          agent_role: agentRole,
          span_kind: spanKind,
          operation_name: span.operation_name,
          task,
          status_code: span.status_code,
        },
      }),
    );

    if (task && spanKind === AgentSpanKind.AGENT_TASK) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: 'task.started',
          timestamp: startTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            task,
            task_id: `task-${span.span_id.slice(0, 8)}`,
          },
        }),
      );
    }

    const toolName = attr(attrs, ATTR.TOOL_NAME);
    if (toolName && spanKind === AgentSpanKind.TOOL_CALL) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: 'tool.called',
          timestamp: startTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            tool_name: toolName,
            tool_id: `tool-${span.span_id.slice(0, 8)}`,
            tool_input: attr(attrs, ATTR.TOOL_INPUT),
          },
        }),
      );
    }

    for (const eventEntry of [...(span.events ?? [])].sort((left, right) => {
      return Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0);
    })) {
      const eventName = eventEntry.name ?? '';
      const eventAttrs = eventEntry.attributes ?? {};
      const timestamp = nanoToIso(eventEntry.timestamp);
      const common = {
        mission_id: missionId,
        branch_id: branchId,
        timestamp,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
      };

      if (eventName === AgentEvents.DELEGATION) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'delegation',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.DELEGATION_TARGET),
              reason: attr(eventAttrs, ATTR.DELEGATION_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.HANDOFF_REQUESTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'handoff.requested',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.HANDOFF_TARGET),
              reason: attr(eventAttrs, ATTR.HANDOFF_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.HANDOFF_ACCEPTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'handoff.accepted',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.HANDOFF_TARGET),
              reason: attr(eventAttrs, ATTR.HANDOFF_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.HANDOFF_REJECTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'handoff.rejected',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.HANDOFF_TARGET),
              reason: attr(eventAttrs, ATTR.HANDOFF_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.CRITIQUE) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'critique',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.CRITIQUE_TARGET),
              result: attr(eventAttrs, ATTR.CRITIQUE_RESULT),
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.started',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT),
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW_APPROVED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.approved',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT) ?? 'approved',
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW_CHANGES_REQUESTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.changes_requested',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT) ?? 'changes_requested',
            },
          }),
        );
      } else if (eventName === AgentEvents.REVIEW_REJECTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'review.rejected',
            payload: {
              agent_id: agentId,
              target_agent_id: attr(eventAttrs, ATTR.REVIEW_TARGET),
              result: attr(eventAttrs, ATTR.REVIEW_RESULT) ?? 'rejected',
            },
          }),
        );
      } else if (eventName === AgentEvents.ESCALATION) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'escalation',
            payload: {
              agent_id: agentId,
              target: attr(eventAttrs, ATTR.ESCALATION_TARGET),
              reason: attr(eventAttrs, ATTR.ESCALATION_REASON),
            },
          }),
        );
      } else if (eventName === AgentEvents.MEMORY_WRITE) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'memory.written',
            payload: {
              agent_id: agentId,
              memory_key: attr(eventAttrs, ATTR.MEMORY_KEY) ?? 'shared_memory',
            },
          }),
        );
      } else if (eventName === AgentEvents.ARTIFACT_CREATED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'artifact.created',
            payload: {
              agent_id: agentId,
              artifact_name: attr(eventAttrs, ATTR.ARTIFACT_NAME),
              artifact_type: attr(eventAttrs, ATTR.ARTIFACT_TYPE),
            },
          }),
        );
      } else if (eventName === AgentEvents.ARTIFACT_UPDATED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'artifact.updated',
            payload: {
              agent_id: agentId,
              artifact_name: attr(eventAttrs, ATTR.ARTIFACT_NAME),
              artifact_type: attr(eventAttrs, ATTR.ARTIFACT_TYPE),
            },
          }),
        );
      } else if (eventName === AgentEvents.INTERRUPT_REQUESTED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'interrupt.requested',
            payload: {
              agent_id: agentId,
              interrupt_id: attr(eventAttrs, ATTR.INTERRUPT_ID) ?? `${span.span_id}:interrupt`,
              reason: attr(eventAttrs, ATTR.INTERRUPT_REASON) ?? 'Human input required',
              resume_url: attr(eventAttrs, ATTR.INTERRUPT_RESUME_URL),
              attributes: eventAttrs,
            },
          }),
        );
      } else if (eventName === AgentEvents.INTERRUPT_RESUMED) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'interrupt.resumed',
            payload: {
              agent_id: agentId,
              interrupt_id: attr(eventAttrs, ATTR.INTERRUPT_ID) ?? `${span.span_id}:interrupt`,
            },
          }),
        );
      } else if (eventName === AgentEvents.HUMAN_DECISION) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'interrupt.decision',
            payload: {
              agent_id: agentId,
              interrupt_id: attr(eventAttrs, ATTR.INTERRUPT_ID) ?? `${span.span_id}:interrupt`,
              decision: attr(eventAttrs, ATTR.HUMAN_DECISION),
              comment: attr(eventAttrs, ATTR.HUMAN_INPUT),
            },
          }),
        );
      } else if (eventName === AgentEvents.TOOL_RESULT) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'tool.completed',
            payload: {
              agent_id: agentId,
              tool_name: toolName,
              tool_id: `tool-${span.span_id.slice(0, 8)}`,
              tool_output: attr(eventAttrs, ATTR.TOOL_OUTPUT),
            },
          }),
        );
      } else if (eventName === AgentEvents.TOOL_ERROR) {
        pending.push(
          createPendingEvent({
            ...common,
            event_type: 'tool.failed',
            payload: {
              agent_id: agentId,
              tool_name: toolName,
              tool_id: `tool-${span.span_id.slice(0, 8)}`,
              tool_status: attr(eventAttrs, ATTR.TOOL_STATUS) ?? 'error',
            },
          }),
        );
      }
    }

    if (toolName && spanKind === AgentSpanKind.TOOL_CALL && !(span.events ?? []).some((event) => event.name === AgentEvents.TOOL_RESULT || event.name === AgentEvents.TOOL_ERROR)) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: span.status_code === 'ERROR' ? 'tool.failed' : 'tool.completed',
          timestamp: endTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            tool_name: toolName,
            tool_id: `tool-${span.span_id.slice(0, 8)}`,
          },
        }),
      );
    }

    if (task && spanKind === AgentSpanKind.AGENT_TASK) {
      pending.push(
        createPendingEvent({
          mission_id: missionId,
          branch_id: branchId,
          event_type: span.status_code === 'ERROR' ? 'task.failed' : 'task.completed',
          timestamp: endTimestamp,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: {
            agent_id: agentId,
            task,
            task_id: `task-${span.span_id.slice(0, 8)}`,
          },
        }),
      );
    }

    pending.push(
      createPendingEvent({
        mission_id: missionId,
        branch_id: branchId,
        event_type: span.status_code === 'ERROR' ? 'span.failed' : 'span.completed',
        timestamp: endTimestamp,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
        payload: {
          agent_id: agentId,
          agent_name: agentName,
          agent_role: agentRole,
          span_kind: spanKind,
          operation_name: span.operation_name,
          task,
          status_code: span.status_code,
        },
      }),
    );
  }

  return pending.sort(comparePendingEvents);
}

export function applyMissionEvent(state: InternalRuntimeState, event: MissionEventRecord): InternalRuntimeState {
  state.sequence_num = event.sequence_num;
  state.last_event_id = event.id;
  state.last_event_type = event.event_type;
  state.last_updated_at = event.timestamp;

  const payload = event.payload;
  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : event.agent_id;

  switch (event.event_type) {
    case 'agent.registered': {
      if (!agentId) break;
      const metadata = typeof payload.framework === 'string' ? { framework: payload.framework } : {};
      ensureAgentNode(state, agentId, {
        name: typeof payload.name === 'string' ? payload.name : agentId,
        role: typeof payload.role === 'string' ? payload.role : undefined,
        team: typeof payload.team === 'string' ? payload.team : undefined,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
        summary: typeof payload.summary === 'string' ? payload.summary : undefined,
        span_id: event.span_id,
        trace_id: event.trace_id,
        metadata,
      });
      upsertAgentState(state, agentId, {
        name: typeof payload.name === 'string' ? payload.name : agentId,
        role: typeof payload.role === 'string' ? payload.role : undefined,
        team: typeof payload.team === 'string' ? payload.team : undefined,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
        summary: typeof payload.summary === 'string' ? payload.summary : undefined,
        status: 'idle',
        current_span_id: event.span_id,
        metadata,
      });
      break;
    }
    case 'task.started': {
      if (!agentId || typeof payload.task_id !== 'string' || typeof payload.task !== 'string') break;
      ensureAgentNode(state, agentId);
      ensureTaskNode(state, agentId, payload.task_id, payload.task, event.span_id, event.trace_id);
      setEdge(
        state,
        edge('dependency', {
          id: `e-${agentId}-${payload.task_id}`,
          source: agentId,
          target: payload.task_id,
          label: 'executes',
          status: 'active',
        }),
      );
      updateAgentStatus(state, agentId, 'active', event.sequence_num, `Started task ${payload.task}`, {
        current_task_id: payload.task_id,
        current_span_id: event.span_id,
        summary: payload.task,
      });
      break;
    }
    case 'task.completed':
    case 'task.failed': {
      if (!agentId || typeof payload.task_id !== 'string' || typeof payload.task !== 'string') break;
      updateNodeStatus(state, payload.task_id, event.event_type === 'task.completed' ? 'completed' : 'failed', payload.task);
      const nextStatus: NodeStatus = event.event_type === 'task.completed' ? 'completed' : 'failed';
      updateAgentStatus(state, agentId, nextStatus, event.sequence_num, `${nextStatus === 'completed' ? 'Completed' : 'Failed'} task ${payload.task}`, {
        current_task_id: undefined,
        current_span_id: event.span_id,
        summary: payload.task,
      });
      const dependencyEdge = state.edgeMap.get(`e-${agentId}-${payload.task_id}`);
      if (dependencyEdge) {
        state.edgeMap.set(dependencyEdge.id, { ...dependencyEdge, status: nextStatus === 'completed' ? 'completed' : 'failed' });
      }
      break;
    }
    case 'tool.called': {
      if (!agentId || typeof payload.tool_id !== 'string' || typeof payload.tool_name !== 'string') break;
      ensureAgentNode(state, agentId);
      ensureToolNode(state, agentId, payload.tool_id, payload.tool_name, event.span_id, event.trace_id);
      setEdge(
        state,
        edge('uses', {
          id: `e-${agentId}-${payload.tool_id}`,
          source: agentId,
          target: payload.tool_id,
          label: 'calls',
          status: 'active',
          animated: true,
        }),
      );
      updateAgentStatus(state, agentId, 'active', event.sequence_num, `Called tool ${payload.tool_name}`, {
        current_span_id: event.span_id,
      });
      break;
    }
    case 'tool.completed':
    case 'tool.failed': {
      if (!agentId || typeof payload.tool_id !== 'string') break;
      updateNodeStatus(state, payload.tool_id, event.event_type === 'tool.completed' ? 'completed' : 'failed');
      const toolEdge = state.edgeMap.get(`e-${agentId}-${payload.tool_id}`);
      if (toolEdge) {
        state.edgeMap.set(toolEdge.id, {
          ...toolEdge,
          status: event.event_type === 'tool.completed' ? 'completed' : 'failed',
          animated: false,
        });
      }
      updateAgentStatus(state, agentId, 'active', event.sequence_num, event.event_type === 'tool.completed' ? 'Tool call completed' : 'Tool call failed', {
        current_span_id: event.span_id,
      });
      break;
    }
    case 'delegation':
    case 'handoff.requested':
    case 'handoff.accepted':
    case 'handoff.rejected': {
      if (!agentId || typeof payload.target_agent_id !== 'string') break;
      ensureAgentNode(state, agentId);
      ensureAgentNode(state, payload.target_agent_id, { name: payload.target_agent_id });
      const status: EdgeStatus =
        event.event_type === 'handoff.requested'
          ? 'pending'
          : event.event_type === 'handoff.accepted'
            ? 'completed'
            : event.event_type === 'handoff.rejected'
              ? 'failed'
              : 'active';
      setEdge(
        state,
        edge('delegation', {
          id: `e-del-${agentId}-${payload.target_agent_id}`,
          source: agentId,
          target: payload.target_agent_id,
          label: event.event_type === 'delegation' ? 'delegates' : 'handoff',
          status,
          animated: status === 'active' || status === 'pending',
          metadata: typeof payload.reason === 'string' ? { reason: payload.reason } : {},
        }),
      );
      updateAgentStatus(state, agentId, 'active', event.sequence_num, `Delegated to ${payload.target_agent_id}`);
      if (status === 'completed') {
        updateAgentStatus(state, payload.target_agent_id, 'active', event.sequence_num, `Accepted handoff from ${agentId}`);
      } else if (status === 'failed') {
        updateAgentStatus(state, payload.target_agent_id, 'failed', event.sequence_num, `Rejected handoff from ${agentId}`);
      } else {
        updateAgentStatus(state, payload.target_agent_id, 'waiting', event.sequence_num, `Waiting on handoff from ${agentId}`);
      }
      break;
    }
    case 'critique': {
      if (!agentId || typeof payload.target_agent_id !== 'string') break;
      ensureAgentNode(state, agentId);
      ensureAgentNode(state, payload.target_agent_id, { name: payload.target_agent_id });
      setEdge(
        state,
        edge('critique', {
          id: `e-crit-${agentId}-${payload.target_agent_id}`,
          source: agentId,
          target: payload.target_agent_id,
          label: typeof payload.result === 'string' ? `critique: ${payload.result}` : 'critique',
          status: 'active',
        }),
      );
      updateAgentStatus(state, agentId, 'reviewing', event.sequence_num, `Critiqued ${payload.target_agent_id}`);
      updateAgentStatus(state, payload.target_agent_id, 'active', event.sequence_num, `Received critique from ${agentId}`);
      break;
    }
    case 'review.started':
    case 'review.approved':
    case 'review.changes_requested':
    case 'review.rejected': {
      if (!agentId) break;
      const targetAgentId = typeof payload.target_agent_id === 'string' ? payload.target_agent_id : agentId;
      ensureAgentNode(state, agentId);
      ensureAgentNode(state, targetAgentId, { name: targetAgentId });
      const label =
        typeof payload.result === 'string'
          ? payload.result
          : event.event_type.replace('review.', '');
      const status: EdgeStatus =
        event.event_type === 'review.approved'
          ? 'completed'
          : event.event_type === 'review.rejected'
            ? 'failed'
            : 'active';
      setEdge(
        state,
        edge('review', {
          id: `e-rev-${agentId}-${targetAgentId}`,
          source: agentId,
          target: targetAgentId,
          label: `review: ${label}`,
          status,
        }),
      );
      updateAgentStatus(state, agentId, 'reviewing', event.sequence_num, `Reviewed ${targetAgentId}`);
      if (event.event_type === 'review.approved') {
        updateAgentStatus(state, targetAgentId, 'completed', event.sequence_num, `Review approved by ${agentId}`);
      } else if (event.event_type === 'review.rejected' || event.event_type === 'review.changes_requested') {
        updateAgentStatus(state, targetAgentId, 'active', event.sequence_num, `Changes requested by ${agentId}`);
      }
      break;
    }
    case 'escalation': {
      if (!agentId || typeof payload.target !== 'string') break;
      ensureAgentNode(state, agentId);
      ensureHumanNode(state, payload.target);
      setEdge(
        state,
        edge('escalation', {
          id: `e-esc-${agentId}-${payload.target}`,
          source: agentId,
          target: payload.target,
          label: 'escalates',
          status: 'active',
          animated: true,
          metadata: typeof payload.reason === 'string' ? { reason: payload.reason } : {},
        }),
      );
      updateAgentStatus(state, agentId, 'waiting', event.sequence_num, `Escalated to ${payload.target}`);
      break;
    }
    case 'memory.written': {
      if (!agentId || typeof payload.memory_key !== 'string') break;
      ensureAgentNode(state, agentId);
      const memoryNode = ensureMemoryNode(state, payload.memory_key, agentId);
      setEdge(
        state,
        edge('data_flow', {
          id: `e-mem-${agentId}-${memoryNode.id}`,
          source: agentId,
          target: memoryNode.id,
          label: 'writes',
          status: 'active',
        }),
      );
      updateAgentStatus(state, agentId, 'active', event.sequence_num, `Wrote memory ${payload.memory_key}`);
      break;
    }
    case 'artifact.created':
    case 'artifact.updated': {
      if (!agentId || typeof payload.artifact_name !== 'string') break;
      ensureAgentNode(state, agentId);
      const artifactNode = ensureArtifactNode(
        state,
        payload.artifact_name,
        agentId,
        typeof payload.artifact_type === 'string' ? payload.artifact_type : undefined,
      );
      setEdge(
        state,
        edge('produces', {
          id: `e-art-${agentId}-${artifactNode.id}`,
          source: agentId,
          target: artifactNode.id,
          label: 'produces',
          status: event.event_type === 'artifact.created' ? 'active' : 'completed',
          animated: event.event_type === 'artifact.created',
        }),
      );
      updateAgentStatus(state, agentId, 'active', event.sequence_num, `${event.event_type === 'artifact.created' ? 'Created' : 'Updated'} artifact ${payload.artifact_name}`);
      break;
    }
    case 'interrupt.requested': {
      if (typeof payload.interrupt_id !== 'string' || typeof payload.reason !== 'string') break;
      const interruptId = payload.interrupt_id;
      state.interrupts[interruptId] = {
        interrupt_id: interruptId,
        status: 'pending',
        reason: payload.reason,
        agent_id: agentId,
        span_id: event.span_id,
        resume_url: typeof payload.resume_url === 'string' ? payload.resume_url : undefined,
        payload: { ...payload },
        updated_at: event.timestamp,
      };
      if (agentId) {
        ensureAgentNode(state, agentId);
        updateAgentStatus(state, agentId, 'waiting', event.sequence_num, `Waiting on interrupt ${interruptId}`, {
          pending_interrupt_id: interruptId,
        });
      }
      break;
    }
    case 'interrupt.decision': {
      if (typeof payload.interrupt_id !== 'string') break;
      const current = state.interrupts[payload.interrupt_id];
      if (!current) break;
      const decision = typeof payload.decision === 'string' ? payload.decision : 'approve';
      state.interrupts[payload.interrupt_id] = {
        ...current,
        status: decision === 'resume' ? 'resumed' : decision === 'reject' ? 'rejected' : 'approved',
        decision,
        decision_comment: typeof payload.comment === 'string' ? payload.comment : undefined,
        updated_at: event.timestamp,
        payload: { ...current.payload, ...payload },
      };
      if (current.agent_id) {
        updateAgentStatus(state, current.agent_id, decision === 'reject' ? 'failed' : 'waiting', event.sequence_num, `Interrupt ${payload.interrupt_id} ${decision}`);
      }
      break;
    }
    case 'interrupt.resumed': {
      if (typeof payload.interrupt_id !== 'string') break;
      const current = state.interrupts[payload.interrupt_id];
      if (!current) break;
      state.interrupts[payload.interrupt_id] = {
        ...current,
        status: 'resumed',
        updated_at: event.timestamp,
        payload: { ...current.payload, ...payload },
      };
      if (current.agent_id) {
        updateAgentStatus(state, current.agent_id, 'active', event.sequence_num, `Resumed from interrupt ${payload.interrupt_id}`, {
          pending_interrupt_id: undefined,
        });
      }
      break;
    }
    case 'mission.phase_changed': {
      if (typeof payload.phase === 'string') state.phase = payload.phase;
      break;
    }
    case 'mission.status_changed': {
      if (typeof payload.status === 'string') state.status = payload.status;
      break;
    }
    case 'span.completed':
    case 'span.failed': {
      if (!agentId) break;
      ensureAgentNode(state, agentId);
      const nextStatus = event.event_type === 'span.failed' ? 'failed' : spanStatusToNodeStatus(String(payload.status_code ?? 'OK'));
      const currentAgent = state.agents[agentId];
      if (!currentAgent?.pending_interrupt_id && !currentAgent?.current_task_id) {
        updateAgentStatus(state, agentId, nextStatus, event.sequence_num, event.event_type === 'span.failed' ? 'Span failed' : 'Span completed', {
          current_span_id: event.span_id,
        });
      }
      break;
    }
    case 'span.started': {
      if (!agentId) break;
      ensureAgentNode(state, agentId, {
        name: typeof payload.agent_name === 'string' ? payload.agent_name : undefined,
        role: typeof payload.agent_role === 'string' ? payload.agent_role : undefined,
      });
      updateAgentStatus(state, agentId, 'active', event.sequence_num, 'Span started', {
        current_span_id: event.span_id,
      });
      break;
    }
    default:
      break;
  }

  return state;
}

export function replayMissionEvents(
  missionId: string,
  branchId: string,
  events: MissionEventRecord[],
  initialStatus = 'active',
  initialPhase = 'planning',
): { snapshots: GraphSnapshot[]; current_state: RuntimeState | null } {
  const state = createInternalRuntimeState(missionId, branchId, initialStatus, initialPhase);
  const snapshots: GraphSnapshot[] = [];

  for (const event of [...events].sort((left, right) => left.sequence_num - right.sequence_num)) {
    applyMissionEvent(state, event);
    snapshots.push(snapshotFromState(state, event));
  }

  return {
    snapshots,
    current_state: snapshots.length ? serializeRuntimeState(state) : createEmptyRuntimeState(missionId, branchId, initialStatus, initialPhase),
  };
}

export function buildBranchLineage(branches: ReplayBranch[], branchId = ROOT_BRANCH_ID): ReplayBranch[] {
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const lineage: ReplayBranch[] = [];
  let cursor = byId.get(branchId);
  while (cursor) {
    lineage.push(cursor);
    cursor = cursor.parent_branch_id ? byId.get(cursor.parent_branch_id) : undefined;
  }
  if (lineage.length === 0) return [];
  return lineage.reverse();
}

export function selectEventsForBranch(
  events: MissionEventRecord[],
  branches: ReplayBranch[],
  branchId = ROOT_BRANCH_ID,
): MissionEventRecord[] {
  const lineage = buildBranchLineage(branches, branchId);
  if (lineage.length === 0) return [];

  const selected: MissionEventRecord[] = [];
  for (let index = 0; index < lineage.length; index += 1) {
    const branch = lineage[index];
    const nextBranch = lineage[index + 1];
    const upperBound = nextBranch?.forked_from_sequence_num;
    for (const event of events) {
      if (event.branch_id !== branch.id) continue;
      if (upperBound !== undefined && event.sequence_num > upperBound) continue;
      selected.push(event);
    }
  }

  return selected.sort((left, right) => left.sequence_num - right.sequence_num);
}

export function createMissionEventRecord(
  input: Omit<MissionEventRecord, 'id'> & { id?: string },
): MissionEventRecord {
  return {
    id: input.id ?? randomUUID(),
    ...input,
    metadata: input.metadata ?? {},
    payload: input.payload ?? {},
  };
}

export { ROOT_BRANCH_ID, createDefaultBranch };
