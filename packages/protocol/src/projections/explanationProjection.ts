import type {
  EventEnvelope,
  RunStatus,
  RuntimeActivityField,
  RuntimeExplanationActivity,
  RuntimeExplanationActivityKind,
  RuntimeExplanationConsistencyCode,
  RuntimeExplanationConsistencyFlag,
  RuntimeExplanationEvidenceRef,
  RuntimeExplanationMergeGroup,
  RuntimeExplanationParallelGroup,
  RuntimeExplanationProjection,
  RuntimeExplanationRelation,
  RuntimeExplanationRedaction,
  RuntimeExplanationRunOutcome,
  RuntimeExplanationValue,
  RuntimeOperatorActivityRecord,
  RuntimePhaseLabel,
  RuntimePhaseSummary,
  RuntimeProgressMarker,
  RuntimeSelectedActivityState,
} from '../types.js';
import { eventsThroughCursor } from './runtimeProjection.js';

export interface ProjectRuntimeExplanationInput {
  mission_id: string;
  branch_id: string;
  events: EventEnvelope[];
  as_of_sequence_num?: number;
}

interface ActivityAccumulator {
  id: string;
  kind: RuntimeExplanationActivityKind;
  title: string;
  subtitle?: string;
  action: string;
  actor?: string;
  source_span_id?: string;
  parent_span_id?: string;
  sequence_num?: number;
  invocation_id?: string;
  started_at?: string;
  ended_at?: string;
  started_at_unix_nano?: string;
  ended_at_unix_nano?: string;
  terminal_status?: RuntimeExplanationRunOutcome;
  inputs?: Record<string, RuntimeExplanationValue>;
  outputs?: Record<string, RuntimeExplanationValue>;
  error?: Record<string, RuntimeExplanationValue>;
  artifacts?: RuntimeExplanationValue[];
  evidence_refs: RuntimeExplanationEvidenceRef[];
}

interface ActivityEventProjection {
  id: string;
  kind: RuntimeExplanationActivityKind;
  title: string;
  subtitle?: string;
  action: string;
  phase: 'start' | 'terminal' | 'instant';
  completed_status: RuntimeExplanationRunOutcome;
  inputs?: Record<string, RuntimeExplanationValue>;
  outputs?: Record<string, RuntimeExplanationValue>;
  error?: Record<string, RuntimeExplanationValue>;
  artifacts?: RuntimeExplanationValue[];
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberValue(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function eventTimestampNanos(event: EventEnvelope): string | undefined {
  const value = event.metadata?.runtime_timestamp_unix_nano;
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

function exactDurationMs(start: string | undefined, end: string | undefined): number | undefined {
  if (!start || !end) return undefined;
  const startNano = BigInt(start);
  const endNano = BigInt(end);
  return endNano >= startNano ? Number(endNano - startNano) / 1e6 : undefined;
}

function evidenceRef(event: EventEnvelope): RuntimeExplanationEvidenceRef {
  return {
    event_id: event.id,
    sequence_num: event.sequence_num,
    timestamp: event.timestamp,
    branch_id: event.branch_id,
    span_id: event.span_id,
    source_event_id: event.source_event_id,
  };
}

function redactionFromEvent(event: EventEnvelope): RuntimeExplanationRedaction {
  return {
    kind: 'redaction',
    policy_decision: 'redact',
    reason: event.policy?.reason,
    evidence_refs: [evidenceRef(event)],
  };
}

function redactableValue(event: EventEnvelope, value: unknown): RuntimeExplanationValue | undefined {
  if (value === undefined) return undefined;
  if (event.policy?.decision === 'redact') {
    return redactionFromEvent(event);
  }
  return value as RuntimeExplanationValue;
}

function kindLabel(kind: RuntimeExplanationActivityKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'workflow':
      return 'Workflow step';
    case 'tool':
      return 'Tool';
    case 'llm':
      return 'LLM';
    case 'retrieval':
      return 'Retrieval';
    case 'memory':
      return 'Memory';
    case 'artifact':
      return 'Artifact';
    case 'human':
      return 'Human';
    case 'checkpoint':
      return 'Checkpoint';
  }
}

function actionLabel(kind: RuntimeExplanationActivityKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent invoked';
    case 'workflow':
      return 'Workflow advanced';
    case 'tool':
      return 'Tool called';
    case 'llm':
      return 'LLM generated';
    case 'retrieval':
      return 'Retrieval searched';
    case 'memory':
      return 'Memory accessed';
    case 'artifact':
      return 'Artifact recorded';
    case 'human':
      return 'Human input requested';
    case 'checkpoint':
      return 'Checkpoint recorded';
  }
}

function rawInvocationIdFromEvent(event: EventEnvelope, kind: RuntimeExplanationActivityKind): string | undefined {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const toolCallId =
    event.causal?.tool_call_id ??
    stringValue(payload, 'tool_call_id', 'gen_ai.tool.call_id');
  const llmRequestId = stringValue(payload, 'gen_ai.request.id', 'llm.request_id', 'request_id');
  const retrievalRequestId = stringValue(
    payload,
    'retrieval.request_id',
    'retrieval_request_id',
    'search.request_id',
    'request_id',
  );
  const agentInvocationId = stringValue(
    payload,
    'gen_ai.agent.invocation_id',
    'agent.invocation_id',
    'invocation_id',
  );
  const interruptId = stringValue(payload, 'interrupt_id', 'gen_ai.agent.interrupt.id');
  const checkpointId = stringValue(payload, 'checkpoint_id');
  const workflowStepId = stringValue(payload, 'gen_ai.workflow.step_id');
  const artifactId = stringValue(payload, 'artifact_id', 'artifact_name', 'name');

  switch (kind) {
    case 'tool':
      return toolCallId ?? agentInvocationId;
    case 'llm':
      return llmRequestId ?? agentInvocationId;
    case 'retrieval':
      return retrievalRequestId ?? toolCallId ?? agentInvocationId;
    case 'human':
      return interruptId;
    case 'checkpoint':
      return checkpointId;
    case 'workflow':
      return workflowStepId;
    case 'artifact':
      return artifactId;
    case 'agent':
      return agentInvocationId ?? toolCallId;
    default:
      return undefined;
  }
}

function valueCondition(value: RuntimeExplanationValue | undefined): RuntimeOperatorActivityRecord['actor']['condition'] {
  if (value === undefined) return 'not_recorded';
  if (typeof value === 'string' && value.length === 0) return 'recorded_empty';
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'redaction') {
    return 'redacted';
  }
  return 'recorded';
}

function field<T = RuntimeExplanationValue>(
  value: T | undefined,
  refs: RuntimeExplanationEvidenceRef[],
  fallbackCondition?: RuntimeOperatorActivityRecord['actor']['condition'],
): RuntimeActivityField<T> {
  return {
    value,
    condition: fallbackCondition ?? valueCondition(value as RuntimeExplanationValue | undefined),
    evidence_refs: refs,
  };
}

function runtimeOutcomeLabel(status: RuntimeExplanationRunOutcome): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'waiting':
      return 'Waiting';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Active';
  }
}

function classifyKind(event: EventEnvelope): RuntimeExplanationActivityKind | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const operationName = stringValue(payload, 'operation_name');
  const spanKind = stringValue(payload, 'agent.span.kind');

  if (event.event_type.startsWith('interrupt.') || spanKind === 'human' || spanKind === 'agent.human.input') {
    return 'human';
  }
  if (operationName === 'runtime.checkpoint.save' || operationName === 'runtime.checkpoint.load') {
    return 'checkpoint';
  }
  if (
    event.event_type.startsWith('artifact.') ||
    operationName?.startsWith('artifact.') ||
    stringValue(payload, 'artifact_name', 'artifact_id')
  ) {
    return 'artifact';
  }
  if (event.event_type.startsWith('memory.') || operationName?.startsWith('memory.')) {
    return 'memory';
  }
  if (operationName === 'retrieval.search' || stringValue(payload, 'retrieval.backend', 'search.query')) {
    return 'retrieval';
  }
  if (operationName === 'llm.call' || stringValue(payload, 'gen_ai.system', 'gen_ai.request.model')) {
    return 'llm';
  }
  if (
    event.event_type.startsWith('tool.') ||
    operationName === 'execute_tool' ||
    spanKind === 'execute_tool' ||
    stringValue(payload, 'gen_ai.tool.name', 'tool_name')
  ) {
    return 'tool';
  }
  if (
    event.event_type.startsWith('task.') ||
    operationName === 'workflow.step' ||
    operationName === 'workflow.transition' ||
    stringValue(payload, 'gen_ai.workflow.step_id')
  ) {
    return 'workflow';
  }
  if (
    event.event_type === 'agent.registered' ||
    operationName === 'invoke_agent' ||
    spanKind === 'invoke_agent' ||
    stringValue(payload, 'gen_ai.agent.id', 'agentlens.agent.id', 'gen_ai.agent.name')
  ) {
    return 'agent';
  }
  return null;
}

function displayName(kind: RuntimeExplanationActivityKind, payload: Record<string, unknown>): string | undefined {
  switch (kind) {
    case 'agent':
      return stringValue(payload, 'gen_ai.agent.name', 'agentlens.agent.name', 'gen_ai.agent.id', 'agentlens.agent.id', 'name');
    case 'workflow':
      return stringValue(payload, 'gen_ai.workflow.step_id', 'task', 'gen_ai.agent.task.description');
    case 'tool':
      return stringValue(payload, 'gen_ai.tool.name', 'tool_name');
    case 'llm':
      return stringValue(payload, 'gen_ai.request.model');
    case 'retrieval':
      return stringValue(payload, 'retrieval.backend', 'search.query');
    case 'memory':
      return stringValue(payload, 'memory_key', 'gen_ai.agent.memory.key', 'key');
    case 'artifact':
      return stringValue(payload, 'artifact_name', 'artifact_id', 'name');
    case 'human':
      return stringValue(payload, 'reason', 'gen_ai.agent.interrupt.reason');
    case 'checkpoint':
      return stringValue(payload, 'checkpoint_id') ?? stringValue(payload, 'operation_name');
  }
}

function buildTitle(kind: RuntimeExplanationActivityKind, payload: Record<string, unknown>): { title: string; subtitle?: string } {
  const label = kindLabel(kind);
  const name = displayName(kind, payload);
  const invocationId = stringValue(
    payload,
    'tool_call_id',
    'gen_ai.tool.call_id',
    'gen_ai.request.id',
    'llm.request_id',
    'retrieval.request_id',
    'retrieval_request_id',
    'search.request_id',
    'gen_ai.agent.invocation_id',
    'agent.invocation_id',
    'interrupt_id',
    'checkpoint_id',
    'gen_ai.workflow.step_id',
    'artifact_id',
  );
  const operationName = stringValue(payload, 'operation_name');
  const titleParts = [label];
  if (name && name !== label) titleParts.push(name);
  if (invocationId && invocationId !== name) titleParts.push(invocationId);
  return {
    title: titleParts.join(' | '),
    subtitle: operationName && operationName !== name ? operationName : undefined,
  };
}

function resolveActivityId(event: EventEnvelope, kind: RuntimeExplanationActivityKind): string | null {
  const rawInvocationId = rawInvocationIdFromEvent(event, kind);

  switch (kind) {
    case 'tool':
      if (rawInvocationId) {
        return `tool:${rawInvocationId}`;
      }
      break;
    case 'llm':
      if (rawInvocationId) {
        return `llm:${rawInvocationId}`;
      }
      break;
    case 'retrieval':
      if (rawInvocationId) {
        return `retrieval:${rawInvocationId}`;
      }
      break;
    case 'human':
      if (rawInvocationId) {
        return `human:${rawInvocationId}`;
      }
      break;
    case 'checkpoint':
      if (rawInvocationId) {
        return `checkpoint:${rawInvocationId}`;
      }
      break;
    case 'workflow':
      if (rawInvocationId) {
        return `workflow:${rawInvocationId}`;
      }
      break;
    case 'artifact':
      if (rawInvocationId) {
        return `artifact:${rawInvocationId}`;
      }
      break;
    case 'agent':
      if (rawInvocationId) {
        return `agent:${rawInvocationId}`;
      }
      break;
    default:
      break;
  }

  if (event.span_id) {
    return `${kind}:span:${event.span_id}`;
  }
  return `${kind}:event:${event.id}`;
}

function extractActivityIo(
  kind: RuntimeExplanationActivityKind,
  event: EventEnvelope,
  payload: Record<string, unknown>,
): { input: RuntimeExplanationValue | undefined; output: RuntimeExplanationValue | undefined } {
  const inputKeys =
    kind === 'llm'
      ? (['gen_ai.prompt', 'gen_ai.tool.input', 'tool_input', 'input'] as const)
      : (['gen_ai.tool.input', 'tool_input', 'input'] as const);
  const outputKeys =
    kind === 'llm'
      ? (['gen_ai.completion', 'gen_ai.response', 'gen_ai.tool.output', 'tool_output', 'output'] as const)
      : (['gen_ai.tool.output', 'tool_output', 'output'] as const);

  const pick = (keys: readonly string[]): RuntimeExplanationValue | undefined => {
    for (const key of keys) {
      const raw = payload[key];
      if (raw === undefined || raw === null) continue;
      const value = redactableValue(event, raw);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  return { input: pick(inputKeys), output: pick(outputKeys) };
}

function classifyEventActivity(event: EventEnvelope): ActivityEventProjection | null {
  const kind = classifyKind(event);
  if (!kind) return null;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const id = resolveActivityId(event, kind);
  if (!id) return null;
  const title = buildTitle(kind, payload);
  const invocationId = rawInvocationIdFromEvent(event, kind);
  const { input: activityInput, output: activityOutput } = extractActivityIo(kind, event, payload);
  const errorValue = redactableValue(event, event.error?.original_error ?? payload.error ?? payload.reason);
  const artifactValue = redactableValue(
    event,
    kind === 'artifact'
      ? {
          artifact_name: stringValue(payload, 'artifact_name', 'name'),
          artifact_type: stringValue(payload, 'artifact_type', 'type'),
        }
      : undefined,
  );

  const base = {
    id,
    kind,
    title:
      invocationId && !title.title.includes(invocationId)
        ? `${title.title} | ${invocationId}`
        : title.title,
    subtitle: title.subtitle,
    action: actionLabel(kind),
  } satisfies Omit<ActivityEventProjection, 'phase' | 'completed_status'>;

  const explicitToolStatus = stringValue(payload, 'gen_ai.tool.status', 'tool_status', 'status');
  const toolCalledTerminalStatus =
    event.event_type === 'tool.called'
      ? explicitToolStatus === 'completed'
        ? 'completed'
        : explicitToolStatus === 'failed'
          ? 'failed'
          : undefined
      : undefined;

  switch (event.event_type) {
    case 'tool.called':
      return {
        ...base,
        phase: toolCalledTerminalStatus ? 'instant' : 'start',
        completed_status: toolCalledTerminalStatus ?? 'active',
        inputs: activityInput === undefined ? undefined : { input: activityInput },
        outputs: activityOutput === undefined ? undefined : { output: activityOutput },
        error:
          toolCalledTerminalStatus === 'failed' && errorValue !== undefined
            ? { error: errorValue }
            : undefined,
      };
    case 'tool.completed':
      return {
        ...base,
        phase: 'terminal',
        completed_status: 'completed',
        outputs: activityOutput === undefined ? undefined : { output: activityOutput },
      };
    case 'tool.failed':
      return {
        ...base,
        phase: 'terminal',
        completed_status: 'failed',
        error: errorValue === undefined ? undefined : { error: errorValue },
      };
    case 'interrupt.requested':
      return {
        ...base,
        phase: 'start',
        completed_status: 'waiting',
        inputs: redactableValue(event, stringValue(payload, 'reason', 'gen_ai.agent.interrupt.reason')) === undefined
          ? undefined
          : { reason: redactableValue(event, stringValue(payload, 'reason', 'gen_ai.agent.interrupt.reason'))! },
      };
    case 'interrupt.decision':
    case 'interrupt.resumed':
      return {
        ...base,
        phase: 'terminal',
        completed_status: 'completed',
        outputs: redactableValue(event, payload.decision ?? payload.comment ?? payload.decision_payload) === undefined
          ? undefined
          : { decision: redactableValue(event, payload.decision ?? payload.comment ?? payload.decision_payload)! },
      };
    case 'memory.written':
    case 'memory.read':
    case 'artifact.created':
    case 'artifact.updated':
      return {
        ...base,
        phase: 'instant',
        completed_status: 'completed',
        outputs: activityOutput === undefined ? undefined : { output: activityOutput },
        artifacts: artifactValue === undefined ? undefined : [artifactValue],
      };
    case 'span.completed':
    case 'task.completed':
      return {
        ...base,
        phase: 'terminal',
        completed_status: 'completed',
        outputs: activityOutput === undefined ? undefined : { output: activityOutput },
      };
    case 'span.failed':
    case 'task.failed':
      return {
        ...base,
        phase: 'terminal',
        completed_status: 'failed',
        error: errorValue === undefined ? undefined : { error: errorValue },
      };
    default:
      break;
  }

  if (event.event_type === 'task.started' || event.event_type === 'span.started' || event.id === event.span_id) {
    return {
      ...base,
      phase: 'start',
      completed_status: 'active',
      inputs: activityInput === undefined ? undefined : { input: activityInput },
    };
  }

  return {
    ...base,
    phase: 'instant',
    completed_status: 'completed',
    outputs: activityOutput === undefined ? undefined : { output: activityOutput },
    artifacts: artifactValue === undefined ? undefined : [artifactValue],
  };
}

function deriveSelectedActivityState(
  activities: RuntimeExplanationActivity[],
): RuntimeSelectedActivityState {
  if (activities.length === 0) {
    return { kind: 'no_activity', reason: 'no_selectable_activity' };
  }
  return { kind: 'overview', reason: 'frame_overview' };
}

function mergeObject(
  current: Record<string, RuntimeExplanationValue> | undefined,
  update: Record<string, RuntimeExplanationValue> | undefined,
): Record<string, RuntimeExplanationValue> | undefined {
  if (!update) return current;
  return { ...(current ?? {}), ...update };
}

function createFlag(
  code: RuntimeExplanationConsistencyCode,
  severity: RuntimeExplanationConsistencyFlag['severity'],
  message: string,
  refs: RuntimeExplanationEvidenceRef[],
  activity_id?: string,
  relation_id?: string,
): RuntimeExplanationConsistencyFlag {
  return { code, severity, message, activity_id, relation_id, evidence_refs: refs };
}

function dedupeFlags(flags: RuntimeExplanationConsistencyFlag[]): RuntimeExplanationConsistencyFlag[] {
  const deduped = new Map<string, RuntimeExplanationConsistencyFlag>();
  for (const flag of flags) {
    const conditionIdentity =
      flag.code === 'dangling_parent_span' || flag.code === 'shared_span_multiple_invocations'
        ? `${flag.code}:${flag.message}`
        : `${flag.code}:${flag.activity_id ?? ''}:${flag.relation_id ?? ''}:${flag.message}`;
    const existing = deduped.get(conditionIdentity);
    if (!existing) {
      deduped.set(conditionIdentity, { ...flag, evidence_refs: [...flag.evidence_refs] });
      continue;
    }
    const refs = new Map(existing.evidence_refs.map((ref) => [`${ref.branch_id ?? ''}:${ref.sequence_num}:${ref.event_id}`, ref]));
    for (const ref of flag.evidence_refs) refs.set(`${ref.branch_id ?? ''}:${ref.sequence_num}:${ref.event_id}`, ref);
    existing.evidence_refs = [...refs.values()];
  }
  return [...deduped.values()];
}

function hasPath(relations: RuntimeExplanationRelation[], source: string, target: string): boolean {
  const adjacency = new Map<string, string[]>();
  for (const relation of relations) {
    const current = adjacency.get(relation.source_activity_id) ?? [];
    current.push(relation.target_activity_id);
    adjacency.set(relation.source_activity_id, current);
  }
  const queue = [source];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return false;
}

function timestampsOverlap(
  left: RuntimeExplanationActivity,
  right: RuntimeExplanationActivity,
  asOfTimestamp: string | undefined,
): boolean {
  const leftStart = parseTimestamp(left.started_at);
  const rightStart = parseTimestamp(right.started_at);
  const leftEnd = parseTimestamp(left.ended_at ?? asOfTimestamp);
  const rightEnd = parseTimestamp(right.ended_at ?? asOfTimestamp);
  if (leftStart === undefined || rightStart === undefined || leftEnd === undefined || rightEnd === undefined) {
    return false;
  }
  return Math.max(leftStart, rightStart) <= Math.min(leftEnd, rightEnd);
}

function deriveRunStatus(runOutcome: RuntimeExplanationRunOutcome): RunStatus {
  switch (runOutcome) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'waiting':
      return 'Waiting';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Active';
  }
}

function deriveRuntimePhase(
  runOutcome: RuntimeExplanationRunOutcome,
  sequenceNum: number,
  refs: RuntimeExplanationEvidenceRef[],
): RuntimePhaseSummary {
  const label: RuntimePhaseLabel =
    runOutcome === 'completed'
      ? 'Completed'
      : runOutcome === 'failed'
        ? 'Failed'
      : runOutcome === 'waiting'
          ? 'Waiting'
          : runOutcome === 'unknown'
            ? 'Unknown'
          : refs.length === 0
            ? 'Unknown'
            : 'Active Work';
  const basis = refs.length === 0 ? 'unknown' : 'derived';
  return {
    id: `${basis}:${label}:${sequenceNum}`,
    label,
    basis,
    start_sequence_num: sequenceNum,
    end_sequence_num: sequenceNum,
    evidence_refs: refs,
  };
}

function buildOperatorFacingRecord(
  activity: RuntimeExplanationActivity,
  downstreamEffect: string | undefined,
  fieldRefs: RuntimeExplanationEvidenceRef[],
): RuntimeOperatorActivityRecord {
  const target = activity.title
    .split(' | ')
    .slice(1)
    .filter(Boolean)
    .join(' | ');
  const actorField = field(activity.actor, fieldRefs);
  const actionField = field(activity.action, fieldRefs);
  const targetField = field(target || undefined, fieldRefs);
  const outcomeField = field(activity.outcome ?? runtimeOutcomeLabel(activity.status), fieldRefs);
  const triggerField = field(activity.subtitle ?? activity.parent_span_id ?? undefined, fieldRefs);
  const inputValue = activity.inputs?.input ?? activity.inputs?.reason;
  const outputValue = activity.outputs?.output ?? activity.outputs?.decision;
  const missingParts = [
    actorField.condition !== 'recorded' ? 'actor' : null,
    actionField.condition !== 'recorded' ? 'action' : null,
    targetField.condition !== 'recorded' ? 'target' : null,
    outcomeField.condition !== 'recorded' ? 'outcome' : null,
  ].filter(Boolean) as string[];
  const limitation =
    missingParts.length > 0
      ? `Incomplete story-critical context: ${missingParts.join(', ')} not fully recorded`
      : undefined;

  return {
    primary_label: activity.title,
    actor: actorField,
    action: actionField,
    target: targetField,
    status_or_outcome: outcomeField,
    trigger: triggerField,
    input: field(inputValue, fieldRefs),
    output: field(outputValue, fieldRefs),
    downstream_effect: field(downstreamEffect, fieldRefs),
    artifacts: field(activity.artifacts, fieldRefs),
    evidence_condition: field(
      missingParts.length > 0 ? limitation ?? 'incomplete' : 'recorded',
      fieldRefs,
      missingParts.length > 0 ? 'inconsistent' : 'recorded',
    ),
    story_critical_sufficient: missingParts.length === 0,
    limitation,
  };
}

export function projectRuntimeExplanation(
  input: ProjectRuntimeExplanationInput,
): RuntimeExplanationProjection {
  const filtered = eventsThroughCursor(input.events, input.as_of_sequence_num);

  const frameEvent = filtered.reduce<EventEnvelope | undefined>((latest, event) =>
    !latest || event.sequence_num > latest.sequence_num ? event : latest,
  undefined);
  const asOfSequenceNum = input.as_of_sequence_num ?? frameEvent?.sequence_num ?? 0;
  const admittedAt = frameEvent?.metadata?.evidence_admitted_at;
  const asOfTimestamp = typeof admittedAt === 'string' ? admittedAt : frameEvent?.timestamp;
  const activityMap = new Map<string, ActivityAccumulator>();
  const eventToActivityId = new Map<string, string>();
  const spanToActivityIds = new Map<string, Set<string>>();
  const flags: RuntimeExplanationConsistencyFlag[] = [];
  const pendingInterrupts = new Set<string>();
  let runStartAt: string | undefined;
  let runCompletedAt: string | undefined;
  let runFailedAt: string | undefined;
  let runStartNano: string | undefined;
  let runCompletedNano: string | undefined;
  let runFailedNano: string | undefined;
  const runtimeRootCandidateIds = new Set<string>();
  let explicitRunStartedAt: string | undefined;
  const runTerminalEvidence: Array<{
    state: 'completed' | 'failed';
    basis: string;
    ref: RuntimeExplanationEvidenceRef;
  }> = [];

  for (const event of filtered) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    const lifecycle = metadata.runtime_lifecycle;
    const lifecycleBasis = typeof metadata.runtime_lifecycle_basis === 'string'
      ? metadata.runtime_lifecycle_basis
      : 'recorded_event';
    if (metadata.runtime_root_candidate === true && event.span_id) runtimeRootCandidateIds.add(event.span_id);
    if (
      lifecycle === 'started'
      && !runStartAt
    ) {
      runStartAt = event.timestamp;
      runStartNano = eventTimestampNanos(event);
    }
    if (lifecycle === 'started' && lifecycleBasis !== 'execution_root_span' && !explicitRunStartedAt) {
      explicitRunStartedAt = event.timestamp;
    }
    if (lifecycle === 'completed' || lifecycle === 'failed') {
      const ref = evidenceRef(event);
      runTerminalEvidence.push({ state: lifecycle, basis: lifecycleBasis, ref });
      if (lifecycle === 'completed') {
        runCompletedAt ??= event.timestamp;
        runCompletedNano ??= eventTimestampNanos(event);
      }
      if (lifecycle === 'failed') {
        runFailedAt ??= event.timestamp;
        runFailedNano ??= eventTimestampNanos(event);
      }
    }
    const interruptId = stringValue(payload, 'interrupt_id', 'gen_ai.agent.interrupt.id');
    if (event.event_type === 'interrupt.requested' && interruptId) pendingInterrupts.add(interruptId);
    if ((event.event_type === 'interrupt.decision' || event.event_type === 'interrupt.resumed') && interruptId) {
      pendingInterrupts.delete(interruptId);
    }

    const projection = classifyEventActivity(event);
    if (!projection) continue;

    const ref = evidenceRef(event);
    const existing = activityMap.get(projection.id);
    if (!existing) {
      activityMap.set(projection.id, {
        id: projection.id,
        kind: projection.kind,
        title: projection.title,
        subtitle: projection.subtitle,
        action: projection.action,
        actor: event.agent_id ?? event.actor_id,
        source_span_id: event.span_id,
        parent_span_id: event.parent_span_id ?? event.causal?.parent_span_id,
        sequence_num: event.sequence_num,
        invocation_id: rawInvocationIdFromEvent(event, projection.kind),
        evidence_refs: [ref],
        inputs: projection.inputs,
        outputs: projection.outputs,
        error: projection.error,
        artifacts: projection.artifacts,
      });
    } else {
      existing.evidence_refs.push(ref);
      existing.inputs = mergeObject(existing.inputs, projection.inputs);
      existing.outputs = mergeObject(existing.outputs, projection.outputs);
      existing.error = mergeObject(existing.error, projection.error);
      if (projection.artifacts?.length) {
        existing.artifacts = [...(existing.artifacts ?? []), ...projection.artifacts];
      }
    }

    const activity = activityMap.get(projection.id)!;
    eventToActivityId.set(event.id, projection.id);
    if (event.span_id) {
      const spanActivities = spanToActivityIds.get(event.span_id) ?? new Set<string>();
      spanActivities.add(projection.id);
      spanToActivityIds.set(event.span_id, spanActivities);
    }

    if (projection.phase === 'start') {
      if (!activity.started_at) {
        activity.started_at = event.timestamp;
        activity.started_at_unix_nano = eventTimestampNanos(event);
      }
      activity.sequence_num ??= event.sequence_num;
    } else if (projection.phase === 'instant') {
      activity.started_at ??= event.timestamp;
      activity.ended_at ??= event.timestamp;
      activity.started_at_unix_nano ??= eventTimestampNanos(event);
      activity.ended_at_unix_nano ??= eventTimestampNanos(event);
      activity.terminal_status = projection.completed_status;
    } else {
      if (!activity.started_at) {
        flags.push(
          createFlag(
            'missing_start',
            'warning',
            `Start evidence is missing for ${projection.id}.`,
            [ref],
            projection.id,
          ),
        );
      } else if (activity.ended_at) {
        if (activity.terminal_status !== projection.completed_status) {
          flags.push(
            createFlag(
              'duplicate_terminal',
              'error',
              `Conflicting terminal lifecycle outcomes were recorded for ${projection.id}.`,
              [ref],
              projection.id,
            ),
          );
        }
      } else {
        activity.ended_at = event.timestamp;
        activity.ended_at_unix_nano = eventTimestampNanos(event);
        activity.terminal_status = projection.completed_status;
      }
    }
  }

  for (const [spanId, ids] of spanToActivityIds.entries()) {
    if (ids.size > 1) {
      const related = [...ids].sort();
      const refs = related.flatMap((id) => activityMap.get(id)?.evidence_refs ?? []);
      flags.push(
        createFlag(
          'shared_span_multiple_invocations',
          'warning',
          `Span ${spanId} backs multiple invocation identities.`,
          refs,
        ),
      );
    }
  }

  const activities: RuntimeExplanationActivity[] = [...activityMap.values()]
    .map((activity) => {
      const startedAtMs = parseTimestamp(activity.started_at);
      const endedAtMs = parseTimestamp(activity.ended_at);
      if (startedAtMs !== undefined && endedAtMs !== undefined && endedAtMs < startedAtMs) {
        flags.push(
          createFlag(
            'timestamp_conflict',
            'warning',
            `Terminal timestamp precedes start timestamp for ${activity.id}.`,
            activity.evidence_refs,
            activity.id,
          ),
        );
      }
      const status: RuntimeExplanationRunOutcome =
        activity.terminal_status
        ?? (activity.kind === 'human' && activity.started_at && !activity.ended_at ? 'waiting' : 'active');
      if (activity.started_at && !activity.ended_at && status !== 'waiting') {
        flags.push(
          createFlag(
            'incomplete_lifecycle',
            'info',
            `Lifecycle has started but has no terminal evidence at this frame for ${activity.id}.`,
            activity.evidence_refs,
            activity.id,
          ),
        );
      }
      return {
        id: activity.id,
        kind: activity.kind,
        title: activity.title,
        subtitle: activity.subtitle,
        action: activity.action,
        status,
        outcome: runtimeOutcomeLabel(status),
        started_at: activity.started_at,
        ended_at: activity.ended_at,
        duration_ms: exactDurationMs(activity.started_at_unix_nano, activity.ended_at_unix_nano)
          ?? (startedAtMs !== undefined && endedAtMs !== undefined && endedAtMs >= startedAtMs
            ? endedAtMs - startedAtMs
            : undefined),
        actor: activity.actor,
        source_span_id: activity.source_span_id,
        parent_span_id: activity.parent_span_id,
        sequence_num: activity.sequence_num,
        invocation_id: activity.invocation_id,
        inputs: activity.inputs,
        outputs: activity.outputs,
        error: activity.error,
        artifacts: activity.artifacts,
        evidence_refs: [...activity.evidence_refs],
      };
    })
    .sort((left, right) => {
      const leftRaw = activityMap.get(left.id)?.started_at_unix_nano;
      const rightRaw = activityMap.get(right.id)?.started_at_unix_nano;
      if (leftRaw && rightRaw && leftRaw !== rightRaw) return BigInt(leftRaw) < BigInt(rightRaw) ? -1 : 1;
      const leftTime = Date.parse(left.started_at ?? left.ended_at ?? '');
      const rightTime = Date.parse(right.started_at ?? right.ended_at ?? '');
      if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
      return left.id.localeCompare(right.id);
    });

  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const primaryActivityBySpan = new Map<string, string>();
  for (const activity of activities) {
    if (activity.source_span_id && !primaryActivityBySpan.has(activity.source_span_id)) {
      primaryActivityBySpan.set(activity.source_span_id, activity.id);
    }
  }

  const relationMap = new Map<string, RuntimeExplanationRelation>();
  for (const event of filtered) {
    const currentActivityId = eventToActivityId.get(event.id);
    if (!currentActivityId) continue;
    const refs = [evidenceRef(event)];
    const candidates: Array<{
      basis: RuntimeExplanationRelation['basis'];
      source_activity_id: string | undefined;
      target_activity_id: string;
      danglingCode?: RuntimeExplanationConsistencyCode;
      danglingMessage?: string;
    }> = [
      {
        basis: 'trigger_reference',
        source_activity_id: event.causal?.triggered_by_event_id ? eventToActivityId.get(event.causal.triggered_by_event_id) : undefined,
        target_activity_id: currentActivityId,
        danglingCode: event.causal?.triggered_by_event_id ? 'dangling_trigger_reference' : undefined,
        danglingMessage: event.causal?.triggered_by_event_id
          ? `Triggered-by reference ${event.causal.triggered_by_event_id} could not be resolved at this frame.`
          : undefined,
      },
      {
        basis: 'decision_reference',
        source_activity_id: event.causal?.decision_for_event_id ? eventToActivityId.get(event.causal.decision_for_event_id) : undefined,
        target_activity_id: currentActivityId,
        danglingCode: event.causal?.decision_for_event_id ? 'dangling_decision_reference' : undefined,
        danglingMessage: event.causal?.decision_for_event_id
          ? `Decision reference ${event.causal.decision_for_event_id} could not be resolved at this frame.`
          : undefined,
      },
      {
        basis: 'parent_span',
        source_activity_id: event.causal?.parent_span_id ? primaryActivityBySpan.get(event.causal.parent_span_id) : undefined,
        target_activity_id: currentActivityId,
        danglingCode: event.causal?.parent_span_id ? 'dangling_parent_span' : undefined,
        danglingMessage: event.causal?.parent_span_id
          ? `Parent span ${event.causal.parent_span_id} could not be resolved at this frame.`
          : undefined,
      },
    ];

    for (const candidate of candidates) {
      if (!candidate.danglingCode && !candidate.source_activity_id) continue;
      if (!candidate.source_activity_id) {
        flags.push(createFlag(candidate.danglingCode!, 'warning', candidate.danglingMessage!, refs, currentActivityId));
        continue;
      }
      if (candidate.source_activity_id === candidate.target_activity_id) continue;
      const id = `${candidate.basis}:${candidate.source_activity_id}->${candidate.target_activity_id}`;
      const existing = relationMap.get(id);
      if (existing) {
        existing.evidence_refs = [...existing.evidence_refs, ...refs];
      } else {
        relationMap.set(id, {
          id,
          source_activity_id: candidate.source_activity_id,
          target_activity_id: candidate.target_activity_id,
          basis: candidate.basis,
          evidence_refs: refs,
        });
      }
    }
  }

  const relations = [...relationMap.values()].sort((left, right) => left.id.localeCompare(right.id));
  for (const relation of relations) {
    const source = activityById.get(relation.source_activity_id);
    const target = activityById.get(relation.target_activity_id);
    const sourceStart = parseTimestamp(source?.started_at ?? source?.ended_at);
    const targetStart = parseTimestamp(target?.started_at ?? target?.ended_at);
    if (sourceStart !== undefined && targetStart !== undefined && sourceStart > targetStart) {
      flags.push(
        createFlag(
          'timestamp_conflict',
          'info',
          `Causal order for ${relation.id} conflicts with event timestamps.`,
          relation.evidence_refs,
          undefined,
          relation.id,
        ),
      );
    }
  }

  const byParent = new Map<string, string[]>();
  for (const relation of relations) {
    if (relation.basis !== 'parent_span') continue;
    const current = byParent.get(relation.source_activity_id) ?? [];
    current.push(relation.target_activity_id);
    byParent.set(relation.source_activity_id, current);
  }

  const parallelGroups: RuntimeExplanationParallelGroup[] = [];
  for (const [parentId, children] of [...byParent.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const uniqueChildren = [...new Set(children)].sort();
    if (uniqueChildren.length < 2) continue;
    const adjacency = new Map<string, Set<string>>();
    for (const child of uniqueChildren) adjacency.set(child, new Set<string>());

    for (let index = 0; index < uniqueChildren.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < uniqueChildren.length; nextIndex += 1) {
        const left = activityById.get(uniqueChildren[index]);
        const right = activityById.get(uniqueChildren[nextIndex]);
        if (!left || !right) continue;
        const precedence =
          hasPath(relations, left.id, right.id)
          || hasPath(relations, right.id, left.id);
        if (precedence) continue;
        if (timestampsOverlap(left, right, asOfTimestamp)) {
          adjacency.get(left.id)!.add(right.id);
          adjacency.get(right.id)!.add(left.id);
        }
      }
    }

    const visited = new Set<string>();
    let emittedGroup = false;
    for (const child of uniqueChildren) {
      if (visited.has(child)) continue;
      const queue = [child];
      const component: string[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        component.push(current);
        for (const next of adjacency.get(current) ?? []) {
          if (!visited.has(next)) queue.push(next);
        }
      }
      if (component.length > 1) {
        emittedGroup = true;
        const activityIds = component.sort();
        const refs = activityIds.flatMap((id) => activityById.get(id)?.evidence_refs ?? []);
        parallelGroups.push({
          id: `parallel:${parentId}:${activityIds.join(',')}`,
          activity_ids: activityIds,
          basis: 'parent_overlap',
          evidence_refs: refs,
        });
      }
    }

    if (!emittedGroup) {
      const maybeAmbiguous = uniqueChildren
        .map((id) => activityById.get(id))
        .filter((activity): activity is RuntimeExplanationActivity => Boolean(activity))
        .some((activity) => activity.started_at !== undefined && activity.ended_at === undefined);
      if (maybeAmbiguous) {
        const refs = uniqueChildren.flatMap((id) => activityById.get(id)?.evidence_refs ?? []);
        flags.push(
          createFlag(
            'ambiguous_parallelism',
            'info',
            `Sibling activities under ${parentId} look concurrent but cannot be proven from the available evidence.`,
            refs,
          ),
        );
      }
    }
  }

  const mergeGroups: RuntimeExplanationMergeGroup[] = [];
  const parallelGroupByActivity = new Map<string, RuntimeExplanationParallelGroup[]>();
  for (const group of parallelGroups) {
    for (const activityId of group.activity_ids) {
      const existing = parallelGroupByActivity.get(activityId) ?? [];
      existing.push(group);
      parallelGroupByActivity.set(activityId, existing);
    }
  }
  const predecessorMap = new Map<string, string[]>();
  for (const relation of relations) {
    const current = predecessorMap.get(relation.target_activity_id) ?? [];
    current.push(relation.source_activity_id);
    predecessorMap.set(relation.target_activity_id, current);
  }
  for (const [targetId, predecessors] of [...predecessorMap.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
    const uniquePredecessors = [...new Set(predecessors)].sort();
    if (uniquePredecessors.length < 2) continue;
    const candidateGroup = parallelGroups.find((group) => uniquePredecessors.every((id) => group.activity_ids.includes(id)));
    if (!candidateGroup) continue;
    const refs = relations
      .filter((relation) => relation.target_activity_id === targetId && uniquePredecessors.includes(relation.source_activity_id))
      .flatMap((relation) => relation.evidence_refs);
    mergeGroups.push({
      id: `merge:${candidateGroup.id}:${targetId}`,
      predecessor_activity_ids: uniquePredecessors,
      downstream_activity_id: targetId,
      parallel_group_id: candidateGroup.id,
      evidence_refs: refs,
    });
  }

  const downstreamByActivityId = new Map<string, string>();
  for (const relation of relations) {
    const target = activityById.get(relation.target_activity_id);
    if (!target) continue;
    const current = downstreamByActivityId.get(relation.source_activity_id);
    const next = target.title;
    downstreamByActivityId.set(
      relation.source_activity_id,
      current ? `${current}, ${next}` : next,
    );
  }

  const activitiesWithRecords = activities.map((activity, index) => {
    const storyCritical = index < 5 || activity.status === 'failed' || activity.status === 'waiting';
    const operatorFacingRecord = buildOperatorFacingRecord(
      activity,
      downstreamByActivityId.get(activity.id),
      activity.evidence_refs,
    );
    return {
      ...activity,
      operator_facing_record: operatorFacingRecord,
      story_critical: storyCritical,
      story_critical_limitation: storyCritical ? operatorFacingRecord.limitation : undefined,
    };
  });

  const runtimeRootCandidateCount = runtimeRootCandidateIds.size;
  const effectiveTerminalEvidence = runTerminalEvidence.filter(
    (entry) => entry.basis !== 'execution_root_span' || runtimeRootCandidateCount === 1,
  );
  const terminalStates = new Set(effectiveTerminalEvidence.map((entry) => entry.state));
  const terminalRefs = effectiveTerminalEvidence.map((entry) => entry.ref);
  const hasTerminalConflict = terminalStates.size > 1;
  const hasWaitingTerminalConflict = pendingInterrupts.size > 0 && terminalStates.size > 0;
  let runOutcome: RuntimeExplanationRunOutcome;
  if (hasTerminalConflict || hasWaitingTerminalConflict) {
    runOutcome = 'unknown';
    flags.push(createFlag(
      'run_evidence_conflict',
      'error',
      hasWaitingTerminalConflict
        ? 'Terminal run evidence conflicts with an unresolved waiting interaction at this frame.'
        : 'Recorded run-terminal evidence contains conflicting outcomes.',
      terminalRefs,
    ));
  } else if (terminalStates.has('failed')) {
    runOutcome = 'failed';
  } else if (terminalStates.has('completed')) {
    runOutcome = 'completed';
  } else if (pendingInterrupts.size > 0) {
    runOutcome = 'waiting';
  } else if (explicitRunStartedAt || (runStartAt && runtimeRootCandidateCount === 1)) {
    runOutcome = 'active';
  } else {
    runOutcome = 'unknown';
    flags.push(createFlag(
      'run_evidence_insufficient',
      'warning',
      runtimeRootCandidateCount > 1
        ? `Run outcome is unknown because ${runtimeRootCandidateCount} execution-root candidates were recorded.`
        : 'Run outcome is unknown because no explicit lifecycle or unique execution-root evidence was recorded.',
      [],
    ));
  }
  const runDurationMs = (() => {
    const exact = exactDurationMs(runStartNano, runFailedNano ?? runCompletedNano);
    if (exact !== undefined) return exact;
    const start = parseTimestamp(runStartAt);
    const end = parseTimestamp(runFailedAt ?? runCompletedAt);
    return start !== undefined && end !== undefined && end >= start ? end - start : undefined;
  })();

  return {
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    as_of_sequence_num: asOfSequenceNum,
    as_of_timestamp: asOfTimestamp,
    projection_version: 'runtime_explanation.v1',
    run_outcome: runOutcome,
    frame: {
      mission_id: input.mission_id,
      branch_id: input.branch_id,
      sequence_num: asOfSequenceNum,
      as_of_timestamp: asOfTimestamp ?? filtered[filtered.length - 1]?.timestamp ?? new Date(0).toISOString(),
      projection_version: 'runtime_explanation.v1',
    },
    run_status: deriveRunStatus(runOutcome),
    runtime_phase: deriveRuntimePhase(runOutcome, asOfSequenceNum, filtered.flatMap((event) => [evidenceRef(event)]).slice(0, 4)),
    progress_markers: activitiesWithRecords.map((activity) => ({
      sequence_num: activity.sequence_num ?? 0,
      timestamp: activity.started_at ?? activity.ended_at ?? asOfTimestamp ?? new Date(0).toISOString(),
      kind: activity.kind,
      actor: activity.actor,
      text: `${activity.title} | ${activity.action} | ${activity.outcome ?? runtimeOutcomeLabel(activity.status)}`,
    })),
    selected_activity_state: deriveSelectedActivityState(activitiesWithRecords),
    run_duration_ms: runDurationMs,
    activities: activitiesWithRecords,
    relations,
    parallel_groups: parallelGroups.sort((left, right) => left.id.localeCompare(right.id)),
    merge_groups: mergeGroups.sort((left, right) => left.id.localeCompare(right.id)),
    consistency_flags: dedupeFlags(flags).sort((left, right) => {
      if (left.code !== right.code) return left.code.localeCompare(right.code);
      if ((left.activity_id ?? '') !== (right.activity_id ?? '')) {
        return (left.activity_id ?? '').localeCompare(right.activity_id ?? '');
      }
      return left.message.localeCompare(right.message);
    }),
  };
}
