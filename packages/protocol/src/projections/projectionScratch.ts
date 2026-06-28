import type {
  MissionEventRecord,
  NodeStatus,
  ProducedOutput,
  RuntimeEventRef,
  RuntimeFactWarning,
} from '../types.js';

export const NOISE_EVENT_TYPES = new Set(['span.started', 'span.completed']);

/** Event types hidden from the mission timeline UI (still in audit stream). */
export const TIMELINE_SUPPRESSED_EVENT_TYPES: ReadonlySet<string> = NOISE_EVENT_TYPES;

export interface AgentNodeScratch {
  name: string;
  role?: string;
  objective?: string;
  status: NodeStatus;
  pending?: string;
  requires_human: boolean;
  produced_outputs: ProducedOutput[];
  recent_runtime_events: RuntimeEventRef[];
  next_transition?: { target: string; kind: 'handoff' | 'delegation'; reason?: string };
  warnings: RuntimeFactWarning[];
  completed_tasks: number;
  active_task?: string;
  agent_id?: string;
  agent_type?: string;
  framework?: string;
  iteration?: number;
  start_time?: string;
  end_time?: string;
  duration_ms?: number;
  error_count: number;
  source_span_id?: string;
  source_event_id?: string;
  active_tool_input?: unknown;
  confidence?: number;
  drift_score?: number;
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
    error_count: 0,
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
      object = payloadString(payload, 'tool_name') ?? payloadString(payload, 'gen_ai.tool.name');
      break;
    case 'memory.written':
    case 'memory.read':
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

    // Track identity attributes (PR-1) & lineage (PR-4)
    agent.agent_id = agentId;
    if (event.span_id) agent.source_span_id = event.span_id;
    if (event.id) agent.source_event_id = event.id;

    const role = payloadString(payload, 'gen_ai.agent.role') ?? payloadString(payload, 'role') ?? payloadString(payload, 'agent_role');
    if (role) agent.role = role;

    const parsedConfidence = payloadValue(payload, 'gen_ai.agent.confidence') ?? payloadValue(payload, 'confidence');
    if (parsedConfidence !== undefined && parsedConfidence !== null) {
      agent.confidence = Number(parsedConfidence);
    }
    const parsedDrift = payloadValue(payload, 'gen_ai.agent.drift_score') ?? payloadValue(payload, 'drift_score');
    if (parsedDrift !== undefined && parsedDrift !== null) {
      agent.drift_score = Number(parsedDrift);
    }

    const framework = payloadString(payload, 'gen_ai.agent.framework') ?? payloadString(payload, 'framework') ?? payloadString(payload, 'agent_framework');
    if (framework) agent.framework = framework;

    const agentType = payloadString(payload, 'agentlens.actor.type') ?? payloadString(payload, 'actor_type') ?? payloadString(payload, 'agent_type');
    if (agentType) agent.agent_type = agentType;

    const iteration = payloadValue(payload, 'gen_ai.agent.iteration') ?? payloadValue(payload, 'agent.iteration') ?? payloadValue(payload, 'iteration');
    if (iteration !== undefined) agent.iteration = Number(iteration);

    if (!agent.start_time) {
      agent.start_time = event.timestamp;
    }

    if (event.event_type === 'task.started' || event.event_type === 'span.started') {
      agent.status = 'active';
      if (event.event_type === 'task.started') {
        agent.active_task = payloadString(payload, 'task');
      }
      agent.pending = undefined;
    } else if (event.event_type === 'task.completed' || event.event_type === 'span.completed') {
      if (event.event_type === 'task.completed') {
        agent.completed_tasks += 1;
        agent.active_task = undefined;
      }
      agent.status = 'completed';
      agent.end_time = event.timestamp;
      if (agent.start_time) {
        agent.duration_ms = new Date(agent.end_time).getTime() - new Date(agent.start_time).getTime();
      }
    } else if (event.event_type === 'task.failed' || event.event_type === 'span.failed') {
      agent.status = 'failed';
      agent.active_task = undefined;
      agent.error_count += 1;
      agent.warnings.push({
        code: event.event_type,
        message: event.event_type === 'task.failed'
          ? `Task failed: ${payloadString(payload, 'task') ?? 'unknown'}`
          : 'Span execution failed',
        sequence_num: event.sequence_num,
        severity: 'high',
      });
      agent.end_time = event.timestamp;
      if (agent.start_time) {
        agent.duration_ms = new Date(agent.end_time).getTime() - new Date(agent.start_time).getTime();
      }
    } else if (event.event_type === 'tool.called' || event.event_type === 'tool.call') {
      agent.status = 'active';
      agent.active_tool_input = payloadValue(payload, 'gen_ai.tool.input') ?? payloadValue(payload, 'tool_input') ?? payloadValue(payload, 'input');
    } else if (event.event_type === 'tool.completed' || event.event_type === 'tool.result') {
      const toolName = payloadString(payload, 'tool_name') ?? payloadString(payload, 'gen_ai.tool.name') ?? 'tool';
      const toolOutput = payloadValue(payload, 'tool_output') ?? payloadValue(payload, 'output');
      addProducedOutput(agent, {
        id: `tool-${event.span_id ?? event.sequence_num}`,
        source: event.event_type,
        type: 'tool',
        name: toolName,
        value: {
          input: agent.active_tool_input,
          output: toolOutput,
        },
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
      });
      agent.active_tool_input = undefined;
    } else if (event.event_type === 'tool.failed' || event.event_type === 'tool.error') {
      agent.error_count += 1;
      agent.warnings.push({
        code: 'tool.failed',
        message: `Tool failed: ${payloadString(payload, 'tool_name') ?? payloadString(payload, 'gen_ai.tool.name') ?? 'unknown'}`,
        sequence_num: event.sequence_num,
        severity: 'high',
      });
      agent.active_tool_input = undefined;
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
    } else if (event.event_type === 'memory.read') {
      const key = payloadString(payload, 'memory_key') ?? payloadString(payload, 'key') ?? 'memory';
      addProducedOutput(agent, {
        id: `${key}-read-${event.sequence_num}`,
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
    } else if (event.event_type === 'hypothesis.proposed') {
      const description = payloadString(payload, 'hypothesis.description');
      if (description) {
        addProducedOutput(agent, {
          id: `hypothesis-${event.sequence_num}`,
          source: event.event_type,
          type: 'reflection',
          name: 'Hypothesis',
          value: {
            description,
            confidence: payloadValue(payload, 'hypothesis.confidence'),
          },
          sequence_num: event.sequence_num,
          timestamp: event.timestamp,
        });
      }
    } else if (event.event_type === 'decision.made') {
      const summary = payloadString(payload, 'decision.summary');
      if (summary) {
        addProducedOutput(agent, {
          id: `decision-${event.sequence_num}`,
          source: event.event_type,
          type: 'reflection',
          name: `Decision: ${payloadString(payload, 'decision.type') ?? 'outcome'}`,
          value: {
            type: payloadString(payload, 'decision.type'),
            summary,
            confidence: payloadValue(payload, 'decision.confidence'),
          },
          sequence_num: event.sequence_num,
          timestamp: event.timestamp,
        });
      }
    } else if (event.event_type === 'interrupt.requested') {
      agent.status = 'waiting';
      agent.pending = payloadString(payload, 'reason') ?? 'Awaiting human decision';
      agent.requires_human = true;
    } else if (event.event_type === 'handoff.requested') {
      const targetId = payloadString(payload, 'target_agent_id') ?? payloadString(payload, 'gen_ai.agent.handoff.target');
      const reason = payloadString(payload, 'reason') ?? payloadString(payload, 'gen_ai.agent.handoff.reason');
      if (targetId) {
        agent.next_transition = { target: targetId, kind: 'handoff', reason };
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
    } else if (
      event.event_type === 'review.approved' ||
      event.event_type === 'review.changes_requested' ||
      event.event_type === 'review.rejected' ||
      event.event_type === 'agent.review.approved' ||
      event.event_type === 'agent.review.changes_requested' ||
      event.event_type === 'agent.review.rejected'
    ) {
      const targetAgentId = payloadString(payload, 'target_agent_id') ?? payloadString(payload, 'gen_ai.agent.review.target');
      const result = payloadString(payload, 'result') ?? payloadString(payload, 'gen_ai.agent.review.result') ?? event.event_type.split('.').pop() ?? 'reviewed';
      addProducedOutput(agent, {
        id: `review-${event.sequence_num}`,
        source: event.event_type,
        type: 'reflection',
        name: `Review: ${result}`,
        value: {
          target: targetAgentId,
          result: result,
          details: payloadValue(payload, 'details') ?? payloadValue(payload, 'comment') ?? payloadValue(payload, 'review.details')
        },
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
      });
    } else if (event.event_type === 'interrupt.resumed') {
      agent.status = 'active';
      agent.pending = undefined;
      agent.requires_human = false;
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
