import {
  activityKindFromCompat,
  handoffTarget,
  isCompatibilityHandoff,
} from './agentLensCompat.js';
import {
  hasLangGraphMarkers,
  isExplicitLangGraphHandoff,
  isLangGraphRetrieval,
  nativeRuntimeIdentity,
} from './langgraph.js';
import { hasMafMarkers, isMafEnrichmentEvent, isUnknownMafEvent, mafNativeRuntimeIdentity } from './maf.js';
import {
  genAiTokenUsage,
  lifecycleFromEventAttrs,
  lifecycleFromOtel,
  outcomeFromEventAttrs,
  outcomeFromOtel,
} from './otelGenAi.js';
import type {
  NativeRuntimeIdentity,
  NormalizationDiagnostics,
  NormalizedActivity,
  NormalizedActivityKind,
  NormalizedRelationship,
  NormalizedRuntimeFacts,
  SourceReference,
} from './types.js';

const NATIVE_IDENTITY_FIELDS: Array<keyof NativeRuntimeIdentity> = [
  'framework',
  'thread_id',
  'run_id',
  'parent_run_id',
  'interrupt_request_id',
  'resume_of_interrupt_id',
  'checkpoint_id',
  'checkpoint_ns',
  'activity_correlation_id',
  'native_execution_key',
  'workflow_id',
  'executor_id',
  'request_id',
  'request_type',
  'response_type',
];

/**
 * Merge native runtime identities field by field in first-recorded order.
 * Later omissions do not clear earlier values; equal values coalesce;
 * conflicting explicit values keep the first value and emit diagnostics.
 */
export function mergeNativeRuntimeIdentities(
  entries: Array<{ identity?: NativeRuntimeIdentity; source?: SourceReference }>,
): { identity?: NativeRuntimeIdentity; diagnostics: NormalizationDiagnostics[] } {
  const merged: NativeRuntimeIdentity = {};
  const fieldSources = new Map<keyof NativeRuntimeIdentity, SourceReference | undefined>();
  const diagnostics: NormalizationDiagnostics[] = [];

  for (const entry of entries) {
    const identity = entry.identity;
    if (!identity) continue;
    for (const field of NATIVE_IDENTITY_FIELDS) {
      const next = identity[field];
      if (next === undefined || next === null || next === '') continue;
      const current = merged[field];
      if (current === undefined) {
        merged[field] = next;
        fieldSources.set(field, entry.source);
        continue;
      }
      if (current === next) continue;
      diagnostics.push({
        code: 'conflicting_native_identity',
        message: `Conflicting native identity field ${field}: retained "${current}", ignored "${next}"`,
        source: fieldSources.get(field),
        conflicting_source: entry.source,
        field,
        ambiguous_native_identity: true,
      });
    }
  }

  return {
    identity: Object.values(merged).some((value) => value !== undefined) ? merged : undefined,
    diagnostics,
  };
}

interface Candidate {
  activity: NormalizedActivity;
  span: any;
  attrs: Record<string, any>;
  activityKey: string;
  agentIds: string[];
  isEvent: boolean;
  identityAmbiguous: boolean;
}

const kindRank: Record<NormalizedActivityKind, number> = {
  unknown: 0,
  agent: 6,
  workflow: 5,
  tool: 2,
  llm: 3,
  retrieval: 4,
  memory: 2,
  artifact: 2,
  human: 5,
  checkpoint: 2,
};

const NORMALIZED_ACTIVITY_EVENT_NAMES = new Set([
  'agent.tool.call',
  'tool.called',
  'tool.call',
  'tool.completed',
  'tool.result',
  'tool.failed',
  'tool.error',
  'gen_ai.call',
  'gen_ai.error',
  'agent.interrupt.requested',
  'agent.interrupt.resumed',
  'memory.written',
  'memory.read',
  'agent.memory.write',
  'artifact.created',
  'artifact.updated',
  'task.started',
  'task.completed',
  'task.failed',
  'workflow.started',
  'workflow.completed',
  'workflow.error',
]);

export function normalizeSpansToFacts(spans: any[]): NormalizedRuntimeFacts {
  const ordered = [...spans].sort(compareSpans);
  const diagnostics: NormalizationDiagnostics[] = [];
  for (const span of ordered) {
    for (const event of span.events ?? []) {
      if (typeof event?.name === 'string' && event.name.startsWith('langgraph.')) {
        diagnostics.push({
          code: 'unknown_telemetry',
          message: `Unsupported LangGraph event ${event.name} on ${span?.span_id ?? 'span'}`,
          source: sourceReference(span, Object.keys(event.attributes ?? {}), 'langgraph', event.name),
        });
      }
      if (isUnknownMafEvent(event?.name)) {
        diagnostics.push({
          code: 'unknown_telemetry',
          message: `Unsupported MAF event ${event.name} on ${span?.span_id ?? 'span'}`,
          source: sourceReference(span, Object.keys(event.attributes ?? {}), 'maf', event.name),
        });
      }
    }
  }
  const rawCandidates = ordered.flatMap((span) => [
    candidateForSpan(span, diagnostics),
    ...(span.events ?? [])
      .filter((event: any) => NORMALIZED_ACTIVITY_EVENT_NAMES.has(event.name) || isMafEnrichmentEvent(event.name))
      .map((event: any) => candidateForSpan(span, diagnostics, event)),
  ]);
  diagnoseNativeCorrelationConflicts(rawCandidates, diagnostics);
  const candidates = reconcileFallbackIdentities(rawCandidates, diagnostics);
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.activityKey) ?? [];
    group.push(candidate);
    groups.set(candidate.activityKey, group);
  }

  const canonicalBySpan = new Map<string, NormalizedActivity>();
  const activityIdsByAgent = new Map<string, string>();
  const activities = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, group]) => {
      const activity = mergeCandidates(key, group, diagnostics);
      for (const candidate of group) {
        if (candidate.activity.span_id) canonicalBySpan.set(candidate.activity.span_id, activity);
        for (const agentId of candidate.agentIds) activityIdsByAgent.set(agentId, activity.id);
      }
      return activity;
    });

  const relationships: NormalizedRelationship[] = [];
  const activitiesByRunId = new Map(
    activities
      .filter((activity) => activity.native_runtime_identity?.run_id)
      .map((activity) => [activity.native_runtime_identity!.run_id!, activity]),
  );
  for (const activity of activities) {
    const parentRunId = activity.native_runtime_identity?.parent_run_id;
    const parent = parentRunId ? activitiesByRunId.get(parentRunId) : undefined;
    if (parent && parent.id !== activity.id) {
      relationships.push({
        kind: 'parent_child',
        source_activity_id: activity.id,
        target_activity_id: parent.id,
        resolution: 'resolved',
        source: activity.source_references[0],
      });
    }
  }
  for (const candidate of candidates) {
    const source = canonicalBySpan.get(candidate.activity.span_id ?? '');
    if (!source) continue;
    const parent = candidate.span.parent_span_id && canonicalBySpan.get(String(candidate.span.parent_span_id));
    if (parent && parent.id !== source.id) {
      relationships.push({
        kind: 'parent_child',
        source_activity_id: source.id,
        target_activity_id: parent.id,
        resolution: 'resolved',
        source: sourceReference(candidate.span, [], 'otel-genai'),
      });
    }

    for (const event of candidate.span.events ?? []) {
      const eventAttrs = { ...candidate.attrs, ...(event.attributes ?? {}) };
      if (!isCompatibilityHandoff(event.name)) continue;
      const langGraph = hasLangGraphMarkers(eventAttrs);
      if (langGraph && !isExplicitLangGraphHandoff(eventAttrs)) continue;
      const targetReference = handoffTarget(eventAttrs);
      const targetActivityId =
        (targetReference && canonicalBySpan.get(targetReference)?.id) ||
        (targetReference && activityIdsByAgent.get(targetReference));
      const sourceRef = sourceReference(candidate.span, Object.keys(event.attributes ?? {}), langGraph ? 'langgraph' : 'agentlens-compat', event.name);
      if (!targetActivityId) {
        diagnostics.push({
          code: 'unresolved_relationship',
          message: `Unable to resolve handoff target ${targetReference ?? 'unknown'}`,
          source: sourceRef,
        });
      }
      if (targetActivityId === source.id) continue;
      relationships.push({
        kind: 'handoff',
        source_activity_id: source.id,
        target_activity_id: targetActivityId,
        target_reference: targetReference,
        resolution: targetActivityId ? 'resolved' : 'unresolved',
        source: sourceRef,
      });
    }
  }

  return {
    activities,
    relationships: uniqueRelationships(relationships),
    diagnostics: diagnostics.sort((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`)),
  };
}

function candidateForSpan(span: any, diagnostics: NormalizationDiagnostics[], event?: any): Candidate {
  const eventAttrs = event?.attributes && typeof event.attributes === 'object' ? event.attributes : {};
  const attrs = {
    ...(span?.attributes && typeof span.attributes === 'object' ? span.attributes : {}),
    ...eventAttrs,
  };
  const operationName = event?.name ?? span?.operation_name ?? span?.name;
  const eventIndex = event && Array.isArray(span?.events) ? span.events.indexOf(event) : undefined;
  // Event activities must not inherit parent-span OK/success; only explicit event evidence counts.
  let lifecycle = event
    ? lifecycleFromEventAttrs(event.name, attrs)
    : lifecycleFromOtel(span);
  let outcome = event
    ? outcomeFromEventAttrs(event.name, attrs)
    : outcomeFromOtel(span);
  if (event?.name === 'agentlens.maf.response_accepted') {
    lifecycle = 'completed';
    outcome = 'unknown';
  }
  const priorEventIdentityAttrs = event
    ? [...(span.events ?? [])]
      .slice(0, Math.max(0, eventIndex ?? 0))
      .reverse()
      .find((candidate: any) => candidate.name === event.name && hasLangGraphMarkers(candidate.attributes ?? {}))
      ?.attributes
    : undefined;
  // Per-candidate identity follows attribute merge (event attrs overlay span attrs).
  // Field-wise first-wins across candidates happens only in mergeCandidates.
  const langGraphIdentity = nativeRuntimeIdentity(
    event && !hasLangGraphMarkers(eventAttrs) && priorEventIdentityAttrs
      ? { ...attrs, ...priorEventIdentityAttrs }
      : attrs,
  );
  const identity = langGraphIdentity ?? mafNativeRuntimeIdentity(attrs);
  const source = sourceReference(
    span,
    Object.keys(attrs),
    identity?.framework === 'langgraph' || hasLangGraphMarkers(attrs)
      ? 'langgraph'
      : identity?.framework === 'ms_agent_framework' || hasMafMarkers(attrs)
        ? 'maf'
        : 'agentlens-compat',
    event?.name,
    eventIndex,
  );
  const kind: NormalizedActivityKind =
    isLangGraphRetrieval(attrs) ? 'retrieval'
      : event?.name === 'agent.tool.call' || event?.name?.startsWith('tool.') ? 'tool'
      : event?.name === 'gen_ai.call' || event?.name === 'gen_ai.error' ? 'llm'
        : event?.name === 'agent.interrupt.requested' || event?.name === 'agent.interrupt.resumed' ? 'human'
          : event?.name === 'memory.written' || event?.name === 'memory.read' || event?.name === 'agent.memory.write' ? 'memory'
            : event?.name?.startsWith('artifact.') ? 'artifact'
              : event?.name?.startsWith('task.') || event?.name?.startsWith('workflow.') ? 'workflow'
          : activityKindFromCompat(attrs, operationName);
  if (kind === 'unknown' && Object.keys(attrs).some((key) => key.startsWith('agentlens.langgraph.'))) {
    diagnostics.push({ code: 'unknown_telemetry', message: `Unsupported LangGraph telemetry on ${span?.span_id ?? 'span'}`, source });
  }
  if (kind === 'unknown' && hasMafMarkers(attrs)) {
    diagnostics.push({ code: 'unknown_telemetry', message: `Unsupported MAF telemetry on ${span?.span_id ?? 'span'}`, source });
  }
  const invocation = resolveInvocationIdentity(kind, attrs, identity);
  if (invocation.ambiguous) {
    diagnostics.push({
      code: 'ambiguous_activity_identity',
      message: `Conflicting explicit invocation identifiers for ${kind} activity on ${span?.span_id ?? 'span'}`,
      source,
      related_sources: [source],
      ambiguous_activity_identity: true,
    });
  }
  const spanFallback = String(span?.span_id ?? `${operationName ?? 'unknown'}:${span?.start_time_unix_nano ?? ''}`);
  const activityKey = invocation.id
    ? `${kind}:${invocation.id}`
    : `${kind}:span:${spanFallback}`;
  return {
    activity: {
      id: activityKey,
      kind,
      invocation_id: invocation.id,
      identity_basis: invocation.id ? 'explicit_invocation' : 'span_fallback',
      lifecycle,
      outcome,
      span_id: span?.span_id,
      trace_id: span?.trace_id,
      operation_name: operationName,
      correlation: {
        parent_span_id: span?.parent_span_id ?? undefined,
        activity_correlation_id: identity?.activity_correlation_id,
        run_id: identity?.run_id,
      },
      native_runtime_identity: identity,
      token_usage: genAiTokenUsage(attrs),
      source_references: [source],
      observations: [{ source, lifecycle, outcome }],
    },
    span,
    attrs,
    activityKey,
    agentIds: [attrs['gen_ai.agent.id'], attrs['agentlens.agent.id']].filter((value): value is string => value !== undefined && value !== null).map(String),
    isEvent: Boolean(event),
    identityAmbiguous: invocation.ambiguous,
  };
}

const INVALID_INVOCATION_IDS = new Set(['unknown', 'unset', 'none', 'null', 'n/a']);

function recordedIdentityValues(attrs: Record<string, any>, keys: string[]): string[] {
  return [...new Set(keys
    .map((key) => attrs[key])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0 && !INVALID_INVOCATION_IDS.has(value.toLowerCase())))];
}

function resolveInvocationIdentity(
  kind: NormalizedActivityKind,
  attrs: Record<string, any>,
  identity: NativeRuntimeIdentity | undefined,
): { id?: string; ambiguous: boolean } {
  const genericKeys: Partial<Record<NormalizedActivityKind, string[]>> = {
    tool: ['tool_call_id', 'gen_ai.tool.call_id', 'gen_ai.tool.call.id', 'causal.tool_call_id', 'basestation.aiops.tool.call_id'],
    llm: ['gen_ai.request.id', 'llm.request_id', 'request_id'],
    retrieval: ['retrieval.request_id', 'retrieval_request_id', 'search.request_id', 'request_id', 'tool_call_id'],
    human: ['interrupt_id', 'gen_ai.agent.interrupt.id'],
    agent: ['gen_ai.agent.invocation_id', 'agent.invocation_id', 'invocation_id'],
    workflow: ['gen_ai.workflow.step_id', 'workflow_step_id'],
    artifact: ['artifact_id', 'artifact_name', 'name'],
    checkpoint: ['checkpoint_id'],
  };
  const generic = recordedIdentityValues(attrs, genericKeys[kind] ?? []);
  if (generic.length > 0) return { id: generic[0], ambiguous: generic.length > 1 };

  if (kind === 'human') {
    const requestValues = [...new Set([identity?.interrupt_request_id, identity?.request_id]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !INVALID_INVOCATION_IDS.has(value.toLowerCase())))];
    if (requestValues.length > 0) {
      return { id: requestValues[0], ambiguous: requestValues.length > 1 };
    }
  }
  const translated = [identity?.activity_correlation_id];
  const adapterValues = [...new Set(translated
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !INVALID_INVOCATION_IDS.has(value.toLowerCase())))];
  return { id: adapterValues[0], ambiguous: adapterValues.length > 1 };
}

function reconcileFallbackIdentities(
  candidates: Candidate[],
  diagnostics: NormalizationDiagnostics[],
): Candidate[] {
  const bySpanAndKind = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.activity.span_id ?? ''}:${candidate.activity.kind}`;
    const group = bySpanAndKind.get(key) ?? [];
    group.push(candidate);
    bySpanAndKind.set(key, group);
  }

  const excluded = new Set<Candidate>(candidates.filter((candidate) => candidate.identityAmbiguous));
  for (const [spanKind, group] of bySpanAndKind) {
    const events = group.filter((candidate) => candidate.isEvent && !candidate.identityAmbiguous);
    const fallbackEvents = events.filter((candidate) => !candidate.activity.invocation_id);
    const explicitEventIds = new Set(events
      .map((candidate) => candidate.activity.invocation_id)
      .filter((value): value is string => Boolean(value)));
    const fallbackSpans = group.filter((candidate) => !candidate.isEvent && !candidate.activity.invocation_id);
    const unsafeFallback = !hasSafeLifecycleFallback(fallbackEvents)
      || (fallbackEvents.length > 0 && explicitEventIds.size > 0)
      || group.some((candidate) => candidate.identityAmbiguous);

    if (unsafeFallback) {
      for (const candidate of [...fallbackEvents, ...fallbackSpans]) excluded.add(candidate);
      const source = fallbackEvents[0]?.activity.source_references[0]
        ?? fallbackSpans[0]?.activity.source_references[0]
        ?? group[0]?.activity.source_references[0];
      diagnostics.push({
        code: 'ambiguous_activity_identity',
        message: `Unsafe span fallback for ${spanKind}; multiple invocations cannot be distinguished`,
        source,
        related_sources: [...fallbackEvents, ...fallbackSpans]
          .map((candidate) => candidate.activity.source_references[0]),
        ambiguous_activity_identity: true,
      });
      continue;
    }

    if (explicitEventIds.size === 1 && fallbackEvents.length === 0) {
      const invocationId = [...explicitEventIds][0];
      for (const candidate of fallbackSpans) {
        candidate.activity.invocation_id = invocationId;
        candidate.activity.identity_basis = 'explicit_invocation';
        candidate.activity.id = `${candidate.activity.kind}:${invocationId}`;
        candidate.activityKey = candidate.activity.id;
      }
    } else if (explicitEventIds.size > 1) {
      for (const candidate of fallbackSpans) excluded.add(candidate);
      if (fallbackSpans.length > 0) {
        diagnostics.push({
          code: 'ambiguous_activity_identity',
          message: `Span-level ${spanKind} evidence cannot be attributed across explicit invocations`,
          source: fallbackSpans[0].activity.source_references[0],
          related_sources: fallbackSpans.map((candidate) => candidate.activity.source_references[0]),
          ambiguous_activity_identity: true,
        });
      }
    }
  }
  return candidates.filter((candidate) => !excluded.has(candidate));
}

function hasSafeLifecycleFallback(events: Candidate[]): boolean {
  if (events.length <= 1) return true;
  if (events.length !== 2) return false;
  const started = events.filter((candidate) => candidate.activity.lifecycle === 'started').length;
  const terminal = events.filter((candidate) =>
    candidate.activity.lifecycle === 'completed' || candidate.activity.lifecycle === 'failed',
  ).length;
  return started === 1 && terminal === 1;
}

function diagnoseNativeCorrelationConflicts(
  candidates: Candidate[],
  diagnostics: NormalizationDiagnostics[],
): void {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const identity = candidate.activity.native_runtime_identity;
    const correlationKey = identity?.framework === 'langgraph' && identity.run_id
      ? `langgraph:run:${identity.run_id}`
      : identity?.framework === 'ms_agent_framework' && identity.request_id
        ? `maf:request:${identity.request_id}`
        : undefined;
    if (!correlationKey) continue;
    const group = groups.get(correlationKey) ?? [];
    group.push(candidate);
    groups.set(correlationKey, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const result = mergeNativeRuntimeIdentities(group.map((candidate) => ({
      identity: candidate.activity.native_runtime_identity,
      source: candidate.activity.source_references[0],
    })));
    diagnostics.push(...result.diagnostics);
  }
}

function mergeCandidates(id: string, group: Candidate[], diagnostics: NormalizationDiagnostics[]): NormalizedActivity {
  const sorted = [...group].sort((left, right) => compareSpans(left.span, right.span));
  const primary = sorted[0].activity;
  const hasFailure = sorted.some((candidate) => candidate.activity.outcome === 'failure');
  const hasSuccess = sorted.some((candidate) => candidate.activity.outcome === 'success');
  if (hasFailure && hasSuccess) {
    diagnostics.push({ code: 'conflicting_outcome', message: `Conflicting outcome evidence for ${id}`, source: primary.source_references[0] });
  }
  const bestKind = sorted.map((candidate) => candidate.activity.kind).sort((left, right) => kindRank[right] - kindRank[left])[0];
  const sourceReferences = sorted.flatMap((candidate) => candidate.activity.source_references)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const observations = sorted.flatMap((candidate) => candidate.activity.observations)
    .sort((left, right) => JSON.stringify(left.source).localeCompare(JSON.stringify(right.source)));
  const firstWithTokens = sorted.find((candidate) => candidate.activity.token_usage)?.activity.token_usage;
  const { identity: mergedIdentity, diagnostics: identityDiagnostics } = mergeNativeRuntimeIdentities(
    sorted.map((candidate) => ({
      identity: candidate.activity.native_runtime_identity,
      source: candidate.activity.source_references[0],
    })),
  );
  diagnostics.push(...identityDiagnostics);
  const hasStarted = sorted.some((candidate) => candidate.activity.lifecycle === 'started');
  const hasCompleted = sorted.some((candidate) => candidate.activity.lifecycle === 'completed');
  return {
    ...primary,
    id,
    kind: bestKind,
    // Explicit failure dominates; incomplete (started/active only) must not become completed.
    lifecycle: hasFailure
      ? 'failed'
      : hasSuccess
        ? 'completed'
        : hasCompleted
          ? 'completed'
          : hasStarted
            ? 'started'
            : primary.lifecycle,
    outcome: hasFailure ? 'failure' : hasSuccess ? 'success' : 'unknown',
    native_runtime_identity: mergedIdentity,
    token_usage: firstWithTokens,
    source_references: sourceReferences,
    observations,
  };
}

function sourceReference(
  span: any,
  attributeKeys: string[],
  translator: SourceReference['translator'],
  eventName?: string,
  eventIndex?: number,
): SourceReference {
  return {
    trace_id: span?.trace_id,
    span_id: span?.span_id,
    event_name: eventName,
    ...(eventIndex !== undefined && eventIndex >= 0 ? { event_index: eventIndex } : {}),
    attribute_keys: [...attributeKeys].sort(),
    translator,
  };
}

function compareSpans(left: any, right: any): number {
  const leftStart = BigInt(String(left?.start_time_unix_nano ?? 0));
  const rightStart = BigInt(String(right?.start_time_unix_nano ?? 0));
  return (
    (leftStart < rightStart ? -1 : leftStart > rightStart ? 1 : 0) ||
    String(left?.trace_id ?? '').localeCompare(String(right?.trace_id ?? '')) ||
    String(left?.span_id ?? '').localeCompare(String(right?.span_id ?? ''))
  );
}

function uniqueRelationships(relationships: NormalizedRelationship[]): NormalizedRelationship[] {
  const deduped = new Map<string, NormalizedRelationship>();
  for (const relationship of relationships) {
    const key = `${relationship.kind}:${relationship.source_activity_id}:${relationship.target_activity_id ?? relationship.target_reference ?? ''}:${relationship.source.event_name ?? ''}`;
    deduped.set(key, relationship);
  }
  return [...deduped.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
