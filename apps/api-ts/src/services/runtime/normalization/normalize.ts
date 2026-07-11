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
import { hasMafMarkers, isMafEnrichmentEvent, isMafRequestEvent, isUnknownMafEvent, mafNativeRuntimeIdentity } from './maf.js';
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
}

const kindRank: Record<NormalizedActivityKind, number> = {
  unknown: 0,
  agent: 6,
  tool: 2,
  llm: 3,
  retrieval: 4,
  interrupt: 5,
};

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
  const candidates = ordered.flatMap((span) => [
    candidateForSpan(span, diagnostics),
    ...(span.events ?? [])
      .filter((event: any) => ['agent.tool.call', 'gen_ai.call', 'gen_ai.error', 'agent.interrupt.requested', 'agent.interrupt.resumed'].includes(event.name) || isMafEnrichmentEvent(event.name))
      .map((event: any) => candidateForSpan(span, diagnostics, event)),
  ]);
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
  const lifecycle = event
    ? lifecycleFromEventAttrs(event.name, attrs)
    : lifecycleFromOtel(span);
  const outcome = event
    ? outcomeFromEventAttrs(event.name, attrs)
    : outcomeFromOtel(span);
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
      : event?.name === 'agent.tool.call' ? 'tool'
      : event?.name === 'gen_ai.call' || event?.name === 'gen_ai.error' ? 'llm'
        : event?.name === 'agent.interrupt.requested' || event?.name === 'agent.interrupt.resumed' || isMafRequestEvent(event?.name) ? 'interrupt'
          : activityKindFromCompat(attrs, operationName);
  if (kind === 'unknown' && Object.keys(attrs).some((key) => key.startsWith('agentlens.langgraph.'))) {
    diagnostics.push({ code: 'unknown_telemetry', message: `Unsupported LangGraph telemetry on ${span?.span_id ?? 'span'}`, source });
  }
  if (kind === 'unknown' && hasMafMarkers(attrs)) {
    diagnostics.push({ code: 'unknown_telemetry', message: `Unsupported MAF telemetry on ${span?.span_id ?? 'span'}`, source });
  }
  const activityKey =
    identity?.run_id
      ? `run:${identity.run_id}`
      : identity?.activity_correlation_id
        ? `correlation:${identity.activity_correlation_id}`
        : event
          ? `span:${span?.span_id ?? 'unknown'}:event:${event.name}:${eventIndex ?? 0}`
          : `span:${span?.span_id ?? `${operationName ?? 'unknown'}:${span?.start_time_unix_nano ?? ''}`}`;
  return {
    activity: {
      id: activityKey,
      kind,
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
    },
    span,
    attrs,
    activityKey,
    agentIds: [attrs['gen_ai.agent.id'], attrs['agentlens.agent.id']].filter((value): value is string => value !== undefined && value !== null).map(String),
  };
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
  const firstWithTokens = sorted.find((candidate) => candidate.activity.token_usage)?.activity.token_usage;
  const { identity: mergedIdentity, diagnostics: identityDiagnostics } = mergeNativeRuntimeIdentities(
    sorted.map((candidate) => ({
      identity: candidate.activity.native_runtime_identity,
      source: candidate.activity.source_references[0],
    })),
  );
  diagnostics.push(...identityDiagnostics);
  const hasStarted = sorted.some((candidate) => candidate.activity.lifecycle === 'started');
  return {
    ...primary,
    id,
    kind: bestKind,
    // Explicit failure dominates; incomplete (started/active only) must not become completed.
    lifecycle: hasFailure
      ? 'failed'
      : hasSuccess
        ? 'completed'
        : hasStarted
          ? 'started'
          : primary.lifecycle,
    outcome: hasFailure ? 'failure' : hasSuccess ? 'success' : 'unknown',
    native_runtime_identity: mergedIdentity,
    token_usage: firstWithTokens,
    source_references: sourceReferences,
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
  return (
    Number(left?.start_time_unix_nano ?? 0) - Number(right?.start_time_unix_nano ?? 0) ||
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
