import type {
  MissionEventRecord,
  ProjectRuntimeSummaryInput,
  RuntimeSummary,
  RuntimeSummaryAction,
  RuntimeSummaryArtifact,
  RuntimeSummaryDecision,
  RuntimeSummaryEvidence,
  RuntimeSummaryInterrupt,
  RuntimeSummaryObservation,
  RuntimeSummaryPendingWork,
  RuntimeSummaryProgressEntry,
  RuntimeSummaryWarning,
} from '../types.js';
import { projectAllNodeStates } from './nodeStateProjection.js';
import {
  NOISE_EVENT_TYPES,
  payloadAgentId,
  payloadString,
  scanEventsToScratch,
  type MissionProjectionScratch,
} from './projectionScratch.js';

function actorLabel(event: MissionEventRecord): string | undefined {
  const agentId = payloadAgentId(event);
  if (!agentId) return undefined;
  const name = payloadString(event.payload, 'agent_name') ?? payloadString(event.payload, 'name');
  return name ?? agentId;
}

function truncate(text: string, max = 120): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function describeRuntimeEvent(event: MissionEventRecord): string | null {
  if (NOISE_EVENT_TYPES.has(event.event_type)) return null;

  const payload = event.payload ?? {};
  const agent = actorLabel(event) ?? 'Agent';

  switch (event.event_type) {
    case 'mission.created':
      return 'Mission started';
    case 'mission.phase_changed':
      return `Phase changed to ${payloadString(payload, 'phase') ?? 'unknown'}`;
    case 'mission.status_changed':
      return `Status changed to ${payloadString(payload, 'status') ?? 'unknown'}`;
    case 'agent.registered': {
      const name = payloadString(payload, 'name') ?? agent;
      const role = payloadString(payload, 'role');
      return role ? `${name} joined (${role})` : `${name} joined`;
    }
    case 'task.started':
      return `${agent} started ${payloadString(payload, 'task') ?? 'a task'}`;
    case 'task.completed':
      return `${agent} completed ${payloadString(payload, 'task') ?? 'a task'}`;
    case 'task.failed':
      return `${agent} failed ${payloadString(payload, 'task') ?? 'a task'}`;
    case 'tool.called':
      return `${agent} used ${payloadString(payload, 'tool_name') ?? payloadString(payload, 'gen_ai.tool.name') ?? 'a tool'}`;
    case 'tool.completed':
      return `${agent} finished ${payloadString(payload, 'tool_name') ?? 'tool'} call`;
    case 'tool.failed':
      return `${agent} tool call failed (${payloadString(payload, 'tool_name') ?? 'tool'})`;
    case 'delegation':
      return `${agent} delegated to ${payloadString(payload, 'target_agent_id') ?? 'another agent'}`;
    case 'handoff.requested':
      return `${agent} requested handoff to ${payloadString(payload, 'target_agent_id') ?? 'another agent'}`;
    case 'handoff.accepted':
      return `${payloadString(payload, 'target_agent_id') ?? 'Agent'} accepted handoff from ${agent}`;
    case 'handoff.rejected':
      return `${payloadString(payload, 'target_agent_id') ?? 'Agent'} rejected handoff from ${agent}`;
    case 'critique':
      return `${agent} critiqued ${payloadString(payload, 'target_agent_id') ?? 'peer'}${payloadString(payload, 'result') ? `: ${payloadString(payload, 'result')}` : ''}`;
    case 'review.started':
      return `${agent} started review`;
    case 'review.approved':
      return `${agent} approved review`;
    case 'review.changes_requested':
      return `${agent} requested changes in review`;
    case 'review.rejected':
      return `${agent} rejected in review`;
    case 'escalation':
      return `${agent} escalated to ${payloadString(payload, 'target_agent_id') ?? 'oversight'}`;
    case 'memory.written': {
      const key = payloadString(payload, 'memory_key') ?? payloadString(payload, 'key') ?? 'memory';
      return `${agent} wrote to ${key}`;
    }
    case 'memory.read': {
      const key = payloadString(payload, 'memory_key') ?? payloadString(payload, 'key') ?? 'memory';
      return `${agent} read from ${key}`;
    }
    case 'observation.recorded': {
      const insight = payloadString(payload, 'insight');
      return insight ? `${agent} recorded: ${truncate(insight, 80)}` : `${agent} recorded an observation`;
    }
    case 'hypothesis.proposed': {
      const description = payloadString(payload, 'hypothesis.description');
      return description
        ? `${agent} proposed hypothesis: ${truncate(description, 80)}`
        : `${agent} proposed a hypothesis`;
    }
    case 'decision.made': {
      const summary = payloadString(payload, 'decision.summary');
      const decisionType = payloadString(payload, 'decision.type');
      if (summary) {
        return decisionType
          ? `${agent} decided (${decisionType}): ${truncate(summary, 80)}`
          : `${agent} decided: ${truncate(summary, 80)}`;
      }
      return `${agent} recorded a decision`;
    }
    case 'artifact.created':
      return `${agent} created artifact ${payloadString(payload, 'artifact_name') ?? payloadString(payload, 'name') ?? 'output'}`;
    case 'artifact.updated':
      return `${agent} updated artifact ${payloadString(payload, 'artifact_name') ?? payloadString(payload, 'name') ?? 'output'}`;
    case 'interrupt.requested':
      return `${agent} requested human intervention`;
    case 'interrupt.decision': {
      const decision = (payloadString(payload, 'decision') ?? 'decided').toUpperCase();
      const comment = payloadString(payload, 'comment');
      return `Human decision: ${decision}${comment ? ` — ${truncate(comment, 80)}` : ''}`;
    }
    case 'interrupt.resumed':
      return `${agent} resumed after human decision`;
    case 'span.failed':
      return `${agent} span failed`;
    default:
      return event.event_type.replace(/[._]/g, ' ');
  }
}

function classifyEvent(
  event: MissionEventRecord,
  text: string,
  buckets: {
    observations: RuntimeSummaryObservation[];
    decisions: RuntimeSummaryDecision[];
    evidence: RuntimeSummaryEvidence[];
    actions: RuntimeSummaryAction[];
    warnings: RuntimeSummaryWarning[];
    artifacts: RuntimeSummaryArtifact[];
  },
): void {
  const actor = actorLabel(event);
  const base = { sequence_num: event.sequence_num, actor };

  switch (event.event_type) {
    case 'critique':
    case 'review.changes_requested':
    case 'observation.recorded':
    case 'hypothesis.proposed':
      buckets.observations.push({ text, ...base });
      break;
    case 'agent.registered': {
      const summary = payloadString(event.payload, 'summary') ?? payloadString(event.payload, 'goal');
      if (summary) buckets.observations.push({ text: truncate(summary), ...base });
      break;
    }
    case 'interrupt.decision':
    case 'review.approved':
    case 'review.rejected':
    case 'handoff.accepted':
    case 'handoff.rejected':
    case 'decision.made':
      buckets.decisions.push({ text, ...base });
      break;
    case 'memory.written':
    case 'memory.read':
      buckets.evidence.push({
        text,
        source: payloadString(event.payload, 'memory_key') ?? payloadString(event.payload, 'key'),
        sequence_num: event.sequence_num,
      });
      break;
    case 'tool.completed':
      buckets.actions.push({ text, status: 'completed', ...base });
      break;
    case 'tool.called':
    case 'task.started':
    case 'delegation':
    case 'handoff.requested':
      buckets.actions.push({ text, status: 'active', ...base });
      break;
    case 'task.failed':
    case 'tool.failed':
    case 'span.failed':
      buckets.warnings.push({ text, severity: 'high', ...base });
      break;
    case 'escalation':
      buckets.warnings.push({ text, severity: 'medium', ...base });
      break;
    case 'artifact.created':
    case 'artifact.updated':
      buckets.artifacts.push({
        name: payloadString(event.payload, 'artifact_name') ?? payloadString(event.payload, 'name') ?? 'artifact',
        type: payloadString(event.payload, 'artifact_type') ?? payloadString(event.payload, 'type'),
        sequence_num: event.sequence_num,
      });
      break;
    default:
      break;
  }
}

function buildHeadline(scratch: MissionProjectionScratch, status: string, requiresHuman: boolean): string {
  if (requiresHuman) return 'Waiting for human intervention';
  if (status === 'completed') return 'Execution completed';
  if (status === 'failed') return 'Execution failed';
  if (scratch.phase === 'planning') return 'Planning execution approach';
  if (scratch.phase === 'human_review' || scratch.phase === 'waiting_for_human') {
    return 'Paused for human review';
  }

  const activeAgents = [...scratch.agents.values()].filter((a) => a.status === 'active');
  const waitingAgents = [...scratch.agents.values()].filter((a) => a.status === 'waiting');
  const failedAgents = [...scratch.agents.values()].filter((a) => a.status === 'failed');

  if (failedAgents.length > 0) {
    return `${failedAgents[0].name} failed — recovery may be needed`;
  }
  if (activeAgents.length > 0) {
    const names = activeAgents.slice(0, 2).map((a) => a.name).join(', ');
    return activeAgents.length > 2 ? `${names} and others actively executing` : `${names} actively executing`;
  }
  if (waitingAgents.length > 0) {
    return `${waitingAgents[0].name} waiting on upstream work`;
  }
  return 'Execution in progress';
}

function buildPendingWork(scratch: MissionProjectionScratch): RuntimeSummaryPendingWork[] {
  const pending: RuntimeSummaryPendingWork[] = [];

  for (const [interruptId, interrupt] of scratch.interrupts) {
    if (interrupt.status === 'pending') {
      pending.push({
        kind: 'interrupt',
        text: interrupt.reason
          ? `Human decision required: ${truncate(interrupt.reason, 100)}`
          : `Human decision required (${interruptId})`,
      });
    }
  }

  for (const [, agent] of scratch.agents) {
    if (agent.status === 'waiting') {
      pending.push({ kind: 'waiting', text: `${agent.name} waiting for input or handoff` });
    } else if (agent.status === 'reviewing') {
      pending.push({ kind: 'review', text: `${agent.name} in review` });
    } else if (agent.status === 'failed') {
      pending.push({ kind: 'blocked', text: `${agent.name} blocked after failure` });
    }
  }

  return pending;
}

function buildDeterministicNarrative(summary: Omit<RuntimeSummary, 'narrative' | 'source'>): string {
  const lines: string[] = [summary.headline];
  const recentProgress = summary.progress.slice(-5);
  if (recentProgress.length > 0) {
    lines.push(recentProgress.map((entry) => entry.text).join(' → '));
  }
  if (summary.pending_work.length > 0) {
    lines.push(`Pending: ${summary.pending_work[0].text}`);
  }
  return lines.join('. ') + '.';
}

export { getRuntimeNodeProjection, getRuntimeAgentSummary } from './nodeStateProjection.js';

export function projectRuntimeSummary(input: ProjectRuntimeSummaryInput): RuntimeSummary {
  const events = [...input.events]
    .filter((event) => input.up_to_sequence_num === undefined || event.sequence_num <= input.up_to_sequence_num)
    .sort((left, right) => left.sequence_num - right.sequence_num);

  const scratch = scanEventsToScratch(input.events, input.phase, input.up_to_sequence_num);

  const progress: RuntimeSummaryProgressEntry[] = [];
  const observations: RuntimeSummaryObservation[] = [];
  const decisions: RuntimeSummaryDecision[] = [];
  const evidence: RuntimeSummaryEvidence[] = [];
  const actions: RuntimeSummaryAction[] = [];
  const warnings: RuntimeSummaryWarning[] = [];
  const artifacts: RuntimeSummaryArtifact[] = [];

  for (const event of events) {
    const text = describeRuntimeEvent(event);
    if (text) {
      progress.push({
        sequence_num: event.sequence_num,
        timestamp: event.timestamp,
        event_type: event.event_type,
        actor: actorLabel(event),
        text,
      });
      classifyEvent(event, text, { observations, decisions, evidence, actions, warnings, artifacts });
    }
  }

  const interrupts: RuntimeSummaryInterrupt[] = [...scratch.interrupts.entries()].map(([interruptId, value]) => ({
    interrupt_id: interruptId,
    status: value.status,
    reason: value.reason,
    agent_id: value.agent_id,
  }));

  const pending_work = buildPendingWork(scratch);
  const requires_human = pending_work.some((item) => item.kind === 'interrupt')
    || scratch.phase === 'human_review'
    || scratch.phase === 'waiting_for_human';
  const is_blocked = requires_human || pending_work.some((item) => item.kind === 'blocked');
  const sequence_num = events.length > 0 ? events[events.length - 1].sequence_num : -1;

  const nodes = projectAllNodeStates({
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    events: input.events,
    up_to_sequence_num: input.up_to_sequence_num,
    phase: scratch.phase,
  });

  const base = {
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    sequence_num,
    generated_at: new Date().toISOString(),
    objective: input.objective,
    status: input.status,
    phase: scratch.phase,
    headline: buildHeadline(scratch, input.status, requires_human),
    progress,
    observations,
    decisions,
    evidence,
    actions,
    pending_work,
    warnings,
    artifacts,
    interrupts,
    agents: nodes,
    nodes,
    is_blocked,
    requires_human,
  };

  return {
    ...base,
    source: 'deterministic',
    narrative: buildDeterministicNarrative(base),
  };
}
