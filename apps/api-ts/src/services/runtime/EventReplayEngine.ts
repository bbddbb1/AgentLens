import { GraphSnapshot, MissionEventRecord, RuntimeState, EdgeStatus } from '@agentlens/protocol';
import { InternalRuntimeState } from './types.js';
import {
  ensureAgentNode,
  ensureTaskNode,
  ensureToolNode,
  ensureHumanNode,
  ensureMemoryNode,
  ensureArtifactNode,
  setEdge,
  edge,
  updateAgentStatus,
  updateNodeStatus,
  spanStatusToNodeStatus,
  upsertAgentState,
  snapshotFromState,
  createInternalRuntimeState,
  serializeRuntimeState,
  createEmptyRuntimeState,
  deserializeRuntimeState,
} from './GraphStateBuilder.js';

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
      const nextStatus = event.event_type === 'task.completed' ? 'completed' : 'failed';
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
  initialState?: RuntimeState,
): { snapshots: GraphSnapshot[]; current_state: RuntimeState | null } {
  const state = initialState 
    ? deserializeRuntimeState(initialState)
    : createInternalRuntimeState(missionId, branchId, initialStatus, initialPhase);
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
