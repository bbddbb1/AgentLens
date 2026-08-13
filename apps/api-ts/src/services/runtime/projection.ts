import { eventsThroughCursor, SPAN_PROJECTION_VERSION } from '@agentlens/protocol';
import type {
  GraphSnapshot,
  GraphNode,
  GraphEdge,
  EventEnvelope,
  MissionEventRecord,
  NodeType,
  ProjectionProfile,
  ReplayStateResponse,
  RuntimeAgentState,
} from '@agentlens/protocol';
import { projectRuntimeExplanation, scanEventsToScratch } from '@agentlens/protocol';
import { applyHierarchicalLayout } from '../graphLayout.js';
import { normalizeSpansToFacts } from './normalization/index.js';
import { originFrameworkFromAttrs } from './normalization/agentLensCompat.js';
import { assembleModelProvenance } from './normalization/otelGenAi.js';
import { publicRuntimeIdentity, publicSpanStartAttributes, publicTelemetryAttributes, publicTelemetryName } from './normalization/publicMetadata.js';
import { materializeGovernanceState, parseGovernanceStateHistory } from '../interrupts/governanceState.js';

export type MaturityTier = 'L1' | 'L2' | 'L3';

type RunLifecycleState = 'started' | 'completed' | 'failed';

const FNV_64_OFFSET = 0xcbf29ce484222325n;
const FNV_64_PRIME = 0x100000001b3n;

function stableHash64(value: string): bigint {
  let hash = FNV_64_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * FNV_64_PRIME);
  }
  return hash;
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function stableSpanEventId(spanId: string, event: any, occurrence: number, revision = 1): string {
  const identity = canonicalValue({
    name: event?.name ?? '',
    timestamp: event?.timestamp ?? event?.time_unix_nano ?? event?.time ?? '',
    attributes: event?.attributes ?? {},
  });
  const revisionSuffix = revision > 1 ? `@r${revision}` : '';
  return `${spanId}${revisionSuffix}-event-${stableHash64(identity).toString(16)}-${occurrence}`;
}

function nanoBigInt(value: unknown, fallback: unknown = 0): bigint {
  const selected = value ?? fallback;
  if (typeof selected === 'bigint') return selected;
  if (typeof selected === 'number') {
    if (!Number.isSafeInteger(selected) || selected < 0) {
      throw new Error(`Unsafe nanosecond number: ${selected}`);
    }
    return BigInt(selected);
  }
  if (typeof selected === 'string' && /^\d+$/.test(selected)) return BigInt(selected);
  const millis = Date.parse(String(selected));
  return BigInt(Number.isNaN(millis) ? 0 : millis) * 1_000_000n;
}

function compareNanos(left: unknown, right: unknown): number {
  const leftNano = nanoBigInt(left);
  const rightNano = nanoBigInt(right);
  return leftNano < rightNano ? -1 : leftNano > rightNano ? 1 : 0;
}

function nanoToIso(value: unknown): string {
  const millis = nanoBigInt(value) / 1_000_000n;
  return new Date(Number(millis)).toISOString();
}

function nanoDurationMs(start: unknown, end: unknown): number | undefined {
  const endNano = nanoBigInt(end);
  if (endNano === 0n) return undefined;
  return Number(endNano - nanoBigInt(start)) / 1e6;
}

function hasRecordedEnd(value: unknown): boolean {
  return nanoBigInt(value) > 0n;
}

function runtimeTimestampNanos(value: unknown, fallback: unknown): string {
  return nanoBigInt(value, fallback).toString();
}

function eventTimestampIso(event: any, fallback: string): string {
  const persisted = event?.timestamp ?? event?.time_unix_nano;
  if (persisted !== undefined && persisted !== null && persisted !== '') {
    if ((typeof persisted === 'string' && /^\d+$/.test(persisted)) || typeof persisted === 'bigint') {
      return nanoToIso(persisted);
    }
    if (typeof persisted === 'number' && Number.isSafeInteger(persisted)) return nanoToIso(persisted);
    const parsed = new Date(String(persisted));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const legacy = event?.time;
  if (legacy !== undefined && legacy !== null && legacy !== '') {
    const parsed = new Date(legacy);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function explicitRunLifecycle(eventName: unknown): RunLifecycleState | undefined {
  if (typeof eventName !== 'string') return undefined;
  const normalized = eventName.toLowerCase();
  if (/(?:^|\.)(?:workflow|run|mission)\.started$/.test(normalized)) return 'started';
  if (/(?:^|\.)(?:workflow|run|mission)\.(?:completed|output)$/.test(normalized)) return 'completed';
  if (/(?:^|\.)(?:workflow|run|mission)\.failed$/.test(normalized)) return 'failed';
  return undefined;
}

const EXECUTION_CONTAINER_OPERATIONS = new Set([
  'workflow.run',
  'workflow.session',
  'workflow_invoke',
  'workflow.invoke',
  'mission.execute',
  'run.execute',
]);

function isExecutionRootCandidate(span: any): boolean {
  const parent = span?.parent_span_id;
  if (parent !== undefined && parent !== null && String(parent).length > 0) return false;
  const operation = String(span?.operation_name ?? span?.name ?? '').toLowerCase();
  return EXECUTION_CONTAINER_OPERATIONS.has(operation);
}

function indexNormalizedActivities(facts: ReturnType<typeof normalizeSpansToFacts>) {
  const bySpanId = new Map<string, (typeof facts.activities)[number]>();
  const bySpanEventIndex = new Map<string, (typeof facts.activities)[number]>();
  const observationBySpanId = new Map<string, (typeof facts.activities)[number]['observations'][number]>();
  const observationBySpanEventIndex = new Map<string, (typeof facts.activities)[number]['observations'][number]>();
  const ambiguousSpanIds = new Set<string>();
  const ambiguousSpanEventIndexes = new Set<string>();
  for (const activity of facts.activities) {
    for (const source of activity.source_references) {
      if (!source.span_id) continue;
      if (source.event_name) {
        if (source.event_index !== undefined) {
          bySpanEventIndex.set(`${source.span_id}:${source.event_name}:${source.event_index}`, activity);
        }
      } else {
        bySpanId.set(source.span_id, activity);
      }
    }
    for (const observation of activity.observations) {
      const source = observation.source;
      if (!source.span_id) continue;
      if (source.event_name && source.event_index !== undefined) {
        observationBySpanEventIndex.set(`${source.span_id}:${source.event_name}:${source.event_index}`, observation);
      } else if (!source.event_name) {
        observationBySpanId.set(source.span_id, observation);
      }
    }
  }
  for (const diagnostic of facts.diagnostics) {
    if (!diagnostic.ambiguous_activity_identity) continue;
    for (const source of diagnostic.related_sources ?? (diagnostic.source ? [diagnostic.source] : [])) {
      if (!source.span_id) continue;
      if (source.event_name && source.event_index !== undefined) {
        ambiguousSpanEventIndexes.add(`${source.span_id}:${source.event_name}:${source.event_index}`);
      } else if (!source.event_name) {
        ambiguousSpanIds.add(source.span_id);
      }
    }
  }
  return {
    bySpanId,
    bySpanEventIndex,
    observationBySpanId,
    observationBySpanEventIndex,
    ambiguousSpanIds,
    ambiguousSpanEventIndexes,
  };
}

function lookupNormalizedEventActivity(
  index: ReturnType<typeof indexNormalizedActivities>,
  spanId: string,
  eventName: string,
  eventAttrs: Record<string, any>,
  eventIndex: number,
) {
  // Native identity keys are interpreted by the private normalizer. Generic
  // projection resolves the already-normalized source reference only.
  void eventAttrs;
  return index.bySpanEventIndex.get(`${spanId}:${eventName}:${eventIndex}`);
}

function lookupNormalizedEventObservation(
  index: ReturnType<typeof indexNormalizedActivities>,
  spanId: string,
  eventName: string,
  eventIndex: number,
) {
  return index.observationBySpanEventIndex.get(`${spanId}:${eventName}:${eventIndex}`);
}

const INTERNAL_RUNTIME_ACTIVITY = Symbol.for('agentlens.internal.runtime-activity');

type CanonicalActivitySummary = Pick<
  ReturnType<typeof normalizeSpansToFacts>['activities'][number],
  'id' | 'kind' | 'invocation_id' | 'identity_basis' | 'lifecycle' | 'outcome'
>;

function canonicalActivityMetadata(
  activity: CanonicalActivitySummary | undefined,
  observation?: { lifecycle: string; outcome: string },
  ambiguous = false,
): Record<PropertyKey, unknown> {
  const annotation: Record<string, unknown> = { authority: 'normalized' };
  if (ambiguous) annotation.ambiguity = 'missing_explicit_invocation_identity';
  if (activity && activity.kind !== 'unknown' && !ambiguous) {
    annotation.activity = {
      id: activity.id,
      kind: activity.kind,
      ...(activity.invocation_id ? { invocation_id: activity.invocation_id } : {}),
      identity_basis: activity.identity_basis,
      lifecycle: activity.lifecycle,
      outcome: activity.outcome,
    };
    annotation.observation = {
      lifecycle: observation?.lifecycle ?? activity.lifecycle,
      outcome: observation?.outcome ?? activity.outcome,
    };
  }
  return {
    [INTERNAL_RUNTIME_ACTIVITY]: annotation,
  };
}

function canonicalInterruptActivity(interruptId: string, lifecycle: 'started' | 'completed' | 'failed'): CanonicalActivitySummary {
  return {
    id: `human:${interruptId}`,
    kind: 'human',
    invocation_id: interruptId,
    identity_basis: 'explicit_invocation',
    lifecycle,
    outcome: lifecycle === 'failed' ? 'failure' : 'unknown',
  };
}

function parseAttrJson(val: any): any {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

function publicInterruptPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (
      lowered.includes('token')
      || lowered.includes('secret')
      || lowered.includes('control_ref')
      || lowered.includes('checkpoint')
      || lowered.includes('workflow_state')
      || lowered.includes('queue')
      || lowered === 'authorized_binding_id'
      || lowered === 'claiming_binding_id'
    ) continue;
    out[key] = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? publicInterruptPayload(entry)
      : entry;
  }
  return out;
}

function normalizeCausalContext(
  attrs: Record<string, any>,
  parentSpanId?: string,
): Record<string, unknown> | undefined {
  const parsed = parseAttrJson(attrs['agentlens.causal'] ?? attrs['causal']);
  const normalized = parsed && typeof parsed === 'object' ? { ...parsed } : {};

  const toolCallId =
    normalized['tool_call_id'] ??
    attrs['causal.tool_call_id'] ??
    attrs['tool_call_id'] ??
    attrs['gen_ai.tool.call_id'] ??
    attrs['basestation.aiops.tool.call_id'];
  const triggeredByEventId =
    normalized['triggered_by_event_id'] ??
    attrs['causal.triggered_by_event_id'] ??
    attrs['triggered_by_event_id'];
  const decisionForEventId =
    normalized['decision_for_event_id'] ??
    attrs['causal.decision_for_event_id'] ??
    attrs['decision_for_event_id'];

  if (parentSpanId && normalized['parent_span_id'] === undefined) {
    normalized['parent_span_id'] = parentSpanId;
  }
  if (toolCallId !== undefined) normalized['tool_call_id'] = String(toolCallId);
  if (triggeredByEventId !== undefined) normalized['triggered_by_event_id'] = String(triggeredByEventId);
  if (decisionForEventId !== undefined) normalized['decision_for_event_id'] = String(decisionForEventId);

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function resolveSpanStartEventType(
  tier: MaturityTier,
  attrs: Record<string, any>,
  operationName?: string,
): string {
  if (tier !== 'L3') return 'span.started';
  // Use task.started for all L3 spans; tool.called is emitted only from span events
  // with I/O so the timeline is not deduplicated against empty span-start envelopes.
  if (
    attrs['agent.span.kind'] === 'execute_tool' ||
    operationName === 'execute_tool' ||
    operationName === 'retrieval.search'
  ) {
    return 'task.started';
  }
  return 'task.started';
}

function buildRuntimeAgentsFromEvents(
  events: MissionEventRecord[],
  phase: string,
): Record<string, RuntimeAgentState> {
  const scratch = scanEventsToScratch(events, phase);
  const agents: Record<string, RuntimeAgentState> = {};

  for (const [agentId, agent] of scratch.agents) {
    agents[agentId] = {
      agent_id: agentId,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      current_task_id: agent.active_task,
      current_span_id: agent.source_span_id,
      confidence: agent.confidence,
      summary: agent.objective,
      last_reason: agent.pending,
      history: [],
      metadata: {},
    };
  }

  return agents;
}

/**
 * Assemble ErrorAttribution from verbatim runtime attributes. Prefers an
 * explicit structured form (`agentlens.error` / `error` / `error_attribution`
 * JSON); otherwise composes from individual `error.*` attributes the runtime
 * emitted, falling back to the OTel span status when only that is present.
 * `error.cause` is the AgentLens cause category; the verbatim message lives
 * in `error.original` → `original_error`. Only fields that actually exist
 * are set — never invented.
 */
function assembleErrorProvenance(attrs: Record<string, any>, span: any): any {
  const structured = parseAttrJson(attrs['agentlens.error'] ?? attrs['error'] ?? attrs['error_attribution']);
  if (structured && typeof structured === 'object') {
    return structured;
  }
  const out: Record<string, any> = {};
  const source = attrs['error.source'];
  const cause = attrs['error.cause'];
  const severity = attrs['error.severity'];
  const recovery = attrs['error.recovery.action'];
  const original = attrs['error.original'];
  if (source !== undefined) out.source = String(source);
  if (cause !== undefined) out.cause = String(cause);
  if (severity !== undefined) out.severity = String(severity);
  if (recovery !== undefined) out.recovery_action = String(recovery);
  if (original !== undefined) out.original_error = String(original);
  if (Object.keys(out).length > 0) return out;
  // Fall back to OTel span status when present (verbatim error state).
  if (span?.status_code === 'ERROR') {
    return { cause: 'unknown', original_error: span.status_message ? String(span.status_message) : 'error' };
  }
  return undefined;
}


function findAgentSpanId(agentId: string, spans: any[], currentSpanStartTime?: unknown): string | undefined {
  let bestSpan: any = undefined;
  let minDiff: bigint | undefined;

  for (const span of spans) {
    const attrs = span.attributes ?? {};
    const sAgentId = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
    if (sAgentId === agentId) {
      if (currentSpanStartTime !== undefined) {
        const diff = nanoBigInt(span.start_time_unix_nano) - nanoBigInt(currentSpanStartTime);
        if (diff >= 0n && (minDiff === undefined || diff < minDiff)) {
          minDiff = diff;
          bestSpan = span;
        }
      } else {
        return span.span_id;
      }
    }
  }

  if (!bestSpan) {
    const fallback = spans.find((span) => {
      const attrs = span.attributes ?? {};
      const sAgentId = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
      return sAgentId === agentId;
    });
    return fallback?.span_id;
  }

  return bestSpan.span_id;
}

function resolveNodeId(id: string, spans: any[], currentSpanStartTime?: unknown): string | undefined {
  if (spans.some((s) => s.span_id === id)) {
    return id;
  }
  const resolved = findAgentSpanId(id, spans, currentSpanStartTime);
  return resolved;
}

function nodeLabel(nodeType: NodeType, label: string, attrs: Record<string, any>, tier: MaturityTier): string {
  if (tier === 'L3' && nodeType === 'agent') {
    return `Agent · ${label}`;
  }
  if (tier === 'L2' && attrs['gen_ai.request.model'] !== undefined) {
    const provider = attrs['gen_ai.system'] !== undefined ? `${String(attrs['gen_ai.system'])} · ` : '';
    return `LLM · ${provider}${String(attrs['gen_ai.request.model'])}`;
  }
  return label;
}

/**
 * Classifies a span into L1, L2, or L3 based on its attributes.
 */
export function classifySpan(span: any): MaturityTier {
  const attrs = span.attributes ?? {};
  const keys = Object.keys(attrs);

  // L3: universal agent runtime attributes or AgentLens attributes.
  const hasL3 = keys.some(
    (k) =>
      k.startsWith('gen_ai.agent.') ||
      k.startsWith('agentlens.') ||
      k === 'agent.span.kind'
  );
  if (hasL3) return 'L3';

  // L2: Standard gen_ai.* attributes
  const hasL2 = keys.some((k) => k.startsWith('gen_ai.'));
  if (hasL2) return 'L2';

  // Default: L1 Auto Discovery
  return 'L1';
}

/**
 * Derive the presentation `ProjectionProfile` from verbatim span attributes +
 * `operation_name` + the already-classified `NodeType`.
 *
 * Architectural invariants (refinement pass):
 *   - Pure, rule-based, side-effect-free. Reads only verbatim attrs/op name.
 *   - Presentation metadata ONLY: never re-maps `NodeType`, never merges/hides
 *     nodes, never synthesizes hierarchy, never invents attributes.
 *   - `NodeType` stays the stable runtime union; the profile only chooses which
 *     first-class Evidence rows a profile-aware inspector renders.
 *
 * Priority is identity-first (agent) so an `invoke_agent` span is never
 * mis-profiled as an LLM call even if it happened to carry a `gen_ai.system`
 * attribute. `llm.call` spans inherit `gen_ai.agent.id` (→ L3, `NodeType=task`
 * or L2 `tool`) but never carry `agent.span.kind=invoke_agent`, so they fall
 * through to the LLM rule.
 */
export function deriveProjectionProfile(
  attrs: Record<string, any>,
  operationName: string | undefined,
  nodeType: NodeType,
): ProjectionProfile {
  // 1. Agent (invoke_agent) — strongest runtime identity.
  if (
    attrs['agent.span.kind'] === 'invoke_agent' ||
    operationName === 'invoke_agent' ||
    nodeType === 'agent'
  ) {
    return 'agent';
  }
  // 2. LLM call — gen_ai LLM signals live only on llm.call spans.
  if (
    operationName === 'llm.call' ||
    attrs['gen_ai.system'] !== undefined ||
    attrs['gen_ai.request.model'] !== undefined
  ) {
    return 'llm';
  }
  // 3. Retrieval — retrieval.search op or retrieval/search attributes.
  if (
    operationName === 'retrieval.search' ||
    attrs['retrieval.backend'] !== undefined ||
    attrs['search.query'] !== undefined ||
    attrs['search.result_count'] !== undefined
  ) {
    return 'retrieval';
  }
  // 4. Memory op.
  if (
    attrs['agent.span.kind'] === 'memory' ||
    nodeType === 'memory' ||
    (operationName !== undefined && operationName.startsWith('memory.'))
  ) {
    return 'memory';
  }
  // 5. Artifact op.
  if (
    attrs['agent.span.kind'] === 'artifact' ||
    nodeType === 'artifact' ||
    (operationName !== undefined && operationName.startsWith('artifact.'))
  ) {
    return 'artifact';
  }
  // 6. Tool (execute_tool with gen_ai.tool.name; non-retrieval, non-llm).
  if (
    attrs['agent.span.kind'] === 'execute_tool' ||
    operationName === 'execute_tool' ||
    attrs['gen_ai.tool.name'] !== undefined
  ) {
    return 'tool';
  }
  // 7. Checkpoint (specific op name; checked before workflow_step because
  //    checkpoint spans also carry gen_ai.workflow.id context).
  if (
    operationName === 'runtime.checkpoint.save' ||
    operationName === 'runtime.checkpoint.load'
  ) {
    return 'checkpoint';
  }
  // 8. Mission is an AgentLens product container. Only its explicit operation
  //    names select this profile; workload attributes are never profile signals.
  if (operationName === 'mission.execute' || operationName === 'mission.lifecycle') {
    return 'mission';
  }
  // 9. Workflow step / transition (specific op name, or workflow attrs fallback
  //    for task spans that carry workflow context but no specific op name).
  if (
    operationName === 'workflow.step' ||
    operationName === 'workflow.transition' ||
    attrs['gen_ai.workflow.id'] !== undefined ||
    attrs['gen_ai.workflow.step_id'] !== undefined
  ) {
    return 'workflow_step';
  }
  // 10. Human input.
  if (
    nodeType === 'human' ||
    attrs['agent.span.kind'] === 'human' ||
    attrs['agent.span.kind'] === 'agent.human.input'
  ) {
    return 'human';
  }
  return 'generic';
}

/**
 * Projects a set of spans into a single GraphSnapshot at a specific moment in time (maxTimeNs).
 * Stateless, pure function.
 */
export function projectTraceSnapshot(
  missionId: string,
  branchId: string,
  spans: any[],
  maxTimeNs?: string | number | bigint,
): GraphSnapshot {
  // 1. Filter visible spans based on maxTimeNs
  let visibleSpans = spans;
  if (maxTimeNs !== undefined) {
    const cutoff = nanoBigInt(maxTimeNs);
    visibleSpans = spans
      .filter((span) => nanoBigInt(span.start_time_unix_nano) <= cutoff)
      .map((span) => ({
        ...span,
        events: Array.isArray(span.events)
          ? span.events.filter((event: any) =>
              nanoBigInt(event?.timestamp ?? event?.time_unix_nano ?? event?.time, span.start_time_unix_nano) <= cutoff)
          : [],
      }));
  }

  // 2. Adjust active spans (started but not finished at maxTimeNs)
  if (maxTimeNs !== undefined) {
    const cutoff = nanoBigInt(maxTimeNs);
    visibleSpans = visibleSpans.map((s) => {
      const start = nanoBigInt(s.start_time_unix_nano);
      const end = nanoBigInt(s.end_time_unix_nano);
      if ((end > cutoff || end === 0n) && start <= cutoff) {
        return {
          ...s,
          end_time_unix_nano: '0', // In progress
          status_code: 'UNSET',
        };
      }
      return s;
    });
  }

  const normalizedFacts = normalizeSpansToFacts(visibleSpans);
  const { bySpanId: normalizedActivityBySpanId } = indexNormalizedActivities(normalizedFacts);
  const nodeIdByActivityId = new Map<string, string>();

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const addedNodes = new Set<string>();

  // 3. Process spans
  for (const span of visibleSpans) {
    const tier = classifySpan(span);
    const attrs = span.attributes ?? {};
    const operationName = publicTelemetryName(attrs, span.operation_name ?? span.name ?? 'span');

    // G7 & G8: Handoff & Review Edge projection from span.events (PR-3)
    if (Array.isArray(span.events)) {
      let eventIdx = 0;
      for (const event of span.events) {
        const eventAttrs = event.attributes ?? {};
        const eventName = event.name;

        if (
          eventName === 'agent.review' ||
          eventName === 'agent.review.approved' ||
          eventName === 'agent.review.changes_requested' ||
          eventName === 'agent.review.rejected'
        ) {
          const source = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
          const target = eventAttrs['gen_ai.agent.review.target'] ?? eventAttrs['target_agent_id'];
          // STRICT RULE: If target is missing, do NOT create the edge (no fallback)
          if (source && target) {
            const resolvedSource = span.span_id;
            const resolvedTarget = resolveNodeId(String(target), visibleSpans, span.start_time_unix_nano);
            if (!resolvedTarget) continue;
            edges.push({
              id: `edge-${span.span_id}-review-${eventIdx++}`,
              source: resolvedSource,
              target: resolvedTarget,
              type: 'review',
              status: 'completed',
              evidenceSpanId: span.span_id,
              evidence_span_id: span.span_id,
              source_span_id: span.span_id,
              source_event_id: eventName,
              metadata: publicTelemetryAttributes(eventAttrs),
            });
          }
        }
      }
    }

    // L3 edges are projected only from universal/AgentLens relationship attributes.
    if (tier === 'L3') {
      const source = attrs['agentlens.edge.source'] ?? attrs['gen_ai.agent.delegation.source'];
      const target = attrs['agentlens.edge.target'] ?? attrs['gen_ai.agent.delegation.target'] ?? attrs['gen_ai.agent.review.target'];
      const edgeType = attrs['agentlens.edge.type'] ?? attrs['gen_ai.agent.delegation.type'] ?? (attrs['agent.span.kind'] === 'agent.review' ? 'review' : 'dependency');

      // STRICT RULE: If it's a review span kind and review target is missing, we must NOT project the edge!
      const isReviewSpan = attrs['agent.span.kind'] === 'agent.review';
      const hasValidTarget = !isReviewSpan || !!attrs['gen_ai.agent.review.target'];

      if (source && target && hasValidTarget) {
        const resolvedSource = resolveNodeId(String(source), visibleSpans, span.start_time_unix_nano);
        const resolvedTarget = resolveNodeId(String(target), visibleSpans, span.start_time_unix_nano);
        if (!resolvedSource || !resolvedTarget) continue;
        edges.push({
          id: `edge-${span.span_id}`,
          source: resolvedSource,
          target: resolvedTarget,
          type: String(edgeType) as any,
          status: span.status_code === 'ERROR' ? 'failed' : span.status_code === 'OK' ? 'completed' : 'active',
          evidenceSpanId: span.span_id,
          evidence_span_id: span.span_id,
          source_span_id: span.span_id,
          metadata: publicTelemetryAttributes(attrs),
        });
        continue; // Edge spans are not nodes
      }
    }

    // Nodes
    const nodeId = span.span_id;
    let nodeType: NodeType = 'task';
    let label = operationName;
    const normalizedActivity = normalizedActivityBySpanId.get(span.span_id);
    const status: any =
      normalizedActivity?.lifecycle === 'failed' || normalizedActivity?.outcome === 'failure'
        ? 'failed'
        : normalizedActivity?.lifecycle === 'completed'
          ? 'completed'
          : normalizedActivity?.lifecycle === 'started'
            ? 'active'
            : span.status_code === 'ERROR' ? 'failed' : span.status_code === 'OK' ? 'completed' : 'active';
    let agentId: string | undefined;
    let agentRole: string | undefined;
    let agentTeam: string | undefined;
    let confidence: number | undefined;
    let summary: string | undefined;

    if (tier === 'L3') {
      const customType = attrs['agent.span.kind'] ?? attrs['agentlens.node.type'];
      if (customType === 'agent' || customType === 'agent.orchestration' || customType === 'invoke_agent') {
        nodeType = 'agent';
      } else if (customType === 'tool' || customType === 'execute_tool') {
        nodeType = 'tool';
      } else if (customType === 'human' || customType === 'agent.human.input') {
        nodeType = 'human';
      } else if (customType === 'memory' || customType === 'agent.memory.op') {
        nodeType = 'memory';
      } else if (customType === 'artifact') {
        nodeType = 'artifact';
      } else {
        nodeType = 'task';
      }

      agentId = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
      agentRole = attrs['gen_ai.agent.role'] ?? attrs['agentlens.agent.role'];
      agentTeam = attrs['gen_ai.agent.team'] ?? attrs['agentlens.agent.team'];
      const name = attrs['gen_ai.agent.name'] ?? attrs['agentlens.agent.name'];
      if (name) {
        label = String(name);
      }

      const conf = attrs['gen_ai.agent.confidence'] ?? attrs['agentlens.agent.confidence'];
      if (conf !== undefined) {
        confidence = Number(conf);
      }

      summary = attrs['gen_ai.agent.goal'] ?? attrs['gen_ai.agent.task.description'] ?? attrs['agentlens.agent.goal'];
    } else if (tier === 'L2') {
      nodeType = 'tool';
      label = attrs['gen_ai.system'] ? `${attrs['gen_ai.system']} (${attrs['gen_ai.request.model'] || 'LLM'})` : operationName;
      const tokensIn = attrs['gen_ai.usage.input_tokens'];
      const tokensOut = attrs['gen_ai.usage.output_tokens'];
      if (tokensIn !== undefined || tokensOut !== undefined) {
        summary = `Prompt tokens: ${tokensIn ?? 0}, Completion tokens: ${tokensOut ?? 0}`;
      }
    } else {
      nodeType = 'task';
      label = operationName;
    }

      if (!addedNodes.has(nodeId)) {
        addedNodes.add(nodeId);
        const projectionProfile = deriveProjectionProfile(attrs, operationName, nodeType);
      nodes.push({
        id: nodeId,
        type: nodeType,
        label: nodeLabel(nodeType, label, attrs, tier),
        status,
        position: { x: 0, y: 0 },
        agent_id: agentId,
        agent_role: agentRole,
        agent_team: agentTeam,
        agent_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
        framework: attrs['gen_ai.agent.framework'] ?? attrs['agentlens.origin_framework'] ?? attrs['origin_framework'],
        iteration: attrs['gen_ai.agent.iteration'] !== undefined ? Number(attrs['gen_ai.agent.iteration']) : undefined,
        confidence,
        summary: summary ? String(summary) : undefined,
        span_id: span.span_id,
        trace_id: span.trace_id,
        start_time: nanoToIso(span.start_time_unix_nano),
        end_time: hasRecordedEnd(span.end_time_unix_nano) ? nanoToIso(span.end_time_unix_nano) : undefined,
        duration_ms: nanoDurationMs(span.start_time_unix_nano, span.end_time_unix_nano),
        error_count: span.status_code === 'ERROR' ? 1 : 0,
        metadata: {
          ...publicTelemetryAttributes(attrs),
          ...publicRuntimeIdentity(normalizedActivity?.native_runtime_identity),
        },
        maturityTier: tier,
        maturity_tier: tier,
        evidenceSpanId: span.source_span_id ?? span.span_id,
        evidence_span_id: span.source_span_id ?? span.span_id,
        source_span_id: span.source_span_id ?? span.span_id,
        source_event_id: undefined,
        projection_profile: projectionProfile,
      });
      if (normalizedActivity) nodeIdByActivityId.set(normalizedActivity.id, nodeId);
    }
  }

  for (const relationship of normalizedFacts.relationships) {
    if (relationship.kind !== 'handoff' || relationship.resolution !== 'resolved' || !relationship.target_activity_id) continue;
    const source = nodeIdByActivityId.get(relationship.source_activity_id);
    const target = nodeIdByActivityId.get(relationship.target_activity_id);
    if (!source || !target) continue;
    edges.push({
      id: `edge-${relationship.source.span_id}-handoff-${relationship.source.event_name ?? 'event'}`,
      source,
      target,
      type: 'delegation',
      label: 'Handoff',
      status: 'completed',
      evidenceSpanId: relationship.source.span_id,
      evidence_span_id: relationship.source.span_id,
      source_span_id: relationship.source.span_id,
      source_event_id: relationship.source.event_name,
      metadata: { relationship_basis: 'explicit_handoff' },
    });
  }

  // 4. L1/L2 Hierarchy dependencies (parent_span_id fallback)
  for (const node of nodes) {
    const span = visibleSpans.find((s) => s.span_id === node.id);
    if (span && span.parent_span_id) {
      const parentNode = nodes.find((n) => n.id === span.parent_span_id);
      if (parentNode) {
        const tier = classifySpan(span);
        if (tier === 'L1' || tier === 'L2' || tier === 'L3') {
          edges.push({
            id: `dep-${span.parent_span_id}-${node.id}`,
            source: span.parent_span_id,
            target: node.id,
            type: 'dependency',
            label: 'Parent span',
            status: node.status === 'failed' ? 'failed' : node.status === 'completed' ? 'completed' : 'active',
            evidenceSpanId: span.span_id,
            evidence_span_id: span.span_id,
            metadata: { relationship_basis: 'parent_span' },
          });
        }
      }
    }
  }

  const snapshot: GraphSnapshot = {
    id: `snap-${maxTimeNs?.toString() ?? 'latest'}`,
    mission_id: missionId,
    sequence_num: 0,
    timestamp: maxTimeNs !== undefined ? nanoToIso(maxTimeNs) : '1970-01-01T00:00:00.000Z',
    nodes,
    edges,
    branch_id: branchId,
    phase: 'executing',
  };

  return applyHierarchicalLayout(snapshot);
}

/**
 * Ephemeral Time-Sliced Projection for Replay/Time-Travel.
 * Stateless, pure function.
 */
type AdmittedSpan = Record<string, any> & {
  branch_id: string;
  source_span_id: string;
  admission_seq: number;
  revision_num: number;
  admitted_at: string;
};

function logicalSpanId(span: Pick<AdmittedSpan, 'branch_id' | 'source_span_id'>): string {
  return `${span.branch_id}:${span.source_span_id}`;
}

function normalizeAdmittedSpans(spans: any[], defaultBranchId: string): AdmittedSpan[] {
  const revisionByLogicalId = new Map<string, number>();
  let maxAdmission = spans.reduce((maximum, span) => {
    const value = span?.admission_seq;
    return Number.isSafeInteger(value) && value > maximum ? value : maximum;
  }, 0);

  return spans.map((span) => {
    const branchId = String(span.branch_id ?? defaultBranchId);
    const sourceSpanId = String(span.source_span_id ?? span.span_id);
    const logicalId = `${branchId}:${sourceSpanId}`;
    const inferredRevision = (revisionByLogicalId.get(logicalId) ?? 0) + 1;
    const revisionNum = Number.isSafeInteger(span.revision_num) && span.revision_num > 0
      ? span.revision_num
      : inferredRevision;
    revisionByLogicalId.set(logicalId, Math.max(inferredRevision, revisionNum));
    const admissionSeq = Number.isSafeInteger(span.admission_seq) && span.admission_seq > 0
      ? span.admission_seq
      : ++maxAdmission;
    const admittedAt = span.admitted_at ?? span.created_at ?? new Date(admissionSeq).toISOString();
    return {
      ...span,
      branch_id: branchId,
      span_id: sourceSpanId,
      source_span_id: sourceSpanId,
      start_time_unix_nano: runtimeTimestampNanos(span.start_time_unix_nano, 0),
      end_time_unix_nano: runtimeTimestampNanos(span.end_time_unix_nano, 0),
      admission_seq: admissionSeq,
      revision_num: revisionNum,
      admitted_at: new Date(admittedAt).toISOString(),
    };
  }).sort((left, right) => left.admission_seq - right.admission_seq);
}

function materializeSpanRevisions(spans: readonly AdmittedSpan[], cutoff: number): AdmittedSpan[] {
  const latest = new Map<string, AdmittedSpan>();
  for (const span of spans) {
    if (span.admission_seq > cutoff) continue;
    const logicalId = logicalSpanId(span);
    const current = latest.get(logicalId);
    if (!current || span.admission_seq > current.admission_seq) latest.set(logicalId, span);
  }
  return [...latest.values()].sort((left, right) =>
    compareNanos(left.start_time_unix_nano, right.start_time_unix_nano)
    || left.admission_seq - right.admission_seq
    || logicalSpanId(left).localeCompare(logicalSpanId(right)),
  );
}

function scopeSpanIdsForBranchView(
  spans: readonly AdmittedSpan[],
  projectionBranchId: string,
): AdmittedSpan[] {
  const branchesBySourceId = new Map<string, Set<string>>();
  for (const span of spans) {
    const branches = branchesBySourceId.get(span.source_span_id) ?? new Set<string>();
    branches.add(span.branch_id);
    branchesBySourceId.set(span.source_span_id, branches);
  }
  const runtimeId = (branchId: string, sourceSpanId: string): string =>
    projectionBranchId !== 'main' || (branchesBySourceId.get(sourceSpanId)?.size ?? 0) > 1
      ? `${branchId}::${sourceSpanId}`
      : sourceSpanId;
  const candidatesBySourceId = new Map<string, AdmittedSpan[]>();
  for (const span of spans) {
    const candidates = candidatesBySourceId.get(span.source_span_id) ?? [];
    candidates.push(span);
    candidatesBySourceId.set(span.source_span_id, candidates);
  }

  return spans.map((span) => {
    const parentSourceId = span.parent_span_id ? String(span.parent_span_id) : undefined;
    let parentRuntimeId: string | undefined;
    if (parentSourceId) {
      const candidates = candidatesBySourceId.get(parentSourceId) ?? [];
      const sameBranch = candidates.find((candidate) => candidate.branch_id === span.branch_id);
      const ancestor = [...candidates]
        .filter((candidate) => candidate.admission_seq <= span.admission_seq)
        .sort((left, right) => right.admission_seq - left.admission_seq)[0];
      const parent = sameBranch ?? ancestor ?? candidates[0];
      parentRuntimeId = parent ? runtimeId(parent.branch_id, parentSourceId) : parentSourceId;
    }
    return {
      ...span,
      span_id: runtimeId(span.branch_id, span.source_span_id),
      parent_span_id: parentRuntimeId,
    };
  });
}

function spanRevisionEventId(span: AdmittedSpan, suffix = ''): string {
  const revisionSuffix = span.revision_num > 1 ? `@r${span.revision_num}` : '';
  return `${span.span_id}${revisionSuffix}${suffix}`;
}

export function projectRuntimeStateAtFrame(
  missionId: string,
  branchId: string,
  events: readonly MissionEventRecord[],
  snapshot: GraphSnapshot,
  interrupts: readonly Record<string, any>[] = [],
): NonNullable<ReplayStateResponse['current_state']> {
  const frameEvents = eventsThroughCursor(events, snapshot.sequence_num);
  const runtimeAgents = buildRuntimeAgentsFromEvents(frameEvents, 'Unknown');
  const interruptsRecord: Record<string, any> = {};

  for (const event of frameEvents) {
    if (!event.event_type.startsWith('interrupt.')) continue;
    const interruptId = String(event.payload?.interrupt_id ?? '');
    if (!interruptId) continue;
    const current = interruptsRecord[interruptId] ?? {
      interrupt_id: interruptId,
      status: 'pending',
      reason: String(event.payload?.reason ?? ''),
      agent_id: event.agent_id,
      span_id: (event as EventEnvelope).source_span_id,
      payload: {},
      updated_at: event.timestamp,
    };
    if (event.event_type === 'interrupt.decision') {
      current.status = event.payload?.decision === 'approve' ? 'approved' : event.payload?.decision === 'reject' ? 'rejected' : 'pending';
      current.decision = event.payload?.decision;
      current.decision_comment = event.payload?.comment;
    } else if (event.event_type === 'interrupt.resumed') {
      current.status = 'resumed';
      current.decision = 'resume';
    }
    current.updated_at = event.timestamp;
    interruptsRecord[interruptId] = current;
  }

  for (const interrupt of interrupts) {
    const requestedAdmission = Number(interrupt.requested_admission_seq ?? 0);
    if (!requestedAdmission || requestedAdmission > snapshot.sequence_num) continue;
    const interruptId = String(interrupt.interrupt_id ?? '');
    if (!interruptId) continue;
    const requestedEvidence = interrupt.requested_evidence && typeof interrupt.requested_evidence === 'object'
      ? interrupt.requested_evidence as Record<string, any>
      : {};
    const axes = materializeGovernanceState(interrupt.governance_state_history, snapshot.sequence_num);
    const current = interruptsRecord[interruptId] ?? {
      interrupt_id: interruptId,
      status: 'pending',
      reason: String(requestedEvidence.reason ?? interrupt.reason ?? ''),
      agent_id: requestedEvidence.agent_id ?? interrupt.agent_id ?? undefined,
      span_id: interrupt.span_id ?? undefined,
      payload: publicInterruptPayload(requestedEvidence.payload ?? {}),
      updated_at: interrupt.created_at,
    };
    current.request_lifecycle = axes.request_lifecycle;
    current.decision_state = axes.decision_state;
    current.delivery_state = axes.delivery_state;
    current.runtime_outcome = axes.runtime_outcome;
    current.governance_diagnostics = axes.governance_diagnostics;
    current.framework = interrupt.framework ?? undefined;
    const lastAdmission = Math.max(
      ...events.map((event) => event.sequence_num),
      ...interrupts.flatMap((candidate) => parseGovernanceStateHistory(candidate.governance_state_history)
        .map((transition) => transition.admission_seq)),
      0,
    );
    const liveFrame = snapshot.sequence_num === lastAdmission;
    // Inherited parent evidence is observational in a child lineage. Only the
    // current branch's exact latest control identity may be actionable.
    const liveControlFrame = liveFrame && String(interrupt.branch_id ?? branchId) === branchId;
    current.governance_available = liveControlFrame && interrupt.governance_available === true;
    current.control_mode = liveControlFrame
      ? interrupt.control_mode ?? 'unavailable'
      : 'unavailable';
    current.actionability = liveControlFrame
      ? interrupt.actionability ?? 'observed_only'
      : 'unavailable';
    current.supported_decision_types = liveControlFrame ? interrupt.supported_decision_types ?? [] : [];
    current.safe_prompt = liveControlFrame ? interrupt.safe_prompt ?? undefined : undefined;
    current.safe_input_schema = liveControlFrame ? interrupt.safe_input_schema ?? undefined : undefined;
    if (axes.decision_state === 'recorded') {
      current.decision = interrupt.decision ?? current.decision;
      current.decision_comment = interrupt.decision_comment ?? current.decision_comment;
    }
    interruptsRecord[interruptId] = current;
  }

  return {
    mission_id: missionId,
    branch_id: branchId,
    sequence_num: snapshot.sequence_num,
    agents: runtimeAgents,
    interrupts: interruptsRecord,
    status: 'unknown',
    phase: 'Unknown',
    nodes: snapshot.nodes,
    edges: snapshot.edges,
  };
}

export function projectReplayEvidence(
  missionId: string,
  branchId: string,
  spans: any[],
  interrupts: any[] = []
): ReplayStateResponse {
  const admittedSpans = normalizeAdmittedSpans(spans, branchId);
  const sortedSpans = scopeSpanIdsForBranchView(admittedSpans, branchId).sort((left, right) =>
    compareNanos(left.start_time_unix_nano, right.start_time_unix_nano)
    || left.admission_seq - right.admission_seq
    || String(left.span_id).localeCompare(String(right.span_id)),
  );
  const normalizedIndexByAdmission = new Map<number, ReturnType<typeof indexNormalizedActivities>>();
  for (const cursor of [...new Set(admittedSpans.map((span) => span.admission_seq))]) {
    const frameSpans = scopeSpanIdsForBranchView(materializeSpanRevisions(admittedSpans, cursor), branchId);
    normalizedIndexByAdmission.set(cursor, indexNormalizedActivities(normalizeSpansToFacts(frameSpans)));
  }
  const executionRootCandidates = sortedSpans.filter(isExecutionRootCandidate);
  const executionRootCandidateIds = new Set(executionRootCandidates.map((span) => String(span.span_id)));

  // Pre-build a map from span_id to trace_id (PR-4, G14)
  const spanTraceMap = new Map<string, string>();
  const runtimeSpanIdByLogicalId = new Map<string, string>();
  for (const s of sortedSpans) {
    if (s.span_id && s.trace_id) {
      spanTraceMap.set(s.span_id, s.trace_id);
      runtimeSpanIdByLogicalId.set(logicalSpanId(s), s.span_id);
    }
  }

  // Generate compatible events for the timeline
  const events: MissionEventRecord[] = [];

  // Add span-based events
  for (const span of sortedSpans) {
    const normalizedActivityIndex = normalizedIndexByAdmission.get(span.admission_seq)
      ?? indexNormalizedActivities(normalizeSpansToFacts([span]));
    const tier = classifySpan(span);
    const startIso = nanoToIso(span.start_time_unix_nano);
    const attrs = span.attributes ?? {};
    const operationName = publicTelemetryName(attrs, span.operation_name ?? span.name ?? 'span');
    const agentId = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
    const eventBranchId = span.branch_id ?? branchId;
    const normalizedActivity = normalizedActivityIndex.bySpanId.get(span.span_id);
    const spanIdentityAmbiguous = normalizedActivityIndex.ambiguousSpanIds.has(span.span_id);
    const nativeRuntimeMetadata = publicRuntimeIdentity(normalizedActivity?.native_runtime_identity);

    events.push({
      id: spanRevisionEventId(span),
      mission_id: missionId,
      branch_id: eventBranchId,
      sequence_num: span.admission_seq,
      branch_sequence_num: span.admission_seq,
      event_type: resolveSpanStartEventType(tier, attrs, operationName),
      timestamp: startIso,
      agent_id: agentId,
      span_id: span.span_id,
      trace_id: span.trace_id,
      parent_span_id: span.parent_span_id ?? undefined,
      payload: {
        ...publicSpanStartAttributes(attrs),
        operation_name: operationName,
      },
      metadata: {
        maturity_tier: tier,
        runtime_timestamp_unix_nano: String(span.start_time_unix_nano),
        evidence_admission_seq: span.admission_seq,
        evidence_admitted_at: span.admitted_at,
        evidence_revision: span.revision_num,
        evidence_logical_id: logicalSpanId(span),
        evidence_branch_id: span.branch_id,
        ...nativeRuntimeMetadata,
        ...canonicalActivityMetadata(
          normalizedActivity,
          hasRecordedEnd(span.end_time_unix_nano)
            ? { lifecycle: 'started', outcome: 'unknown' }
            : normalizedActivityIndex.observationBySpanId.get(span.span_id),
          spanIdentityAmbiguous,
        ),
        ...(executionRootCandidateIds.has(String(span.span_id)) ? {
          runtime_root_candidate: true,
          runtime_lifecycle: 'started',
          runtime_lifecycle_basis: 'execution_root_span',
        } : {}),
      },
      actor_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
      actor_id: attrs['agentlens.actor.id'] ?? attrs['actor_id'] ?? (agentId ?? undefined),
      origin_framework: originFrameworkFromAttrs(attrs),
      causal: normalizeCausalContext(attrs, span.parent_span_id ?? undefined),
      model: assembleModelProvenance(attrs),
      error: assembleErrorProvenance(attrs, span),
      policy: parseAttrJson(attrs['agentlens.policy'] ?? attrs['policy'] ?? attrs['policy_decision']) ?? undefined,
      source_span_id: span.source_span_id,
      source_event_id: undefined,
    } as any);

    // Unpack internal span.events (PR-4, G1-G6, G13)
    if (Array.isArray(span.events)) {
      let eventIdx = 0;
      const eventIdentityOccurrences = new Map<string, number>();
      for (const otelEvent of span.events) {
        const currentEventIndex = eventIdx;
        const eventTimeIso = eventTimestampIso(otelEvent, startIso);

        const eventAttrs = otelEvent.attributes ?? {};
        const normalizedType = publicTelemetryName(attrs, otelEvent.name, eventAttrs);
        const runLifecycle = explicitRunLifecycle(otelEvent.name);
        const mergedPayload = {
          ...publicTelemetryAttributes(eventAttrs),
          operation_name: operationName,
        };
        const mergedAttrs = { ...attrs, ...eventAttrs };
        const eventActivity = lookupNormalizedEventActivity(
          normalizedActivityIndex,
          span.span_id,
          otelEvent.name,
          eventAttrs,
          currentEventIndex,
        );
        const eventObservation = lookupNormalizedEventObservation(
          normalizedActivityIndex,
          span.span_id,
          otelEvent.name,
          currentEventIndex,
        );
        const eventIdentityAmbiguous = normalizedActivityIndex.ambiguousSpanEventIndexes
          .has(`${span.span_id}:${otelEvent.name}:${currentEventIndex}`);
        const eventNativeRuntimeMetadata = publicRuntimeIdentity(eventActivity?.native_runtime_identity);
        const eventIdentity = canonicalValue({
          name: otelEvent?.name ?? '',
          timestamp: otelEvent?.timestamp ?? otelEvent?.time_unix_nano ?? otelEvent?.time ?? '',
          attributes: otelEvent?.attributes ?? {},
        });
        const occurrence = eventIdentityOccurrences.get(eventIdentity) ?? 0;
        eventIdentityOccurrences.set(eventIdentity, occurrence + 1);
        events.push({
          id: stableSpanEventId(span.span_id, otelEvent, occurrence, span.revision_num),
          mission_id: missionId,
          branch_id: eventBranchId,
          sequence_num: span.admission_seq,
          branch_sequence_num: span.admission_seq,
          event_type: normalizedType,
          timestamp: eventTimeIso,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: mergedPayload,
          metadata: {
            maturity_tier: tier,
            runtime_timestamp_unix_nano: runtimeTimestampNanos(
              otelEvent?.timestamp ?? otelEvent?.time_unix_nano ?? otelEvent?.time,
              span.start_time_unix_nano,
            ),
            evidence_admission_seq: span.admission_seq,
            evidence_admitted_at: span.admitted_at,
            evidence_revision: span.revision_num,
            evidence_logical_id: logicalSpanId(span),
            evidence_branch_id: span.branch_id,
            ...eventNativeRuntimeMetadata,
            ...canonicalActivityMetadata(eventActivity, eventObservation, eventIdentityAmbiguous),
            ...(runLifecycle ? {
              runtime_lifecycle: runLifecycle,
              runtime_lifecycle_basis: 'explicit_event',
            } : {}),
          },
          actor_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
          actor_id: attrs['agentlens.actor.id'] ?? attrs['actor_id'] ?? (agentId ?? undefined),
          origin_framework: originFrameworkFromAttrs(mergedAttrs),
          causal: normalizeCausalContext(mergedAttrs, span.parent_span_id ?? undefined),
          model: assembleModelProvenance(mergedAttrs),
          error: assembleErrorProvenance(mergedAttrs, span),
          policy: parseAttrJson(mergedAttrs['agentlens.policy'] ?? mergedAttrs['policy'] ?? mergedAttrs['policy_decision']) ?? undefined,
          source_span_id: span.source_span_id,
          source_event_id: normalizedType,
        } as any);
        eventIdx += 1;
      }
    }

    if (hasRecordedEnd(span.end_time_unix_nano)) {
      const endIso = nanoToIso(span.end_time_unix_nano);
      events.push({
        id: spanRevisionEventId(span, '-end'),
        mission_id: missionId,
        branch_id: eventBranchId,
        sequence_num: span.admission_seq,
        branch_sequence_num: span.admission_seq,
        event_type: span.status_code === 'ERROR' ? 'span.failed' : 'span.completed',
        timestamp: endIso,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
        payload: {
          ...publicTelemetryAttributes(attrs),
          operation_name: operationName,
          status_code: span.status_code,
        },
        metadata: {
          maturity_tier: tier,
          runtime_timestamp_unix_nano: String(span.end_time_unix_nano),
          evidence_admission_seq: span.admission_seq,
          evidence_admitted_at: span.admitted_at,
          evidence_revision: span.revision_num,
          evidence_logical_id: logicalSpanId(span),
          evidence_branch_id: span.branch_id,
          ...nativeRuntimeMetadata,
          ...canonicalActivityMetadata(normalizedActivity, {
            lifecycle: normalizedActivity?.lifecycle ?? (span.status_code === 'ERROR' ? 'failed' : 'completed'),
            outcome: normalizedActivity?.outcome ?? (span.status_code === 'ERROR' ? 'failure' : 'unknown'),
          }, spanIdentityAmbiguous),
          ...(executionRootCandidateIds.has(String(span.span_id)) ? {
            runtime_root_candidate: true,
            runtime_lifecycle: span.status_code === 'ERROR' ? 'failed' : 'completed',
            runtime_lifecycle_basis: 'execution_root_span',
          } : {}),
        },
      actor_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
      actor_id: attrs['agentlens.actor.id'] ?? attrs['actor_id'] ?? (agentId ?? undefined),
      origin_framework: originFrameworkFromAttrs(attrs),
      causal: normalizeCausalContext(attrs, span.parent_span_id ?? undefined),
      model: assembleModelProvenance(attrs),
      error: assembleErrorProvenance(attrs, span),
      policy: parseAttrJson(attrs['agentlens.policy'] ?? attrs['policy'] ?? attrs['policy_decision']) ?? undefined,
        source_span_id: span.source_span_id,
        source_event_id: undefined,
      } as any);
    }
  }

  // Add interrupt-based events
  let nextAdmission = admittedSpans.reduce((maximum, span) => Math.max(maximum, span.admission_seq), 0);
  const interruptAdmission = (value: unknown): number =>
    Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : ++nextAdmission;
  for (const intr of interrupts) {
    const createdIso = new Date(intr.created_at).toISOString();
    const requestedEvidence = intr.requested_evidence && typeof intr.requested_evidence === 'object'
      ? intr.requested_evidence as Record<string, any>
      : {};
    const interruptBranchId = intr.branch_id ?? branchId;
    const runtimeSpanId = intr.span_id
      ? runtimeSpanIdByLogicalId.get(`${interruptBranchId}:${intr.span_id}`) ?? String(intr.span_id)
      : undefined;
    const traceId = runtimeSpanId ? spanTraceMap.get(runtimeSpanId) : undefined;
    const requestedAdmission = interruptAdmission(intr.requested_admission_seq ?? intr.admission_seq);

    events.push({
      id: `interrupt-${intr.interrupt_id}-requested`,
      mission_id: missionId,
      branch_id: interruptBranchId,
      sequence_num: requestedAdmission,
      branch_sequence_num: requestedAdmission,
      event_type: 'interrupt.requested',
      timestamp: createdIso,
      agent_id: intr.agent_id ?? undefined,
      span_id: runtimeSpanId,
      trace_id: traceId,
      payload: {
        agent_id: requestedEvidence.agent_id ?? intr.agent_id,
        interrupt_id: requestedEvidence.interrupt_id ?? intr.interrupt_id,
        reason: requestedEvidence.reason ?? intr.reason,
        resume_url: requestedEvidence.resume_url ?? intr.resume_url,
        ...publicInterruptPayload(requestedEvidence.payload ?? intr.payload ?? {}),
      },
      metadata: {
        runtime_timestamp_unix_nano: String(BigInt(new Date(intr.created_at).getTime()) * 1_000_000n),
        evidence_admission_seq: requestedAdmission,
        evidence_admitted_at: intr.requested_admitted_at ?? createdIso,
        ...canonicalActivityMetadata(canonicalInterruptActivity(String(intr.interrupt_id), 'started')),
      },
      causal: runtimeSpanId ? { parent_span_id: runtimeSpanId } : undefined,
      source_span_id: intr.span_id ?? undefined,
      source_event_id: 'interrupt.requested',
    } as any);

    if (intr.decided_at && intr.decision && intr.decision !== 'resume') {
      const decidedIso = new Date(intr.decided_at).toISOString();
      const decidedAdmission = interruptAdmission(intr.decided_admission_seq);
      events.push({
        id: `interrupt-${intr.interrupt_id}-decision`,
        mission_id: missionId,
        branch_id: interruptBranchId,
        sequence_num: decidedAdmission,
        branch_sequence_num: decidedAdmission,
        event_type: 'interrupt.decision',
        timestamp: decidedIso,
        agent_id: intr.agent_id ?? undefined,
        span_id: runtimeSpanId,
        trace_id: traceId,
        payload: {
          agent_id: intr.agent_id,
          interrupt_id: intr.interrupt_id,
          decision: intr.decision,
          comment: intr.decision_comment,
        },
        metadata: {
          runtime_timestamp_unix_nano: String(BigInt(new Date(intr.decided_at).getTime()) * 1_000_000n),
          evidence_admission_seq: decidedAdmission,
          evidence_admitted_at: intr.decided_admitted_at ?? decidedIso,
          // A recorded decision is Governance evidence, not Runtime continuation.
          // Keep the interaction activity waiting until explicit Runtime evidence.
          ...canonicalActivityMetadata(canonicalInterruptActivity(String(intr.interrupt_id), 'started')),
        },
        causal: {
          parent_span_id: runtimeSpanId,
          decision_for_event_id: `interrupt-${intr.interrupt_id}-requested`,
        },
        source_span_id: intr.span_id ?? undefined,
        source_event_id: 'interrupt.decision',
      } as any);
    }

    if (intr.status === 'resumed' && intr.resumed_at) {
      const resumedIso = new Date(intr.resumed_at).toISOString();
      const resumedAdmission = interruptAdmission(intr.resumed_admission_seq);
      events.push({
        id: `interrupt-${intr.interrupt_id}-resumed`,
        mission_id: missionId,
        branch_id: interruptBranchId,
        sequence_num: resumedAdmission,
        branch_sequence_num: resumedAdmission,
        event_type: 'interrupt.resumed',
        timestamp: resumedIso,
        agent_id: intr.agent_id ?? undefined,
        span_id: runtimeSpanId,
        trace_id: traceId,
        payload: {
          agent_id: intr.agent_id,
          interrupt_id: intr.interrupt_id,
          ...(intr.decision_payload ?? {}),
        },
        metadata: {
          runtime_timestamp_unix_nano: String(BigInt(new Date(intr.resumed_at).getTime()) * 1_000_000n),
          evidence_admission_seq: resumedAdmission,
          evidence_admitted_at: intr.resumed_admitted_at ?? resumedIso,
          ...canonicalActivityMetadata(canonicalInterruptActivity(String(intr.interrupt_id), 'completed')),
        },
        causal: {
          parent_span_id: runtimeSpanId,
          triggered_by_event_id: `interrupt-${intr.interrupt_id}-decision`,
        },
        source_span_id: intr.span_id ?? undefined,
        source_event_id: 'interrupt.resumed',
      } as any);
    }

    for (const transition of parseGovernanceStateHistory(intr.governance_state_history)) {
      if (transition.axis === 'delivery') {
        // Delivery is frame evidence, but it carries no Runtime lifecycle
        // meaning. Project an observation so every frame surface receives the
        // same admission timestamp without turning delivery into continuation.
        events.push({
          id: `interrupt-${intr.interrupt_id}-delivery-${transition.admission_seq}-${transition.state}`,
          mission_id: missionId,
          branch_id: interruptBranchId,
          sequence_num: transition.admission_seq,
          branch_sequence_num: transition.admission_seq,
          event_type: 'observation.recorded',
          timestamp: transition.recorded_at,
          agent_id: intr.agent_id ?? undefined,
          span_id: runtimeSpanId,
          trace_id: traceId,
          payload: {
            interrupt_id: intr.interrupt_id,
            delivery_state: transition.state,
          },
          metadata: {
            runtime_timestamp_unix_nano: String(BigInt(new Date(transition.recorded_at).getTime()) * 1_000_000n),
            evidence_admission_seq: transition.admission_seq,
            evidence_admitted_at: transition.recorded_at,
          },
          source_span_id: intr.span_id ?? undefined,
          source_event_id: 'observation.recorded',
        } as any);
        continue;
      }
      if (transition.axis !== 'runtime') continue;
      if (transition.state === 'awaiting_interaction' || transition.state === 'unknown') continue;
      const alreadyProjected = events.some((event) =>
        event.sequence_num === transition.admission_seq
        && event.event_type === 'interrupt.resumed'
        && String(event.payload?.interrupt_id ?? '') === String(intr.interrupt_id),
      );
      if (alreadyProjected) continue;
      const failed = transition.state === 'failed';
      const terminalEventType = transition.state === 'resumed' || transition.state === 'continued_with_input'
        ? 'interrupt.resumed'
        : 'observation.recorded';
      events.push({
        id: `interrupt-${intr.interrupt_id}-runtime-${transition.admission_seq}-${transition.state}`,
        mission_id: missionId,
        branch_id: interruptBranchId,
        sequence_num: transition.admission_seq,
        branch_sequence_num: transition.admission_seq,
        event_type: terminalEventType,
        timestamp: transition.recorded_at,
        agent_id: intr.agent_id ?? undefined,
        span_id: runtimeSpanId,
        trace_id: traceId,
        payload: {
          interrupt_id: intr.interrupt_id,
          runtime_outcome: transition.state,
        },
        metadata: {
          runtime_timestamp_unix_nano: String(BigInt(new Date(transition.recorded_at).getTime()) * 1_000_000n),
          evidence_admission_seq: transition.admission_seq,
          evidence_admitted_at: transition.recorded_at,
          governance_runtime_terminal: true,
          // Failure terminates the Runtime, not the already-completed human
          // interaction. Avoid creating a contradictory second activity
          // terminal when failure follows an explicit resume.
          ...(!failed
            ? canonicalActivityMetadata(canonicalInterruptActivity(String(intr.interrupt_id), 'completed'))
            : {}),
          ...(failed ? {
            runtime_lifecycle: 'failed',
            runtime_lifecycle_basis: 'recorded_event',
          } : {}),
        },
        source_span_id: intr.span_id ?? undefined,
        source_event_id: terminalEventType,
      } as any);
    }
  }

  // Admission controls membership; source nanoseconds control presentation.
  events.sort((a, b) => {
    const timeOrder = compareNanos(
      a.metadata?.runtime_timestamp_unix_nano ?? a.timestamp,
      b.metadata?.runtime_timestamp_unix_nano ?? b.timestamp,
    );
    if (timeOrder !== 0) return timeOrder;
    return a.id.localeCompare(b.id);
  });

  const governanceTransitions = interrupts.flatMap((interrupt) =>
    parseGovernanceStateHistory(interrupt.governance_state_history),
  );
  const admissionCursors = [...new Set([
    ...events.map((event) => event.sequence_num),
    ...governanceTransitions.map((transition) => transition.admission_seq),
  ])].sort((a, b) => a - b);
  const snapshots = admissionCursors.map((cursor) => {
    const frameSpans = scopeSpanIdsForBranchView(materializeSpanRevisions(admittedSpans, cursor), branchId);
    const snapshot = projectTraceSnapshot(missionId, branchId, frameSpans);
    const admittedEvents = events
      .filter((event) => event.sequence_num === cursor)
      .sort((left, right) => compareNanos(
        left.metadata?.runtime_timestamp_unix_nano ?? left.timestamp,
        right.metadata?.runtime_timestamp_unix_nano ?? right.timestamp,
      ) || left.id.localeCompare(right.id));
    const representative = admittedEvents[0];
    const governanceRepresentative = governanceTransitions.find((transition) => transition.admission_seq === cursor);
    snapshot.id = `snap-${cursor}`;
    snapshot.sequence_num = cursor;
    snapshot.source_event_sequence_num = cursor;
    snapshot.timestamp = representative?.timestamp ?? governanceRepresentative?.recorded_at ?? '1970-01-01T00:00:00.000Z';
    snapshot.source_event_id = representative?.id;
    snapshot.event_type = representative?.event_type;
    snapshot.event_description = representative
      ? `Evidence admitted: ${representative.event_type}`
      : governanceRepresentative
        ? `Governance evidence admitted: ${governanceRepresentative.axis}`
        : 'Evidence admitted';
    return snapshot;
  });
  if (snapshots.length === 0) {
    snapshots.push({
      ...projectTraceSnapshot(missionId, branchId, []),
      id: 'snap-0',
      sequence_num: 0,
      source_event_sequence_num: 0,
    });
  }

  const lastSnapshot = snapshots[snapshots.length - 1];
  const finalEvents = eventsThroughCursor(events, lastSnapshot.sequence_num);
  const firstSourceNano = finalEvents[0]?.metadata?.runtime_timestamp_unix_nano;
  const lastSourceNano = finalEvents.at(-1)?.metadata?.runtime_timestamp_unix_nano;
  const durationSeconds = firstSourceNano !== undefined && lastSourceNano !== undefined && finalEvents.length >= 2
    ? Number(nanoBigInt(lastSourceNano) - nanoBigInt(firstSourceNano)) / 1e9
    : null;

  const projectionTimestamp = String(
    finalEvents.reduce((latest, event) => {
      const admittedAt = event.metadata?.evidence_admitted_at;
      return typeof admittedAt === 'string' && admittedAt > latest ? admittedAt : latest;
    }, '1970-01-01T00:00:00.000Z'),
  );

  return {
    mission_id: missionId,
    branch_id: branchId,
    projection_version: SPAN_PROJECTION_VERSION,
    total_frames: snapshots.length,
    duration_seconds: durationSeconds,
    branches: [
      {
        id: branchId,
        name: branchId,
        mission_id: missionId,
        status: 'active',
        metadata: {},
        created_at: projectionTimestamp,
        updated_at: projectionTimestamp,
      },
    ],
    events,
    snapshots,
    current_state: projectRuntimeStateAtFrame(missionId, branchId, events, lastSnapshot, interrupts),
  };
}

/** Public Replay composition: evidence first, then L1 execution interpretation. */
export function projectReplay(
  missionId: string,
  branchId: string,
  spans: any[],
  interrupts: any[] = [],
): ReplayStateResponse {
  const replay = projectReplayEvidence(missionId, branchId, spans, interrupts);
  const explanation = projectRuntimeExplanation({
    mission_id: missionId,
    branch_id: branchId,
    events: replay.events as EventEnvelope[],
  });
  return {
    ...replay,
    current_state: replay.current_state
      ? {
          ...replay.current_state,
          status: explanation.run_outcome,
          status_provenance: explanation.run_outcome_provenance,
          phase: explanation.runtime_phase?.label ?? 'Unknown',
          runtime_phase: explanation.runtime_phase,
          agents: buildRuntimeAgentsFromEvents(
            replay.events,
            explanation.runtime_phase?.label ?? 'Unknown',
          ),
        }
      : null,
  };
}
