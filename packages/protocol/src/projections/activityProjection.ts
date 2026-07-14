import type {
  MissionEventRecord,
  NodeStatus,
  RuntimeActivity,
  RuntimeActivityKind,
} from '../types.js';
import { orderFrameEvents } from './runtimeProjection.js';

export interface RuntimeActivityEvidence {
  id: string;
  operationName?: string;
  eventType?: string;
  attributes?: Record<string, unknown>;
  status?: NodeStatus;
  sequenceNum?: number;
  timestamp?: string;
  durationMs?: number;
  actor?: string;
  sourceSpanId?: string;
  parentSpanId?: string;
}

function stringValue(
  attributes: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(
  attributes: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function classifyActivity(
  operationName: string | undefined,
  eventType: string | undefined,
  attributes: Record<string, unknown>,
): RuntimeActivityKind {
  const universalEvent =
    eventType === undefined ||
    eventType === 'agent.registered' ||
    eventType === 'delegation' ||
    eventType === 'escalation' ||
    eventType.startsWith('span.') ||
    eventType.startsWith('task.') ||
    eventType.startsWith('tool.') ||
    eventType.startsWith('memory.') ||
    eventType.startsWith('artifact.') ||
    eventType.startsWith('interrupt.') ||
    eventType.startsWith('handoff.') ||
    eventType.startsWith('review.') ||
    eventType.startsWith('mission.');
  if (!universalEvent) return 'runtime';

  const spanKind = stringValue(attributes, 'agent.span.kind');
  if (
    eventType?.startsWith('interrupt.') ||
    operationName === 'human.input' ||
    spanKind === 'human' ||
    spanKind === 'agent.human.input'
  ) return 'human';
  if (
    operationName === 'invoke_agent' ||
    spanKind === 'invoke_agent' ||
    spanKind === 'agent' ||
    stringValue(attributes, 'agentlens.node.type') === 'agent' ||
    stringValue(attributes, 'agentlens.agent.name', 'agentlens.agent.id') !== undefined ||
    eventType === 'agent.registered'
  ) return 'agent';
  if (
    operationName === 'llm.call' ||
    stringValue(attributes, 'gen_ai.system', 'gen_ai.request.model')
  ) return 'llm';
  if (
    operationName === 'retrieval.search' ||
    stringValue(attributes, 'retrieval.backend', 'search.query')
  ) return 'retrieval';
  if (
    eventType?.startsWith('tool.') ||
    operationName === 'execute_tool' ||
    spanKind === 'execute_tool' ||
    stringValue(attributes, 'gen_ai.tool.name', 'tool_name')
  ) return 'tool';
  if (eventType?.startsWith('memory.') || operationName?.startsWith('memory.')) return 'memory';
  if (eventType?.startsWith('artifact.') || operationName?.startsWith('artifact.')) return 'artifact';
  if (operationName?.startsWith('runtime.checkpoint.')) return 'checkpoint';
  if (
    eventType?.startsWith('task.') ||
    eventType?.startsWith('mission.') ||
    operationName === 'workflow.step' ||
    operationName === 'workflow.transition' ||
    operationName === 'mission.execute' ||
    operationName === 'mission.lifecycle' ||
    stringValue(attributes, 'gen_ai.workflow.step_id')
  ) return 'workflow';
  return 'runtime';
}

function activityName(
  kind: RuntimeActivityKind,
  operationName: string | undefined,
  attributes: Record<string, unknown>,
): string | undefined {
  switch (kind) {
    case 'agent':
      return stringValue(
        attributes,
        'gen_ai.agent.name',
        'gen_ai.agent.id',
        'agentlens.agent.name',
        'agentlens.agent.id',
      );
    case 'tool':
      return stringValue(attributes, 'gen_ai.tool.name', 'tool_name');
    case 'llm':
      return stringValue(attributes, 'gen_ai.request.model');
    case 'retrieval':
      return stringValue(attributes, 'retrieval.backend');
    case 'workflow':
      return stringValue(
        attributes,
        'task',
        'gen_ai.workflow.step_id',
        'gen_ai.agent.task.description',
      ) ?? operationName;
    case 'memory':
      return stringValue(attributes, 'memory_key', 'gen_ai.agent.memory.key', 'key');
    case 'artifact':
      return stringValue(attributes, 'artifact_name', 'name');
    case 'checkpoint':
      return stringValue(attributes, 'checkpoint_id');
    default:
      return operationName;
  }
}

function kindLabel(kind: RuntimeActivityKind): string {
  const labels: Record<RuntimeActivityKind, string> = {
    agent: 'Agent',
    tool: 'Tool',
    llm: 'LLM',
    retrieval: 'Retrieval',
    workflow: 'Workflow step',
    memory: 'Memory',
    artifact: 'Artifact',
    human: 'Human',
    checkpoint: 'Checkpoint',
    runtime: 'Runtime',
  };
  return labels[kind];
}

function actionLabel(kind: RuntimeActivityKind, eventType?: string): string {
  if (kind === 'tool' && eventType === 'tool.completed') return 'Tool returned';
  if (kind === 'retrieval' && eventType === 'tool.completed') return 'Retrieval returned';
  const labels: Record<RuntimeActivityKind, string> = {
    agent: 'Agent invoked',
    tool: 'Tool called',
    llm: 'LLM generated',
    retrieval: 'Retrieval searched',
    workflow: 'Workflow advanced',
    memory: 'Memory accessed',
    artifact: 'Artifact produced',
    human: 'Human input requested',
    checkpoint: 'Checkpoint recorded',
    runtime: 'Runtime activity',
  };
  return labels[kind];
}

function outcomeLabel(status: NodeStatus, eventType?: string): string {
  if (eventType?.includes('failed') || eventType?.includes('error')) return 'Failed';
  if (eventType === 'interrupt.requested') return 'Waiting';
  if (
    eventType?.includes('completed') ||
    eventType?.includes('created') ||
    eventType?.includes('written') ||
    eventType?.includes('read')
  ) return 'Completed';
  const labels: Record<NodeStatus, string> = {
    idle: 'Recorded',
    active: 'Active',
    completed: 'Completed',
    failed: 'Failed',
    waiting: 'Waiting',
    reviewing: 'Reviewing',
    unknown: 'Unknown',
  };
  return labels[status];
}

export function projectRuntimeActivity(evidence: RuntimeActivityEvidence): RuntimeActivity {
  const attributes = evidence.attributes ?? {};
  const kind = classifyActivity(evidence.operationName, evidence.eventType, attributes);
  const name = activityName(kind, evidence.operationName, attributes);
  const type = kindLabel(kind);
  const status = evidence.status ?? (
    evidence.eventType?.includes('failed') ? 'failed'
      : evidence.eventType === 'interrupt.requested' ? 'waiting'
        : evidence.eventType?.includes('completed') ? 'completed'
          : 'active'
  );
  return {
    id: evidence.id,
    kind,
    label: name && name !== type ? `${type} · ${name}` : type,
    subtitle: name && evidence.operationName && name !== evidence.operationName
      ? evidence.operationName
      : undefined,
    action: actionLabel(kind, evidence.eventType),
    outcome: outcomeLabel(status, evidence.eventType),
    status,
    sequence_num: evidence.sequenceNum,
    timestamp: evidence.timestamp,
    duration_ms: evidence.durationMs,
    actor: evidence.actor,
    source_span_id: evidence.sourceSpanId,
    parent_span_id: evidence.parentSpanId,
    provenance: 'projection',
  };
}

function specificity(kind: RuntimeActivityKind): number {
  return kind === 'runtime' ? 0 : kind === 'workflow' ? 1 : 2;
}

/** Build a compact, stable Runtime Story while retaining the full event stream elsewhere. */
export function projectRuntimeActivities(
  events: readonly MissionEventRecord[],
  limit = 8,
): RuntimeActivity[] {
  const bySpanAndKind = new Map<string, RuntimeActivity>();
  const sorted = orderFrameEvents(events);

  for (const event of sorted) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const operationName = stringValue(payload, 'operation_name');
    const durationMs = numberValue(payload, 'duration_ms');
    const candidate = projectRuntimeActivity({
      id: event.id,
      operationName,
      eventType: event.event_type,
      attributes: payload,
      sequenceNum: event.sequence_num,
      timestamp: event.timestamp,
      durationMs,
      actor: event.agent_id,
      sourceSpanId: event.span_id,
      parentSpanId: event.parent_span_id,
    });

    // Unknown workload events remain available as recorded evidence, not Core story.
    if (candidate.kind === 'runtime') continue;
    const key = `${event.span_id ?? event.id}:${candidate.kind}`;
    const current = bySpanAndKind.get(key);
    if (!current || specificity(candidate.kind) >= specificity(current.kind)) {
      // Prefer a terminal outcome, otherwise keep the earliest causal position.
      if (!current || candidate.status === 'failed' || candidate.status === 'completed') {
        bySpanAndKind.set(key, {
          ...candidate,
          sequence_num: current?.sequence_num ?? candidate.sequence_num,
          duration_ms: candidate.duration_ms ?? current?.duration_ms,
        });
      }
    }
  }

  const compareActivities = (a: RuntimeActivity, b: RuntimeActivity) =>
    Date.parse(a.timestamp ?? '') - Date.parse(b.timestamp ?? '')
    || (a.sequence_num ?? 0) - (b.sequence_num ?? 0);
  const activities = [...bySpanAndKind.values()].sort(compareActivities);
  if (activities.length <= limit) return activities;

  const first = activities.slice(0, 2);
  const important = activities
    .slice(2, -1)
    .filter((activity) => activity.status === 'failed' || activity.status === 'waiting');
  const selected = new Map(first.map((activity) => [activity.id, activity]));
  for (const activity of important) selected.set(activity.id, activity);
  for (const activity of activities.slice().reverse()) {
    if (selected.size >= limit) break;
    selected.set(activity.id, activity);
  }
  return [...selected.values()]
    .sort(compareActivities)
    .slice(0, limit);
}
