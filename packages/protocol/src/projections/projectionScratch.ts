import type {
  MissionEventRecord,
  NodeStatus,
  ProducedOutput,
  RuntimeEventRef,
  RuntimeFactWarning,
} from '../types.js';

export const NOISE_EVENT_TYPES = new Set(['span.started', 'span.completed']);

export interface AgentNodeScratch {
  name: string;
  role?: string;
  objective?: string;
  status: NodeStatus;
  pending?: string;
  requires_human: boolean;
  produced_outputs: ProducedOutput[];
  recent_runtime_events: RuntimeEventRef[];
  next_transition?: { target: string; kind: 'handoff' | 'delegation' };
  warnings: RuntimeFactWarning[];
  completed_tasks: number;
  active_task?: string;
}

export interface InterruptScratch {
  status: string;
  reason?: string;
  agent_id?: string;
}

export interface MissionProjectionScratch {
  phase: string;
  agents: Map<string, AgentNodeScratch>;
  interrupts: Map<string, InterruptScratch>;
}

export function createMissionScratch(phase: string): MissionProjectionScratch {
  return { phase, agents: new Map(), interrupts: new Map() };
}

export function payloadAgentId(event: MissionEventRecord): string | undefined {
  const payload = event.payload ?? {};
  return typeof payload.agent_id === 'string' ? payload.agent_id : event.agent_id;
}

export function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function payloadValue(payload: Record<string, unknown>, key: string): unknown {
  return payload[key];
}

function createAgentScratch(agentId: string, name?: string): AgentNodeScratch {
  return {
    name: name ?? agentId,
    status: 'idle',
    requires_human: false,
    produced_outputs: [],
    recent_runtime_events: [],
    warnings: [],
    completed_tasks: 0,
  };
}

function ensureAgent(scratch: MissionProjectionScratch, agentId: string, name?: string): AgentNodeScratch {
  const existing = scratch.agents.get(agentId) ?? createAgentScratch(agentId, name);
  if (name) existing.name = name;
  scratch.agents.set(agentId, existing);
  return existing;
}

function pushEventRef(agent: AgentNodeScratch, ref: RuntimeEventRef): void {
  agent.recent_runtime_events = [...agent.recent_runtime_events, ref].slice(-8);
}

export function buildEventRef(event: MissionEventRecord): RuntimeEventRef | null {
  if (NOISE_EVENT_TYPES.has(event.event_type)) return null;

  const payload = event.payload ?? {};
  const actor = payloadAgentId(event);
  let object: string | undefined;

  switch (event.event_type) {
    case 'task.started':
    case 'task.completed':
    case 'task.failed':
      object = payloadString(payload, 'task');
      break;
    case 'tool.called':
    case 'tool.completed':
    case 'tool.failed':
      object = payloadString(payload, 'tool_name');
      break;
    case 'memory.written':
      object = payloadString(payload, 'memory_key') ?? payloadString(payload, 'key');
      break;
    case 'artifact.created':
    case 'artifact.updated':
      object = payloadString(payload, 'artifact_name') ?? payloadString(payload, 'name');
      break;
    case 'handoff.requested':
    case 'handoff.accepted':
    case 'handoff.rejected':
    case 'delegation':
      object = payloadString(payload, 'target_agent_id');
      break;
    case 'observation.recorded':
      object = payloadString(payload, 'insight');
      break;
    case 'interrupt.requested':
      object = payloadString(payload, 'reason');
      break;
    default:
      break;
  }

  return {
    event_type: event.event_type,
    sequence_num: event.sequence_num,
    timestamp: event.timestamp,
    actor,
    object,
  };
}

function addProducedOutput(agent: AgentNodeScratch, output: ProducedOutput): void {
  const existingIdx = agent.produced_outputs.findIndex((o) => o.id === output.id && o.type === output.type);
  if (existingIdx >= 0) {
    agent.produced_outputs[existingIdx] = output;
  } else {
    agent.produced_outputs.push(output);
  }
}

export function applyEventToScratch(scratch: MissionProjectionScratch, event: MissionEventRecord): void {
  const payload = event.payload ?? {};
  const agentId = payloadAgentId(event);

  if (event.event_type === 'mission.phase_changed') {
    const phase = payloadString(payload, 'phase');
    if (phase) scratch.phase = phase;
  }

  if (agentId && event.event_type === 'agent.registered') {
    const agent = ensureAgent(scratch, agentId, payloadString(payload, 'name') ?? agentId);
    agent.role = payloadString(payload, 'role');
    agent.objective = payloadString(payload, 'summary') ?? payloadString(payload, 'goal');
    agent.status = 'idle';
  }

  if (agentId) {
    const agent = ensureAgent(scratch, agentId);

    if (event.event_type === 'task.started') {
      agent.status = 'active';
      agent.active_task = payloadString(payload, 'task');
      agent.pending = undefined;
    } else if (event.event_type === 'task.completed') {
      agent.completed_tasks += 1;
      agent.active_task = undefined;
      agent.status = 'completed';
    } else if (event.event_type === 'task.failed') {
      agent.status = 'failed';
      agent.active_task = undefined;
      agent.warnings.push({
        code: 'task.failed',
        message: `Task failed: ${payloadString(payload, 'task') ?? 'unknown'}`,
        sequence_num: event.sequence_num,
        severity: 'high',
      });
    } else if (event.event_type === 'tool.called') {
      agent.status = 'active';
    } else if (event.event_type === 'tool.completed') {
      const toolName = payloadString(payload, 'tool_name') ?? 'tool';
      const toolOutput = payloadValue(payload, 'tool_output') ?? payloadValue(payload, 'output');
      addProducedOutput(agent, {
        id: `tool-${event.span_id ?? event.sequence_num}`,
        source: event.event_type,
        type: 'tool',
        name: toolName,
        value: toolOutput,
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
      });
    } else if (event.event_type === 'tool.failed') {
      agent.warnings.push({
        code: 'tool.failed',
        message: `Tool failed: ${payloadString(payload, 'tool_name') ?? 'unknown'}`,
        sequence_num: event.sequence_num,
        severity: 'high',
      });
    } else if (event.event_type === 'memory.written') {
      const key = payloadString(payload, 'memory_key') ?? payloadString(payload, 'key') ?? 'memory';
      addProducedOutput(agent, {
        id: key,
        source: event.event_type,
        type: 'memory',
        name: key,
        value: payloadValue(payload, 'value') ?? payloadValue(payload, 'memory_value'),
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
      });
    } else if (event.event_type === 'artifact.created' || event.event_type === 'artifact.updated') {
      const name = payloadString(payload, 'artifact_name') ?? payloadString(payload, 'name') ?? 'artifact';
      addProducedOutput(agent, {
        id: name,
        source: event.event_type,
        type: 'artifact',
        name,
        value: payloadValue(payload, 'value'),
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
      });
    } else if (event.event_type === 'observation.recorded') {
      const insight = payloadString(payload, 'insight') ?? `observation-${event.sequence_num}`;
      addProducedOutput(agent, {
        id: `reflection-${event.sequence_num}`,
        source: event.event_type,
        type: 'reflection',
        name: insight,
        value: payloadValue(payload, 'insight'),
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
      });
    } else if (event.event_type === 'interrupt.requested') {
      agent.status = 'waiting';
      agent.pending = payloadString(payload, 'reason') ?? 'Awaiting human decision';
      agent.requires_human = true;
    } else if (event.event_type === 'handoff.requested') {
      const targetId = payloadString(payload, 'target_agent_id');
      if (targetId) {
        agent.next_transition = { target: targetId, kind: 'handoff' };
        const target = ensureAgent(scratch, targetId);
        target.status = 'waiting';
        target.pending = agentId;
      }
    } else if (event.event_type === 'handoff.accepted') {
      const targetId = payloadString(payload, 'target_agent_id');
      if (targetId) {
        agent.next_transition = undefined;
        const target = ensureAgent(scratch, targetId);
        target.status = 'active';
        target.pending = undefined;
      }
    } else if (event.event_type === 'delegation') {
      const targetId = payloadString(payload, 'target_agent_id');
      if (targetId) {
        agent.next_transition = { target: targetId, kind: 'delegation' };
        const target = ensureAgent(scratch, targetId);
        target.status = 'active';
      }
    } else if (event.event_type === 'review.started') {
      agent.status = 'reviewing';
    } else if (event.event_type === 'interrupt.resumed') {
      agent.status = 'active';
      agent.pending = undefined;
      agent.requires_human = false;
    } else if (event.event_type === 'span.failed') {
      agent.status = 'failed';
      agent.warnings.push({
        code: 'span.failed',
        message: 'Span execution failed',
        sequence_num: event.sequence_num,
        severity: 'high',
      });
    } else if (event.event_type === 'escalation') {
      agent.warnings.push({
        code: 'escalation',
        message: `Escalated to ${payloadString(payload, 'target') ?? payloadString(payload, 'target_agent_id') ?? 'oversight'}`,
        sequence_num: event.sequence_num,
        severity: 'medium',
      });
    }

    if (payloadString(payload, 'goal')) {
      agent.objective = payloadString(payload, 'goal');
    }

    const ref = buildEventRef(event);
    if (ref) pushEventRef(agent, ref);
  }

  if (event.event_type === 'interrupt.requested') {
    const interruptId = payloadString(payload, 'interrupt_id') ?? event.span_id ?? `interrupt-${event.sequence_num}`;
    scratch.interrupts.set(interruptId, {
      status: 'pending',
      reason: payloadString(payload, 'reason'),
      agent_id: agentId,
    });
  } else if (event.event_type === 'interrupt.decision') {
    const interruptId = payloadString(payload, 'interrupt_id') ?? event.span_id;
    if (interruptId) {
      const current = scratch.interrupts.get(interruptId) ?? { status: 'pending' };
      current.status = payloadString(payload, 'decision') ?? 'decided';
      scratch.interrupts.set(interruptId, current);
    }
  } else if (event.event_type === 'interrupt.resumed') {
    const interruptId = payloadString(payload, 'interrupt_id') ?? event.span_id;
    if (interruptId) {
      const current = scratch.interrupts.get(interruptId) ?? { status: 'pending' };
      current.status = 'resumed';
      scratch.interrupts.set(interruptId, current);
    }
  }
}

export function scanEventsToScratch(
  events: MissionEventRecord[],
  initialPhase: string,
  upToSequenceNum?: number,
): MissionProjectionScratch {
  const scratch = createMissionScratch(initialPhase);
  const filtered = [...events]
    .filter((e) => upToSequenceNum === undefined || e.sequence_num <= upToSequenceNum)
    .sort((a, b) => a.sequence_num - b.sequence_num);

  for (const event of filtered) {
    applyEventToScratch(scratch, event);
  }
  return scratch;
}

export function statusLabel(status: NodeStatus): string {
  const labels: Record<NodeStatus, string> = {
    idle: 'Idle',
    active: 'Active',
    completed: 'Completed',
    failed: 'Failed',
    waiting: 'Waiting',
    reviewing: 'Reviewing',
  };
  return labels[status] ?? status;
}
