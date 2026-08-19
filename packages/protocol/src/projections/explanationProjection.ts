import type {
  EventEnvelope,
  RunStatus,
  RuntimeActivityField,
  RuntimeExplanationActivity,
  RuntimeExplanationActivityKind,
  RuntimeExplanationActivityOutcome,
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
  RuntimeFactBasis,
  RuntimeFactProvenance,
  RuntimeOperatorActivityRecord,
  RuntimePhaseLabel,
  RuntimePhaseSummary,
  RuntimeProgressMarker,
  RuntimeSelectedActivityState,
} from '../types.js';
import { RUNTIME_EXPLANATION_VERSION } from '../runtimeContract.js';
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
  target?: string;
  target_basis?: RuntimeFactBasis;
  target_condition?: RuntimeOperatorActivityRecord['target']['condition'];
  source_span_id?: string;
  parent_span_id?: string;
  sequence_num?: number;
  invocation_id?: string;
  started_at?: string;
  ended_at?: string;
  started_at_unix_nano?: string;
  ended_at_unix_nano?: string;
  terminal_status?: RuntimeExplanationRunOutcome;
  semantic_outcome?: 'success' | 'failure' | 'unknown';
  inputs?: Record<string, RuntimeExplanationValue>;
  outputs?: Record<string, RuntimeExplanationValue>;
  error?: Record<string, RuntimeExplanationValue>;
  artifacts?: RuntimeExplanationValue[];
  evidence_refs: RuntimeExplanationEvidenceRef[];
  kind_refs: RuntimeExplanationEvidenceRef[];
  actor_refs: RuntimeExplanationEvidenceRef[];
  target_refs: RuntimeExplanationEvidenceRef[];
  input_refs: RuntimeExplanationEvidenceRef[];
  output_refs: RuntimeExplanationEvidenceRef[];
  artifact_refs: RuntimeExplanationEvidenceRef[];
  start_refs: RuntimeExplanationEvidenceRef[];
  terminal_refs: RuntimeExplanationEvidenceRef[];
  actor_conflict?: boolean;
  target_conflict?: boolean;
  lifecycle_conflict?: boolean;
  outcome_observations: Array<{
    outcome: 'success' | 'failure' | 'unknown';
    phase: ActivityEventProjection['phase'];
    ref: RuntimeExplanationEvidenceRef;
  }>;
}

interface ActivityEventProjection {
  id: string;
  kind: RuntimeExplanationActivityKind;
  invocation_id?: string;
  title: string;
  subtitle?: string;
  target?: string;
  target_basis?: RuntimeFactBasis;
  target_condition?: RuntimeOperatorActivityRecord['target']['condition'];
  action: string;
  phase: 'start' | 'terminal' | 'instant';
  completed_status: RuntimeExplanationRunOutcome;
  semantic_outcome?: 'success' | 'failure' | 'unknown';
  inputs?: Record<string, RuntimeExplanationValue>;
  outputs?: Record<string, RuntimeExplanationValue>;
  error?: Record<string, RuntimeExplanationValue>;
  artifacts?: RuntimeExplanationValue[];
}

interface CanonicalActivityFact {
  id: string;
  kind: RuntimeExplanationActivityKind;
  invocation_id?: string;
  identity_basis: 'explicit_invocation' | 'span_fallback';
  lifecycle: 'started' | 'completed' | 'failed' | 'unknown';
  outcome: 'success' | 'failure' | 'unknown';
  observation: {
    lifecycle: 'started' | 'completed' | 'failed' | 'unknown';
    outcome: 'success' | 'failure' | 'unknown';
  };
}

const CANONICAL_ACTIVITY_KINDS = new Set<RuntimeExplanationActivityKind>([
  'agent',
  'workflow',
  'tool',
  'llm',
  'retrieval',
  'memory',
  'artifact',
  'human',
  'checkpoint',
]);
const CANONICAL_LIFECYCLES = new Set(['started', 'completed', 'failed', 'unknown']);
const CANONICAL_OUTCOMES = new Set(['success', 'failure', 'unknown']);
const INTERNAL_RUNTIME_ACTIVITY = Symbol.for('agentlens.internal.runtime-activity');

function canonicalActivityAnnotation(event: EventEnvelope): Record<string, unknown> | undefined {
  const metadata = event.metadata as Record<PropertyKey, unknown> | undefined;
  const raw = metadata?.[INTERNAL_RUNTIME_ACTIVITY];
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined;
}

function canonicalActivityFact(event: EventEnvelope): CanonicalActivityFact | undefined {
  const annotation = canonicalActivityAnnotation(event);
  const raw = annotation?.activity;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const observationRaw = annotation?.observation;
  const observation = observationRaw && typeof observationRaw === 'object' && !Array.isArray(observationRaw)
    ? observationRaw as Record<string, unknown>
    : record;
  if (
    typeof record.id !== 'string'
    || !CANONICAL_ACTIVITY_KINDS.has(record.kind as RuntimeExplanationActivityKind)
    || (record.identity_basis !== 'explicit_invocation' && record.identity_basis !== 'span_fallback')
    || !CANONICAL_LIFECYCLES.has(String(record.lifecycle))
    || !CANONICAL_OUTCOMES.has(String(record.outcome))
    || !CANONICAL_LIFECYCLES.has(String(observation.lifecycle))
    || !CANONICAL_OUTCOMES.has(String(observation.outcome))
  ) {
    return undefined;
  }
  return {
    id: record.id,
    kind: record.kind as RuntimeExplanationActivityKind,
    invocation_id: typeof record.invocation_id === 'string' ? record.invocation_id : undefined,
    identity_basis: record.identity_basis,
    lifecycle: record.lifecycle as CanonicalActivityFact['lifecycle'],
    outcome: record.outcome as CanonicalActivityFact['outcome'],
    observation: {
      lifecycle: observation.lifecycle as CanonicalActivityFact['lifecycle'],
      outcome: observation.outcome as CanonicalActivityFact['outcome'],
    },
  };
}

function hasCanonicalActivityAuthority(event: EventEnvelope): boolean {
  return canonicalActivityAnnotation(event)?.authority === 'normalized';
}

function hasCanonicalActivityAmbiguity(event: EventEnvelope): boolean {
  return typeof canonicalActivityAnnotation(event)?.ambiguity === 'string';
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
    trace_id: event.trace_id,
    span_id: event.span_id,
    source_event_id: event.source_event_id,
  };
}

function dedupeRefs(refs: RuntimeExplanationEvidenceRef[]): RuntimeExplanationEvidenceRef[] {
  const unique = new Map<string, RuntimeExplanationEvidenceRef>();
  for (const ref of refs) {
    unique.set(`${ref.branch_id ?? ''}:${ref.sequence_num}:${ref.event_id}`, ref);
  }
  return [...unique.values()];
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
  if (value === null) return 'absent';
  if (typeof value === 'string' && value.length === 0) return 'recorded_empty';
  if (Array.isArray(value) && value.length === 0) return 'recorded_empty';
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'redaction') {
    return 'redacted';
  }
  if (value && typeof value === 'object' && Object.keys(value).length === 0) return 'recorded_empty';
  return 'recorded';
}

function sourceValueBasis(value: RuntimeExplanationValue | undefined): RuntimeFactBasis {
  if (value === undefined) return 'unknown';
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'redaction') {
    return 'derived';
  }
  return 'recorded';
}

function field<T = RuntimeExplanationValue>(
  value: T | undefined,
  refs: RuntimeExplanationEvidenceRef[],
  basis: RuntimeFactBasis,
  fallbackCondition?: RuntimeOperatorActivityRecord['actor']['condition'],
): RuntimeActivityField<T> {
  return {
    value,
    condition: fallbackCondition ?? valueCondition(value as RuntimeExplanationValue | undefined),
    basis,
    evidence_refs: dedupeRefs(refs),
  };
}

function factProvenance(
  refs: RuntimeExplanationEvidenceRef[],
  basis: RuntimeFactBasis,
  condition: RuntimeFactProvenance['condition'],
): RuntimeFactProvenance {
  return { basis, condition, evidence_refs: dedupeRefs(refs) };
}

function runtimeOutcomeLabel(status: RuntimeExplanationRunOutcome): RuntimeExplanationActivityOutcome {
  return status === 'failed' ? 'Failure' : 'Unknown';
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

function displayNameFact(
  kind: RuntimeExplanationActivityKind,
  payload: Record<string, unknown>,
): { value?: string; basis: RuntimeFactBasis } {
  const keys = (() => {
    switch (kind) {
      case 'agent':
        return ['gen_ai.agent.name', 'agentlens.agent.name', 'gen_ai.agent.id', 'agentlens.agent.id', 'name'];
      case 'workflow':
        return ['gen_ai.workflow.step_id', 'task', 'gen_ai.agent.task.description'];
      case 'tool':
        return ['gen_ai.tool.name', 'tool_name'];
      case 'llm':
        return ['gen_ai.request.model'];
      case 'retrieval':
        return ['retrieval.backend', 'search.query'];
      case 'memory':
        return ['memory_key', 'gen_ai.agent.memory.key', 'key'];
      case 'artifact':
        return ['artifact_name', 'artifact_id', 'name'];
      case 'human':
        return ['reason', 'gen_ai.agent.interrupt.reason'];
      case 'checkpoint':
        return ['checkpoint_id', 'operation_name'];
    }
  })();
  for (const key of keys) {
    const raw = payload[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const value = raw.trim();
    return { value, basis: value === raw ? 'recorded' : 'derived' };
  }
  return { basis: 'unknown' };
}

function displayName(kind: RuntimeExplanationActivityKind, payload: Record<string, unknown>): string | undefined {
  return displayNameFact(kind, payload).value;
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
    let explicitlyAbsent = false;
    for (const key of keys) {
      const raw = payload[key];
      if (raw === undefined) continue;
      if (raw === null) {
        explicitlyAbsent = true;
        continue;
      }
      const value = redactableValue(event, raw);
      if (value !== undefined) return value;
    }
    return explicitlyAbsent ? redactableValue(event, null) : undefined;
  };

  return { input: pick(inputKeys), output: pick(outputKeys) };
}

function classifyCanonicalActivity(
  event: EventEnvelope,
  fact: CanonicalActivityFact,
): ActivityEventProjection {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const redacted = event.policy?.decision === 'redact';
  const title = redacted ? { title: kindLabel(fact.kind) } : buildTitle(fact.kind, payload);
  const target = redacted
    ? { value: undefined, basis: 'unknown' as const, condition: 'redacted' as const }
    : { ...displayNameFact(fact.kind, payload), condition: undefined };
  const { input: activityInput, output: activityOutput } = extractActivityIo(fact.kind, event, payload);
  const errorValue = redactableValue(event, event.error?.original_error ?? payload.error ?? payload.reason);
  const artifactValue = redactableValue(
    event,
    fact.kind === 'artifact'
      ? {
          artifact_name: stringValue(payload, 'artifact_name', 'name'),
          artifact_type: stringValue(payload, 'artifact_type', 'type'),
        }
      : undefined,
  );
  const base = {
    id: fact.id,
    kind: fact.kind,
    invocation_id: fact.invocation_id,
    title: !redacted && fact.invocation_id && !title.title.includes(fact.invocation_id)
      ? `${title.title} | ${fact.invocation_id}`
      : title.title,
    subtitle: title.subtitle,
    target: target.value,
    target_basis: target.basis,
    target_condition: target.condition,
    action: actionLabel(fact.kind),
    semantic_outcome: fact.observation.outcome,
  } satisfies Omit<ActivityEventProjection, 'phase' | 'completed_status'>;

  if (event.event_type === 'interrupt.decision') {
    const decision = redactableValue(event, payload.decision ?? payload.comment ?? payload.decision_payload);
    return {
      ...base,
      phase: 'start',
      completed_status: 'waiting',
      outputs: decision === undefined ? undefined : { decision },
    };
  }

  if (fact.observation.lifecycle === 'failed' || fact.observation.outcome === 'failure') {
    return {
      ...base,
      phase: 'terminal',
      completed_status: 'failed',
      error: errorValue === undefined ? undefined : { error: errorValue },
    };
  }
  if (fact.observation.lifecycle === 'completed') {
    return {
      ...base,
      phase: 'terminal',
      completed_status: 'completed',
      outputs: activityOutput === undefined ? undefined : { output: activityOutput },
      artifacts: artifactValue === undefined ? undefined : [artifactValue],
    };
  }
  return {
    ...base,
    phase: 'start',
    completed_status: fact.kind === 'human' ? 'waiting' : 'active',
    inputs: activityInput === undefined ? undefined : { input: activityInput },
  };
}

function classifyEventActivity(event: EventEnvelope): ActivityEventProjection | null {
  const canonical = canonicalActivityFact(event);
  if (canonical) return classifyCanonicalActivity(event, canonical);
  // Production replay envelopes always carry canonical activity authority.
  // Raw classification remains only for older, unannotated protocol inputs.
  if (hasCanonicalActivityAuthority(event)) return null;
  const kind = classifyKind(event);
  if (!kind) return null;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const id = resolveActivityId(event, kind);
  if (!id) return null;
  const redacted = event.policy?.decision === 'redact';
  const title = redacted ? { title: kindLabel(kind) } : buildTitle(kind, payload);
  const target = redacted
    ? { value: undefined, basis: 'unknown' as const, condition: 'redacted' as const }
    : { ...displayNameFact(kind, payload), condition: undefined };
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
    invocation_id: invocationId,
    title:
      !redacted && invocationId && !title.title.includes(invocationId)
        ? `${title.title} | ${invocationId}`
        : title.title,
    subtitle: title.subtitle,
    target: target.value,
    target_basis: target.basis,
    target_condition: target.condition,
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
      return {
        ...base,
        phase: 'start',
        completed_status: 'waiting',
        outputs: redactableValue(event, payload.decision ?? payload.comment ?? payload.decision_payload) === undefined
          ? undefined
          : { decision: redactableValue(event, payload.decision ?? payload.comment ?? payload.decision_payload)! },
      };
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

function preferredActivityValue(
  record: Record<string, RuntimeExplanationValue> | undefined,
  primary: string,
  fallback: string,
): RuntimeExplanationValue | undefined {
  if (!record) return undefined;
  if (Object.prototype.hasOwnProperty.call(record, primary)) return record[primary];
  return record[fallback];
}

function mergeSemanticOutcome(
  current: ActivityAccumulator['semantic_outcome'],
  update: ActivityAccumulator['semantic_outcome'],
): ActivityAccumulator['semantic_outcome'] {
  if (current === 'failure' || update === 'failure') return 'failure';
  if (current === 'success' || update === 'success') return 'success';
  return current ?? update;
}

function semanticOutcomeLabel(
  outcome: NonNullable<ActivityAccumulator['semantic_outcome']>,
): RuntimeExplanationActivityOutcome {
  if (outcome === 'success') return 'Success';
  if (outcome === 'failure') return 'Failure';
  return 'Unknown';
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

/**
 * A frame admits revision evidence immutably, while its span representation is
 * the latest revision known at that exact admission cutoff. Keep superseded
 * revisions available in Replay evidence, but never interpret them as a second
 * simultaneous activity revision.
 */
function effectiveEvidenceRevisionEvents(events: EventEnvelope[]): EventEnvelope[] {
  const latestAdmissionByLogicalId = new Map<string, number>();
  for (const event of events) {
    const logicalId = event.metadata?.evidence_logical_id;
    if (typeof logicalId !== 'string') continue;
    const admission = typeof event.metadata?.evidence_admission_seq === 'number'
      ? event.metadata.evidence_admission_seq
      : event.sequence_num;
    const current = latestAdmissionByLogicalId.get(logicalId);
    if (current === undefined || admission > current) latestAdmissionByLogicalId.set(logicalId, admission);
  }
  return events.filter((event) => {
    const logicalId = event.metadata?.evidence_logical_id;
    if (typeof logicalId !== 'string') return true;
    const admission = typeof event.metadata?.evidence_admission_seq === 'number'
      ? event.metadata.evidence_admission_seq
      : event.sequence_num;
    return latestAdmissionByLogicalId.get(logicalId) === admission;
  });
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
  provenance: RuntimeFactProvenance,
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
          : runOutcome === 'active'
            ? 'Active Work'
            : 'Unknown';
  return {
    id: `${provenance.basis}:${label}:${sequenceNum}`,
    label,
    basis: provenance.basis,
    condition: provenance.condition,
    start_sequence_num: sequenceNum,
    end_sequence_num: sequenceNum,
    evidence_refs: provenance.evidence_refs,
  };
}

function buildOperatorFacingRecord(
  activity: RuntimeExplanationActivity,
  source: ActivityAccumulator,
  trigger: { value: string; refs: RuntimeExplanationEvidenceRef[] } | undefined,
  downstreamEffect: { value: string; refs: RuntimeExplanationEvidenceRef[] } | undefined,
): RuntimeOperatorActivityRecord {
  const actorField = field(
    activity.actor,
    source.actor_refs,
    source.actor_conflict ? 'unknown' : activity.actor === undefined ? 'unknown' : 'recorded',
    source.actor_conflict ? 'inconsistent' : undefined,
  );
  const actionField = field(activity.action, source.kind_refs, 'derived');
  const targetField = field(
    source.target,
    source.target_refs,
    source.target_conflict ? 'unknown' : source.target_basis ?? 'unknown',
    source.target_conflict ? 'inconsistent' : source.target_condition,
  );
  const outcomeProvenance = activity.semantic_provenance?.outcome
    ?? factProvenance([], 'unknown', 'not_recorded');
  const outcomeField = field(
    activity.outcome ?? runtimeOutcomeLabel(activity.status),
    outcomeProvenance.evidence_refs,
    outcomeProvenance.basis,
    outcomeProvenance.condition,
  );
  const triggerField = field(
    trigger?.value,
    trigger?.refs ?? [],
    trigger === undefined ? 'unknown' : 'derived',
  );
  const inputValue = preferredActivityValue(activity.inputs, 'input', 'reason');
  const outputValue = preferredActivityValue(activity.outputs, 'output', 'decision');
  const missingParts = [
    actorField.condition !== 'recorded' ? 'actor' : null,
    targetField.condition !== 'recorded' ? 'target' : null,
    outcomeField.condition !== 'recorded' ? 'outcome' : null,
  ].filter(Boolean) as string[];
  const conflicting = [actorField, targetField, outcomeField]
    .some((candidate) => candidate.condition === 'inconsistent');
  const conflictingRefs = [actorField, targetField, outcomeField]
    .filter((candidate) => candidate.condition === 'inconsistent')
    .flatMap((candidate) => candidate.evidence_refs ?? []);
  const limitation =
    missingParts.length > 0
      ? `Incomplete operator context: ${missingParts.join(', ')} not fully available`
      : undefined;

  return {
    primary_label: activity.title,
    actor: actorField,
    action: actionField,
    target: targetField,
    status_or_outcome: outcomeField,
    trigger: triggerField,
    input: field(inputValue, inputValue === undefined ? [] : source.input_refs, sourceValueBasis(inputValue)),
    output: field(outputValue, outputValue === undefined ? [] : source.output_refs, sourceValueBasis(outputValue)),
    downstream_effect: field(
      downstreamEffect?.value,
      downstreamEffect?.refs ?? [],
      downstreamEffect ? 'derived' : 'unknown',
    ),
    artifacts: field(
      activity.artifacts,
      activity.artifacts === undefined ? [] : source.artifact_refs,
      activity.artifacts === undefined ? 'unknown' : 'derived',
    ),
    evidence_condition: field(
      missingParts.length > 0 ? limitation ?? 'incomplete' : 'recorded',
      conflictingRefs,
      'derived',
      conflicting ? 'inconsistent' : missingParts.length > 0 ? 'not_recorded' : 'recorded',
    ),
    story_critical_sufficient: missingParts.length === 0,
    limitation,
  };
}

export function projectRuntimeExplanation(
  input: ProjectRuntimeExplanationInput,
): RuntimeExplanationProjection {
  const filtered = effectiveEvidenceRevisionEvents(
    eventsThroughCursor(input.events, input.as_of_sequence_num),
  );

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
  const pendingInterrupts = new Map<string, RuntimeExplanationEvidenceRef>();
  let runStartAt: string | undefined;
  let runCompletedAt: string | undefined;
  let runFailedAt: string | undefined;
  let runStartRef: RuntimeExplanationEvidenceRef | undefined;
  let runCompletedRef: RuntimeExplanationEvidenceRef | undefined;
  let runFailedRef: RuntimeExplanationEvidenceRef | undefined;
  let runStartNano: string | undefined;
  let runCompletedNano: string | undefined;
  let runFailedNano: string | undefined;
  const runtimeRootCandidateIds = new Set<string>();
  let explicitRunStartedAt: string | undefined;
  const runStartEvidence: Array<{
    basis: string;
    ref: RuntimeExplanationEvidenceRef;
    root_id?: string;
  }> = [];
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
      runStartRef = evidenceRef(event);
    }
    if (lifecycle === 'started') {
      runStartEvidence.push({
        basis: lifecycleBasis,
        ref: evidenceRef(event),
        root_id: metadata.runtime_root_candidate === true ? event.span_id : undefined,
      });
    }
    if (lifecycle === 'started' && lifecycleBasis !== 'execution_root_span' && !explicitRunStartedAt) {
      explicitRunStartedAt = event.timestamp;
    }
    if (lifecycle === 'completed' || lifecycle === 'failed') {
      const ref = evidenceRef(event);
      runTerminalEvidence.push({ state: lifecycle, basis: lifecycleBasis, ref });
      if (lifecycle === 'completed') {
        if (!runCompletedAt) {
          runCompletedAt = event.timestamp;
          runCompletedNano = eventTimestampNanos(event);
          runCompletedRef = ref;
        }
      }
      if (lifecycle === 'failed') {
        if (!runFailedAt) {
          runFailedAt = event.timestamp;
          runFailedNano = eventTimestampNanos(event);
          runFailedRef = ref;
        }
      }
    }
    const interruptId = stringValue(payload, 'interrupt_id', 'gen_ai.agent.interrupt.id');
    if (event.event_type === 'interrupt.requested' && interruptId) {
      pendingInterrupts.set(interruptId, evidenceRef(event));
    }
    if (event.event_type === 'interrupt.resumed' && interruptId) {
      pendingInterrupts.delete(interruptId);
    }
    if (metadata.governance_runtime_terminal === true && interruptId) {
      pendingInterrupts.delete(interruptId);
    }

    if (hasCanonicalActivityAmbiguity(event)) {
      flags.push(
        createFlag(
          'shared_span_multiple_invocations',
          'warning',
          `Span ${event.span_id ?? 'unknown'} contains activity evidence without a safe invocation identity.`,
          [evidenceRef(event)],
        ),
      );
    }

    const projection = classifyEventActivity(event);
    if (!projection) continue;

    const ref = evidenceRef(event);
    const actor = event.agent_id ?? event.actor_id;
    const existing = activityMap.get(projection.id);
    if (!existing) {
      activityMap.set(projection.id, {
        id: projection.id,
        kind: projection.kind,
        title: projection.title,
        subtitle: projection.subtitle,
        action: projection.action,
        actor,
        target: projection.target,
        target_basis: projection.target_basis,
        target_condition: projection.target_condition,
        source_span_id: event.span_id,
        parent_span_id: event.parent_span_id ?? event.causal?.parent_span_id,
        sequence_num: event.sequence_num,
        invocation_id: projection.invocation_id,
        semantic_outcome: projection.semantic_outcome,
        evidence_refs: [ref],
        kind_refs: [ref],
        actor_refs: actor === undefined ? [] : [ref],
        target_refs: projection.target === undefined && projection.target_condition === undefined ? [] : [ref],
        input_refs: projection.inputs === undefined ? [] : [ref],
        output_refs: projection.outputs === undefined ? [] : [ref],
        artifact_refs: projection.artifacts === undefined ? [] : [ref],
        start_refs: [],
        terminal_refs: [],
        outcome_observations: projection.semantic_outcome === undefined
          ? []
          : [{ outcome: projection.semantic_outcome, phase: projection.phase, ref }],
        inputs: projection.inputs,
        outputs: projection.outputs,
        error: projection.error,
        artifacts: projection.artifacts,
      });
    } else {
      existing.evidence_refs.push(ref);
      const priorInputValue = preferredActivityValue(existing.inputs, 'input', 'reason');
      const priorOutputValue = preferredActivityValue(existing.outputs, 'output', 'decision');
      existing.inputs = mergeObject(existing.inputs, projection.inputs);
      existing.outputs = mergeObject(existing.outputs, projection.outputs);
      existing.error = mergeObject(existing.error, projection.error);
      existing.semantic_outcome = mergeSemanticOutcome(existing.semantic_outcome, projection.semantic_outcome);
      if (existing.actor === undefined && actor !== undefined) {
        existing.actor = actor;
        existing.actor_refs = [ref];
      } else if (actor !== undefined && existing.actor !== actor) {
        existing.actor_conflict = true;
        existing.actor_refs.push(ref);
      }
      if (existing.target === undefined && projection.target !== undefined) {
        existing.target = projection.target;
        existing.target_basis = projection.target_basis;
        existing.target_condition = projection.target_condition;
        existing.target_refs = [ref];
      } else if (existing.target === undefined && projection.target_condition !== undefined) {
        existing.target_basis = projection.target_basis;
        existing.target_condition = projection.target_condition;
        existing.target_refs.push(ref);
      } else if (projection.target !== undefined && existing.target !== projection.target) {
        existing.target_conflict = true;
        existing.target_refs.push(ref);
      }
      if (
        (projection.inputs !== undefined && Object.prototype.hasOwnProperty.call(projection.inputs, 'input'))
        || (priorInputValue === undefined && projection.inputs !== undefined
          && Object.prototype.hasOwnProperty.call(projection.inputs, 'reason'))
      ) {
        existing.input_refs = [ref];
      }
      if (
        (projection.outputs !== undefined && Object.prototype.hasOwnProperty.call(projection.outputs, 'output'))
        || (priorOutputValue === undefined && projection.outputs !== undefined
          && Object.prototype.hasOwnProperty.call(projection.outputs, 'decision'))
      ) {
        existing.output_refs = [ref];
      }
      if (projection.semantic_outcome !== undefined) {
        existing.outcome_observations.push({
          outcome: projection.semantic_outcome,
          phase: projection.phase,
          ref,
        });
      }
      if (projection.artifacts?.length) {
        existing.artifacts = [...(existing.artifacts ?? []), ...projection.artifacts];
        existing.artifact_refs.push(ref);
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
      activity.start_refs.push(ref);
      if (!activity.started_at) {
        activity.started_at = event.timestamp;
        activity.started_at_unix_nano = eventTimestampNanos(event);
      }
      activity.sequence_num ??= event.sequence_num;
    } else if (projection.phase === 'instant') {
      activity.start_refs.push(ref);
      activity.terminal_refs.push(ref);
      activity.started_at ??= event.timestamp;
      activity.ended_at ??= event.timestamp;
      activity.started_at_unix_nano ??= eventTimestampNanos(event);
      activity.ended_at_unix_nano ??= eventTimestampNanos(event);
      activity.terminal_status = projection.completed_status;
    } else {
      activity.terminal_refs.push(ref);
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
        activity.ended_at = event.timestamp;
        activity.ended_at_unix_nano = eventTimestampNanos(event);
        activity.terminal_status = projection.completed_status;
      } else if (activity.ended_at) {
        if (activity.terminal_status !== projection.completed_status) {
          activity.lifecycle_conflict = true;
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
      const lifecycleRefs = dedupeRefs(
        activity.lifecycle_conflict
          ? activity.terminal_refs
          : activity.terminal_status
            ? activity.terminal_refs
            : activity.start_refs,
      );
      const lifecycleProvenance = activity.lifecycle_conflict
        ? factProvenance(lifecycleRefs, 'unknown', 'inconsistent')
        : lifecycleRefs.length > 0
          ? factProvenance(lifecycleRefs, 'derived', 'recorded')
          : factProvenance([], 'unknown', 'not_recorded');
      const observedOutcomes = new Set(
        activity.outcome_observations
          .map((observation) => observation.outcome)
          .filter((outcome) => outcome !== 'unknown'),
      );
      const outcomeConflict = observedOutcomes.has('success') && observedOutcomes.has('failure');
      const terminalOutcomeObservations = activity.outcome_observations
        .filter((observation) => observation.phase !== 'start');
      const relevantOutcomeObservations = terminalOutcomeObservations.length > 0
        ? terminalOutcomeObservations
        : activity.outcome_observations;
      const outcomeRefs = activity.semantic_outcome === undefined
        ? lifecycleRefs
        : dedupeRefs(relevantOutcomeObservations
          .filter((observation) =>
            outcomeConflict
            || observation.outcome === activity.semantic_outcome
            || (activity.semantic_outcome === 'unknown' && observation.outcome === 'unknown'))
          .map((observation) => observation.ref));
      const outcomeProvenance = outcomeConflict || (activity.semantic_outcome === undefined && activity.lifecycle_conflict)
        ? factProvenance(outcomeConflict ? outcomeRefs : lifecycleRefs, 'unknown', 'inconsistent')
        : outcomeRefs.length > 0
          ? factProvenance(outcomeRefs, 'derived', 'recorded')
          : factProvenance([], 'unknown', 'not_recorded');
      const durationMs = exactDurationMs(activity.started_at_unix_nano, activity.ended_at_unix_nano)
        ?? (startedAtMs !== undefined && endedAtMs !== undefined && endedAtMs >= startedAtMs
          ? endedAtMs - startedAtMs
          : undefined);
      const durationProvenance = durationMs === undefined
        ? factProvenance([], 'unknown', 'not_recorded')
        : activity.lifecycle_conflict
          ? factProvenance([...activity.start_refs, ...activity.terminal_refs], 'unknown', 'inconsistent')
          : factProvenance([...activity.start_refs, ...activity.terminal_refs], 'derived', 'recorded');
      return {
        id: activity.id,
        kind: activity.kind,
        title: activity.title,
        subtitle: activity.subtitle,
        action: activity.action,
        status,
        outcome: activity.semantic_outcome
          ? semanticOutcomeLabel(activity.semantic_outcome)
          : runtimeOutcomeLabel(status),
        started_at: activity.started_at,
        ended_at: activity.ended_at,
        duration_ms: durationMs,
        actor: activity.actor,
        source_span_id: activity.source_span_id,
        parent_span_id: activity.parent_span_id,
        sequence_num: activity.sequence_num,
        invocation_id: activity.invocation_id,
        inputs: activity.inputs,
        outputs: activity.outputs,
        error: activity.error,
        artifacts: activity.artifacts,
        semantic_provenance: {
          identity: factProvenance(activity.kind_refs.slice(0, 1), 'derived', 'recorded'),
          kind: factProvenance(activity.kind_refs.slice(0, 1), 'derived', 'recorded'),
          lifecycle: lifecycleProvenance,
          outcome: outcomeProvenance,
          duration: durationProvenance,
        },
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
  const uniqueActivityBySpan = new Map<string, string>();
  for (const [spanId, activityIds] of spanToActivityIds) {
    if (activityIds.size === 1) uniqueActivityBySpan.set(spanId, [...activityIds][0]);
  }

  const relationMap = new Map<string, RuntimeExplanationRelation>();
  for (const event of filtered) {
    const currentActivityId = eventToActivityId.get(event.id);
    if (!currentActivityId) continue;
    const refs = [evidenceRef(event)];
    const parentSpanId = event.causal?.parent_span_id;
    const parentSpanCandidates = parentSpanId ? spanToActivityIds.get(parentSpanId) : undefined;
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
        source_activity_id: parentSpanId ? uniqueActivityBySpan.get(parentSpanId) : undefined,
        target_activity_id: currentActivityId,
        danglingCode: parentSpanId ? 'dangling_parent_span' : undefined,
        danglingMessage: parentSpanId
          ? parentSpanCandidates && parentSpanCandidates.size > 1
            ? `Parent span ${parentSpanId} maps to multiple canonical activities and cannot be resolved unambiguously at this frame.`
            : `Parent span ${parentSpanId} could not be resolved at this frame.`
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
          `Recorded relationship ${relation.id} conflicts with source timestamps.`,
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
    const overlappingActivityIds = new Set<string>();
    for (let index = 0; index < uniqueChildren.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < uniqueChildren.length; nextIndex += 1) {
        const left = activityById.get(uniqueChildren[index]);
        const right = activityById.get(uniqueChildren[nextIndex]);
        if (!left || !right) continue;
        if (timestampsOverlap(left, right, asOfTimestamp)) {
          overlappingActivityIds.add(left.id);
          overlappingActivityIds.add(right.id);
        }
      }
    }
    if (overlappingActivityIds.size > 1) {
      const refs = [...overlappingActivityIds]
        .sort()
        .flatMap((id) => activityById.get(id)?.evidence_refs ?? []);
      flags.push(
        createFlag(
          'ambiguous_parallelism',
          'info',
          `Sibling activity intervals under ${parentId} overlap in recorded time; overlap does not establish parallel execution.`,
          refs,
        ),
      );
    }
  }

  const mergeGroups: RuntimeExplanationMergeGroup[] = [];
  const triggerByActivityId = new Map<string, {
    value: string;
    refs: RuntimeExplanationEvidenceRef[];
  }>();
  const downstreamByActivityId = new Map<string, {
    value: string;
    refs: RuntimeExplanationEvidenceRef[];
  }>();
  for (const relation of relations) {
    if (relation.basis !== 'trigger_reference') continue;
    const source = activityById.get(relation.source_activity_id);
    const target = activityById.get(relation.target_activity_id);
    if (!source || !target) continue;
    const currentTrigger = triggerByActivityId.get(relation.target_activity_id);
    triggerByActivityId.set(relation.target_activity_id, {
      value: currentTrigger ? `${currentTrigger.value}, ${source.title}` : source.title,
      refs: dedupeRefs([...(currentTrigger?.refs ?? []), ...relation.evidence_refs]),
    });
    const current = downstreamByActivityId.get(relation.source_activity_id);
    downstreamByActivityId.set(relation.source_activity_id, {
      value: current ? `${current.value}, ${target.title}` : target.title,
      refs: dedupeRefs([...(current?.refs ?? []), ...relation.evidence_refs]),
    });
  }

  const activitiesWithRecords = activities.map((activity) => {
    const operatorFacingRecord = buildOperatorFacingRecord(
      activity,
      activityMap.get(activity.id)!,
      triggerByActivityId.get(activity.id),
      downstreamByActivityId.get(activity.id),
    );
    return {
      ...activity,
      operator_facing_record: operatorFacingRecord,
    };
  });

  const runtimeRootCandidateCount = runtimeRootCandidateIds.size;
  const effectiveTerminalEvidence = runTerminalEvidence.filter(
    (entry) => entry.basis !== 'execution_root_span' || runtimeRootCandidateCount === 1,
  );
  const terminalStates = new Set(effectiveTerminalEvidence.map((entry) => entry.state));
  const terminalRefs = dedupeRefs(effectiveTerminalEvidence.map((entry) => entry.ref));
  const pendingInterruptRefs = dedupeRefs([...pendingInterrupts.values()]);
  const explicitRunStartRefs = dedupeRefs(runStartEvidence
    .filter((entry) => entry.basis !== 'execution_root_span')
    .map((entry) => entry.ref));
  const uniqueRootStartRefs = runtimeRootCandidateCount === 1
    ? dedupeRefs(runStartEvidence
      .filter((entry) => entry.basis === 'execution_root_span')
      .map((entry) => entry.ref))
    : [];
  const ambiguousRootRefs = runtimeRootCandidateCount > 1
    ? dedupeRefs(runStartEvidence
      .filter((entry) => entry.basis === 'execution_root_span')
      .map((entry) => entry.ref))
    : [];
  const hasTerminalConflict = terminalStates.size > 1;
  let runOutcome: RuntimeExplanationRunOutcome;
  let runOutcomeProvenance: RuntimeFactProvenance;
  if (hasTerminalConflict) {
    runOutcome = 'unknown';
    const conflictRefs = terminalRefs;
    runOutcomeProvenance = factProvenance(conflictRefs, 'unknown', 'inconsistent');
    flags.push(createFlag(
      'run_evidence_conflict',
      'error',
      'Recorded run-terminal evidence contains conflicting outcomes.',
      conflictRefs,
    ));
  } else if (terminalStates.has('failed')) {
    runOutcome = 'failed';
    runOutcomeProvenance = factProvenance(
      effectiveTerminalEvidence.filter((entry) => entry.state === 'failed').map((entry) => entry.ref),
      'derived',
      'recorded',
    );
  } else if (terminalStates.has('completed')) {
    runOutcome = 'completed';
    runOutcomeProvenance = factProvenance(
      effectiveTerminalEvidence.filter((entry) => entry.state === 'completed').map((entry) => entry.ref),
      'derived',
      'recorded',
    );
  } else if (pendingInterrupts.size > 0) {
    runOutcome = 'waiting';
    runOutcomeProvenance = factProvenance(pendingInterruptRefs, 'derived', 'recorded');
  } else if (explicitRunStartedAt || (runStartAt && runtimeRootCandidateCount === 1)) {
    runOutcome = 'active';
    runOutcomeProvenance = factProvenance(
      explicitRunStartRefs.length > 0 ? explicitRunStartRefs : uniqueRootStartRefs,
      'derived',
      'recorded',
    );
  } else {
    runOutcome = 'unknown';
    runOutcomeProvenance = runtimeRootCandidateCount > 1
      ? factProvenance(ambiguousRootRefs, 'unknown', 'unavailable')
      : factProvenance([], 'unknown', 'not_recorded');
    flags.push(createFlag(
      'run_evidence_insufficient',
      'warning',
      runtimeRootCandidateCount > 1
        ? `Run outcome is unknown because ${runtimeRootCandidateCount} execution-root candidates were recorded.`
        : 'Run outcome is unknown because no explicit lifecycle or unique execution-root evidence was recorded.',
      runOutcomeProvenance.evidence_refs,
    ));
  }
  const runDurationMs = (() => {
    if (runOutcome !== 'completed' && runOutcome !== 'failed') return undefined;
    const exact = exactDurationMs(runStartNano, runFailedNano ?? runCompletedNano);
    if (exact !== undefined) return exact;
    const start = parseTimestamp(runStartAt);
    const end = parseTimestamp(runFailedAt ?? runCompletedAt);
    return start !== undefined && end !== undefined && end >= start ? end - start : undefined;
  })();
  const runDurationRefs = [runStartRef, runFailedRef ?? runCompletedRef]
    .filter((ref): ref is RuntimeExplanationEvidenceRef => Boolean(ref));
  const runDurationProvenance = runDurationMs !== undefined
    ? factProvenance(runDurationRefs, 'derived', 'recorded')
    : runOutcomeProvenance.condition === 'inconsistent'
      || runOutcomeProvenance.condition === 'unavailable'
      ? factProvenance(
        [runStartRef, ...runOutcomeProvenance.evidence_refs]
          .filter((ref): ref is RuntimeExplanationEvidenceRef => Boolean(ref)),
        'unknown',
        runOutcomeProvenance.condition,
      )
      : factProvenance(runDurationRefs, 'unknown', 'not_recorded');

  return {
    mission_id: input.mission_id,
    branch_id: input.branch_id,
    as_of_sequence_num: asOfSequenceNum,
    as_of_timestamp: asOfTimestamp ?? filtered[filtered.length - 1]?.timestamp ?? new Date(0).toISOString(),
    projection_version: RUNTIME_EXPLANATION_VERSION,
    run_outcome: runOutcome,
    run_outcome_provenance: runOutcomeProvenance,
    frame: {
      mission_id: input.mission_id,
      branch_id: input.branch_id,
      sequence_num: asOfSequenceNum,
      as_of_timestamp: asOfTimestamp ?? filtered[filtered.length - 1]?.timestamp ?? new Date(0).toISOString(),
      projection_version: RUNTIME_EXPLANATION_VERSION,
    },
    run_status: deriveRunStatus(runOutcome),
    run_status_provenance: runOutcomeProvenance,
    runtime_phase: deriveRuntimePhase(runOutcome, asOfSequenceNum, runOutcomeProvenance),
    progress_markers: activitiesWithRecords.map((activity) => ({
      sequence_num: activity.sequence_num ?? 0,
      timestamp: activity.started_at ?? activity.ended_at ?? asOfTimestamp ?? new Date(0).toISOString(),
      kind: activity.kind,
      actor: activity.actor,
      text: `${activity.title} | ${activity.action} | ${activity.outcome ?? runtimeOutcomeLabel(activity.status)}`,
    })),
    selected_activity_state: deriveSelectedActivityState(activitiesWithRecords),
    run_duration_ms: runDurationMs,
    run_duration_provenance: runDurationProvenance,
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
