import {
  EdgeStatus,
  EdgeType,
  GraphEdge,
  GraphNode,
  GraphSnapshot,
  MissionEventRecord,
  NodeStatus,
  RuntimeAgentState,
  RuntimeInterruptState,
  RuntimeState,
} from '@agentlens/protocol';
import { applyHierarchicalLayout } from '../graphLayout.js';
import { InternalRuntimeState, ROOT_BRANCH_ID } from './types.js';
import { sanitizeId } from './utils.js';

export function spanStatusToNodeStatus(statusCode: string): NodeStatus {
  if (statusCode === 'OK') return 'completed';
  if (statusCode === 'ERROR') return 'failed';
  return 'active';
}

export function edge(type: EdgeType, input: Omit<GraphEdge, 'type'>): GraphEdge {
  return { ...input, type };
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

export function createInternalRuntimeState(
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

export function cloneNode(node: GraphNode): GraphNode {
  return {
    ...node,
    position: { ...node.position },
    metadata: node.metadata ? { ...node.metadata } : undefined,
  };
}

export function cloneEdge(edgeValue: GraphEdge): GraphEdge {
  return {
    ...edgeValue,
    metadata: edgeValue.metadata ? { ...edgeValue.metadata } : undefined,
  };
}

export function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return nodes.sort((left, right) => {
    if (left.position.y !== right.position.y) return left.position.y - right.position.y;
    if (left.position.x !== right.position.x) return left.position.x - right.position.x;
    return left.id.localeCompare(right.id);
  });
}

export function sortEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.sort((left, right) => left.id.localeCompare(right.id));
}

export function serializeRuntimeState(state: InternalRuntimeState): RuntimeState {
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
            ...(agentState as RuntimeAgentState),
            history: [...(agentState as RuntimeAgentState).history],
            metadata: { ...(agentState as RuntimeAgentState).metadata },
          },
        ]),
    ),
    interrupts: Object.fromEntries(
      Object.entries(state.interrupts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([interruptId, interruptState]) => [
          interruptId,
          {
            ...(interruptState as RuntimeInterruptState),
            payload: { ...(interruptState as RuntimeInterruptState).payload },
          },
        ]),
    ),
    nodes: sortNodes(Array.from(state.nodeMap.values()).map((node) => cloneNode(node as GraphNode))),
    edges: sortEdges(Array.from(state.edgeMap.values()).map((edge) => cloneEdge(edge as GraphEdge))),
  };
}

export function deserializeRuntimeState(state: RuntimeState & Partial<InternalRuntimeState>): InternalRuntimeState {
  const nodeMap = new Map<string, GraphNode>();
  for (const node of state.nodes) {
    nodeMap.set(node.id, cloneNode(node));
  }
  const edgeMap = new Map<string, GraphEdge>();
  for (const edge of state.edges) {
    edgeMap.set(edge.id, cloneEdge(edge));
  }
  const agentOrder: string[] = [];
  const agentNodes = state.nodes.filter(n => n.type === 'agent').sort((a, b) => a.position.x - b.position.x);
  for (const agent of agentNodes) {
    agentOrder.push(agent.id);
  }

  return {
    mission_id: state.mission_id,
    branch_id: state.branch_id ?? ROOT_BRANCH_ID,
    status: state.status ?? 'active',
    phase: state.phase ?? 'planning',
    sequence_num: state.sequence_num ?? -1,
    last_event_id: state.last_event_id,
    last_event_type: state.last_event_type,
    last_updated_at: state.last_updated_at,
    agents: JSON.parse(JSON.stringify(state.agents ?? {})),
    interrupts: JSON.parse(JSON.stringify(state.interrupts ?? {})),
    nodeMap,
    edgeMap,
    agentOrder,
  };
}

export function ensureAgentPosition(state: InternalRuntimeState, agentId: string): number {
  const existingIndex = state.agentOrder.indexOf(agentId);
  if (existingIndex >= 0) return existingIndex;
  state.agentOrder.push(agentId);
  return state.agentOrder.length - 1;
}

export function ensureAgentNode(
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

export function updateNodeStatus(state: InternalRuntimeState, nodeId: string, status: NodeStatus, summary?: string): void {
  const node = state.nodeMap.get(nodeId);
  if (!node) return;
  state.nodeMap.set(nodeId, {
    ...node,
    status,
    summary: summary ?? node.summary,
  });
}

export function ensureTaskNode(
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

export function ensureToolNode(
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

export function ensureHumanNode(state: InternalRuntimeState, humanId: string): GraphNode {
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

export function ensureMemoryNode(state: InternalRuntimeState, memoryKey: string, agentId?: string): GraphNode {
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

export function ensureArtifactNode(state: InternalRuntimeState, artifactName: string, agentId?: string, artifactType?: string): GraphNode {
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

export function setEdge(state: InternalRuntimeState, nextEdge: GraphEdge): void {
  state.edgeMap.set(nextEdge.id, nextEdge);
}

export function upsertAgentState(
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

export function appendAgentHistory(agentState: RuntimeAgentState, sequenceNum: number, reason: string): RuntimeAgentState {
  return {
    ...agentState,
    last_event_sequence_num: sequenceNum,
    last_reason: reason,
    history: [...agentState.history, sequenceNum],
  };
}

export function updateAgentStatus(
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

export function eventDescription(event: MissionEventRecord): string {
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
      return `${agentId ?? 'Agent'} requested human review`;
    case 'interrupt.decision': {
      const decision = String(payload.decision ?? 'none').toUpperCase();
      return `Human Review: ${decision}${payload.comment ? ` - ${String(payload.comment)}` : ''}`;
    }
    case 'interrupt.resumed':
      return `${agentId ?? 'Agent'} resumed execution after human review`;
    case 'handoff.requested':
    case 'handoff.accepted':
    case 'handoff.rejected':
    case 'delegation':
      return `${agentId ?? 'Agent'} handed off to ${String(payload.target_agent_id ?? 'agent')}`;
    default:
      return event.event_type;
  }
}

export function snapshotFromState(state: InternalRuntimeState, event: MissionEventRecord): GraphSnapshot {
  const serialized = serializeRuntimeState(state);
  const snapshot: GraphSnapshot = {
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

  return applyHierarchicalLayout(snapshot);
}
