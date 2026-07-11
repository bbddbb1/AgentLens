import { SPAN_PROJECTION_VERSION } from '@agentlens/protocol';
import type {
  GraphSnapshot,
  GraphNode,
  GraphEdge,
  MissionEventRecord,
  NodeType,
  ProjectionProfile,
  ReplayStateResponse,
  RuntimeAgentState,
} from '@agentlens/protocol';
import { scanEventsToScratch } from '@agentlens/protocol';
import { applyHierarchicalLayout } from '../graphLayout.js';
import { normalizeSpansToFacts } from './normalization/index.js';
import { originFrameworkFromAttrs } from './normalization/agentLensCompat.js';
import { assembleModelProvenance } from './normalization/otelGenAi.js';
import { hasLangGraphMarkers, langGraphActivityCorrelationId, langGraphRunId } from './normalization/langgraph.js';

export type MaturityTier = 'L1' | 'L2' | 'L3';

function indexNormalizedActivities(facts: ReturnType<typeof normalizeSpansToFacts>) {
  const bySpanId = new Map<string, (typeof facts.activities)[number]>();
  /** Prefer run/correlation keys so repeated same-name events stay distinct. */
  const byInvocationKey = new Map<string, (typeof facts.activities)[number]>();
  const bySpanEventIndex = new Map<string, (typeof facts.activities)[number]>();
  for (const activity of facts.activities) {
    for (const source of activity.source_references) {
      if (!source.span_id) continue;
      if (source.event_name) {
        const runId = activity.native_runtime_identity?.run_id ?? activity.correlation.run_id;
        const correlationId = activity.native_runtime_identity?.activity_correlation_id
          ?? activity.correlation.activity_correlation_id;
        if (runId) {
          byInvocationKey.set(`${source.span_id}:${source.event_name}:run:${runId}`, activity);
        }
        if (correlationId) {
          byInvocationKey.set(`${source.span_id}:${source.event_name}:correlation:${correlationId}`, activity);
        }
        if (source.event_index !== undefined) {
          bySpanEventIndex.set(`${source.span_id}:${source.event_name}:${source.event_index}`, activity);
        }
      } else {
        bySpanId.set(source.span_id, activity);
      }
    }
  }
  return { bySpanId, byInvocationKey, bySpanEventIndex };
}

function lookupNormalizedEventActivity(
  index: ReturnType<typeof indexNormalizedActivities>,
  spanId: string,
  eventName: string,
  eventAttrs: Record<string, any>,
  eventIndex: number,
) {
  const runId = langGraphRunId(eventAttrs);
  const correlationId = langGraphActivityCorrelationId(eventAttrs);
  if (runId) {
    const byRun = index.byInvocationKey.get(`${spanId}:${eventName}:run:${runId}`);
    if (byRun) return byRun;
  }
  if (correlationId) {
    const byCorrelation = index.byInvocationKey.get(`${spanId}:${eventName}:correlation:${correlationId}`);
    if (byCorrelation) return byCorrelation;
  }
  return index.bySpanEventIndex.get(`${spanId}:${eventName}:${eventIndex}`);
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


function findAgentSpanId(agentId: string, spans: any[], currentSpanStartTime?: number): string | undefined {
  let bestSpan: any = undefined;
  let minDiff = Infinity;

  for (const span of spans) {
    const attrs = span.attributes ?? {};
    const sAgentId = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
    if (sAgentId === agentId) {
      if (currentSpanStartTime !== undefined) {
        const start = Number(span.start_time_unix_nano);
        const diff = start - currentSpanStartTime;
        if (diff >= 0 && diff < minDiff) {
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

function resolveNodeId(id: string, spans: any[], currentSpanStartTime?: number): string | undefined {
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
  maxTimeNs?: number
): GraphSnapshot {
  // 1. Filter visible spans based on maxTimeNs
  let visibleSpans = spans;
  if (maxTimeNs !== undefined) {
    visibleSpans = spans.filter((s) => Number(s.start_time_unix_nano) <= maxTimeNs);
  }

  // 2. Adjust active spans (started but not finished at maxTimeNs)
  if (maxTimeNs !== undefined) {
    visibleSpans = visibleSpans.map((s) => {
      const start = Number(s.start_time_unix_nano);
      const end = Number(s.end_time_unix_nano);
      if ((end > maxTimeNs || !s.end_time_unix_nano) && start <= maxTimeNs) {
        return {
          ...s,
          end_time_unix_nano: 0, // In progress
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
    const operationName = span.operation_name ?? span.name ?? 'span';

    // G7 & G8: Handoff & Review Edge projection from span.events (PR-3)
    if (Array.isArray(span.events)) {
      let eventIdx = 0;
      for (const event of span.events) {
        const eventAttrs = event.attributes ?? {};
        const eventName = event.name;

        // LangGraph relationship facts are normalized before generic projection.
        if (hasLangGraphMarkers({ ...attrs, ...eventAttrs })) continue;

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
            const resolvedTarget = resolveNodeId(String(target), visibleSpans, Number(span.start_time_unix_nano));
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
              metadata: { ...eventAttrs },
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
        const resolvedSource = resolveNodeId(String(source), visibleSpans, Number(span.start_time_unix_nano));
        const resolvedTarget = resolveNodeId(String(target), visibleSpans, Number(span.start_time_unix_nano));
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
          metadata: { ...attrs },
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
      normalizedActivity?.outcome === 'failure'
        ? 'failed'
        : normalizedActivity?.outcome === 'success'
          ? 'completed'
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
        start_time: new Date(Number(span.start_time_unix_nano) / 1e6).toISOString(),
        end_time: span.end_time_unix_nano ? new Date(Number(span.end_time_unix_nano) / 1e6).toISOString() : undefined,
        duration_ms: span.end_time_unix_nano ? (Number(span.end_time_unix_nano) - Number(span.start_time_unix_nano)) / 1e6 : undefined,
        error_count: span.status_code === 'ERROR' ? 1 : 0,
        metadata: {
          ...attrs,
          ...(normalizedActivity?.native_runtime_identity
            ? { native_runtime_identity: normalizedActivity.native_runtime_identity }
            : {}),
        },
        maturityTier: tier,
        maturity_tier: tier,
        evidenceSpanId: span.span_id,
        evidence_span_id: span.span_id,
        source_span_id: span.span_id,
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
      status: 'completed',
      evidenceSpanId: relationship.source.span_id,
      evidence_span_id: relationship.source.span_id,
      source_span_id: relationship.source.span_id,
      source_event_id: relationship.source.event_name,
      metadata: {},
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
            status: node.status === 'failed' ? 'failed' : node.status === 'completed' ? 'completed' : 'active',
            evidenceSpanId: span.span_id,
            evidence_span_id: span.span_id,
          });
        }
      }
    }
  }

  const snapshot: GraphSnapshot = {
    id: `snap-${maxTimeNs ?? 'latest'}`,
    mission_id: missionId,
    sequence_num: maxTimeNs ?? 0,
    timestamp: maxTimeNs ? new Date(maxTimeNs / 1e6).toISOString() : new Date().toISOString(),
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
export function projectReplay(
  missionId: string,
  branchId: string,
  spans: any[],
  interrupts: any[] = []
): ReplayStateResponse {
  const sortedSpans = [...spans].sort((a, b) => Number(a.start_time_unix_nano) - Number(b.start_time_unix_nano));
  const normalizedFacts = normalizeSpansToFacts(sortedSpans);
  const normalizedActivityIndex = indexNormalizedActivities(normalizedFacts);
  const {
    bySpanId: normalizedActivityBySpanId,
  } = normalizedActivityIndex;
  const timestamps = Array.from(new Set(sortedSpans.map((s) => Number(s.start_time_unix_nano)))).sort((a, b) => a - b);

  const snapshots = timestamps.map((ts, idx) => {
    const snap = projectTraceSnapshot(missionId, branchId, sortedSpans, ts);
    snap.sequence_num = idx;
    const currentSpan = sortedSpans.find((s) => Number(s.start_time_unix_nano) === ts);
    if (currentSpan) {
      snap.event_description = `Span started: ${currentSpan.operation_name ?? currentSpan.name ?? 'span'}`;
      snap.source_event_id = currentSpan.span_id;
      snap.source_event_sequence_num = idx;
    }
    return snap;
  });

  if (snapshots.length === 0) {
    const emptySnap = projectTraceSnapshot(missionId, branchId, []);
    emptySnap.sequence_num = 0;
    snapshots.push(emptySnap);
  }

  // Pre-build a map from span_id to trace_id (PR-4, G14)
  const spanTraceMap = new Map<string, string>();
  for (const s of sortedSpans) {
    if (s.span_id && s.trace_id) {
      spanTraceMap.set(s.span_id, s.trace_id);
    }
  }

  // Generate compatible events for the timeline
  const events: MissionEventRecord[] = [];
  let seq = 0;

  // Add span-based events
  for (const span of sortedSpans) {
    const tier = classifySpan(span);
    const startIso = new Date(Number(span.start_time_unix_nano) / 1e6).toISOString();
    const attrs = span.attributes ?? {};
    const operationName = span.operation_name ?? span.name ?? 'span';
    const agentId = attrs['gen_ai.agent.id'] ?? attrs['agentlens.agent.id'];
    const eventBranchId = span.branch_id ?? branchId;
    const normalizedActivity = normalizedActivityBySpanId.get(span.span_id);
    const nativeRuntimeMetadata = normalizedActivity?.native_runtime_identity
      ? { native_runtime_identity: normalizedActivity.native_runtime_identity }
      : {};

    events.push({
      id: span.span_id,
      mission_id: missionId,
      branch_id: eventBranchId,
      sequence_num: seq++,
      branch_sequence_num: seq,
      event_type: resolveSpanStartEventType(tier, attrs, operationName),
      timestamp: startIso,
      agent_id: agentId,
      span_id: span.span_id,
      trace_id: span.trace_id,
      parent_span_id: span.parent_span_id ?? undefined,
      payload: {
        ...attrs,
        operation_name: operationName,
        duration_ms: span.end_time_unix_nano ? (Number(span.end_time_unix_nano) - Number(span.start_time_unix_nano)) / 1e6 : undefined,
      },
      metadata: {
        maturity_tier: tier,
        ...nativeRuntimeMetadata,
      },
      actor_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
      actor_id: attrs['agentlens.actor.id'] ?? attrs['actor_id'] ?? (agentId ?? undefined),
      origin_framework: originFrameworkFromAttrs(attrs),
      causal: normalizeCausalContext(attrs, span.parent_span_id ?? undefined),
      model: assembleModelProvenance(attrs),
      error: assembleErrorProvenance(attrs, span),
      policy: parseAttrJson(attrs['agentlens.policy'] ?? attrs['policy'] ?? attrs['policy_decision']) ?? undefined,
      source_span_id: span.span_id,
      source_event_id: undefined,
    } as any);

    // Unpack internal span.events (PR-4, G1-G6, G13)
    if (Array.isArray(span.events)) {
      let eventIdx = 0;
      for (const otelEvent of span.events) {
        const currentEventIndex = eventIdx;
        const eventTimeIso = otelEvent.time
          ? new Date(otelEvent.time).toISOString()
          : startIso;

        const eventAttrs = otelEvent.attributes ?? {};
        const normalizedType = otelEvent.name;
        const mergedPayload = {
          ...attrs,
          ...eventAttrs,
          operation_name: operationName,
          duration_ms: span.end_time_unix_nano
            ? (Number(span.end_time_unix_nano) - Number(span.start_time_unix_nano)) / 1e6
            : undefined,
        };
        const mergedAttrs = { ...attrs, ...eventAttrs };
        const eventActivity = lookupNormalizedEventActivity(
          normalizedActivityIndex,
          span.span_id,
          otelEvent.name,
          eventAttrs,
          currentEventIndex,
        );
        const eventNativeRuntimeMetadata = eventActivity?.native_runtime_identity
          ? { native_runtime_identity: eventActivity.native_runtime_identity }
          : {};
        events.push({
          id: `${span.span_id}-event-${eventIdx++}`,
          mission_id: missionId,
          branch_id: eventBranchId,
          sequence_num: seq++,
          branch_sequence_num: seq,
          event_type: normalizedType,
          timestamp: eventTimeIso,
          agent_id: agentId,
          span_id: span.span_id,
          trace_id: span.trace_id,
          parent_span_id: span.parent_span_id ?? undefined,
          payload: mergedPayload,
          metadata: {
            maturity_tier: tier,
            ...eventNativeRuntimeMetadata,
          },
          actor_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
          actor_id: attrs['agentlens.actor.id'] ?? attrs['actor_id'] ?? (agentId ?? undefined),
          origin_framework: originFrameworkFromAttrs(mergedAttrs),
          causal: normalizeCausalContext(mergedAttrs, span.parent_span_id ?? undefined),
          model: assembleModelProvenance(mergedAttrs),
          error: assembleErrorProvenance(mergedAttrs, span),
          policy: parseAttrJson(mergedAttrs['agentlens.policy'] ?? mergedAttrs['policy'] ?? mergedAttrs['policy_decision']) ?? undefined,
          source_span_id: span.span_id,
          source_event_id: otelEvent.name,
        } as any);
      }
    }

    if (span.end_time_unix_nano) {
      const endIso = new Date(Number(span.end_time_unix_nano) / 1e6).toISOString();
      events.push({
        id: `${span.span_id}-end`,
        mission_id: missionId,
        branch_id: eventBranchId,
        sequence_num: seq++,
        branch_sequence_num: seq,
        event_type: span.status_code === 'ERROR' ? 'span.failed' : 'span.completed',
        timestamp: endIso,
        agent_id: agentId,
        span_id: span.span_id,
        trace_id: span.trace_id,
        parent_span_id: span.parent_span_id ?? undefined,
        payload: {
          ...attrs,
          operation_name: operationName,
          status_code: span.status_code,
        },
        metadata: {
          maturity_tier: tier,
          ...nativeRuntimeMetadata,
        },
      actor_type: attrs['agentlens.actor.type'] ?? attrs['actor_type'] ?? (agentId ? 'agent' : undefined),
      actor_id: attrs['agentlens.actor.id'] ?? attrs['actor_id'] ?? (agentId ?? undefined),
      origin_framework: originFrameworkFromAttrs(attrs),
      causal: normalizeCausalContext(attrs, span.parent_span_id ?? undefined),
      model: assembleModelProvenance(attrs),
      error: assembleErrorProvenance(attrs, span),
      policy: parseAttrJson(attrs['agentlens.policy'] ?? attrs['policy'] ?? attrs['policy_decision']) ?? undefined,
        source_span_id: span.span_id,
        source_event_id: undefined,
      } as any);
    }
  }

  // Add interrupt-based events
  for (const intr of interrupts) {
    const createdIso = new Date(intr.created_at).toISOString();
    const traceId = intr.span_id ? spanTraceMap.get(intr.span_id) : undefined;
    const interruptBranchId = intr.branch_id ?? branchId;

    events.push({
      id: `interrupt-${intr.interrupt_id}-requested`,
      mission_id: missionId,
      branch_id: interruptBranchId,
      sequence_num: seq++,
      branch_sequence_num: seq,
      event_type: 'interrupt.requested',
      timestamp: createdIso,
      agent_id: intr.agent_id ?? undefined,
      span_id: intr.span_id ?? undefined,
      trace_id: traceId,
      payload: {
        agent_id: intr.agent_id,
        interrupt_id: intr.interrupt_id,
        reason: intr.reason,
        resume_url: intr.resume_url,
        ...(intr.payload ?? {}),
      },
      metadata: {},
      causal: intr.span_id ? { parent_span_id: intr.span_id } : undefined,
      source_span_id: intr.span_id ?? undefined,
      source_event_id: 'interrupt.requested',
    } as any);

    if (intr.decided_at && intr.decision && intr.decision !== 'resume') {
      const decidedIso = new Date(intr.decided_at).toISOString();
      events.push({
        id: `interrupt-${intr.interrupt_id}-decision`,
        mission_id: missionId,
        branch_id: interruptBranchId,
        sequence_num: seq++,
        branch_sequence_num: seq,
        event_type: 'interrupt.decision',
        timestamp: decidedIso,
        agent_id: intr.agent_id ?? undefined,
        span_id: intr.span_id ?? undefined,
        trace_id: traceId,
        payload: {
          agent_id: intr.agent_id,
          interrupt_id: intr.interrupt_id,
          decision: intr.decision,
          comment: intr.decision_comment,
          ...(intr.decision_payload ?? {}),
        },
        metadata: {},
        causal: {
          parent_span_id: intr.span_id ?? undefined,
          decision_for_event_id: `interrupt-${intr.interrupt_id}-requested`,
        },
        source_span_id: intr.span_id ?? undefined,
        source_event_id: 'interrupt.decision',
      } as any);
    }

    if (intr.status === 'resumed' && intr.resumed_at) {
      const resumedIso = new Date(intr.resumed_at).toISOString();
      events.push({
        id: `interrupt-${intr.interrupt_id}-resumed`,
        mission_id: missionId,
        branch_id: interruptBranchId,
        sequence_num: seq++,
        branch_sequence_num: seq,
        event_type: 'interrupt.resumed',
        timestamp: resumedIso,
        agent_id: intr.agent_id ?? undefined,
        span_id: intr.span_id ?? undefined,
        trace_id: traceId,
        payload: {
          agent_id: intr.agent_id,
          interrupt_id: intr.interrupt_id,
          ...(intr.decision_payload ?? {}),
        },
        metadata: {},
        causal: {
          parent_span_id: intr.span_id ?? undefined,
          triggered_by_event_id: `interrupt-${intr.interrupt_id}-decision`,
        },
        source_span_id: intr.span_id ?? undefined,
        source_event_id: 'interrupt.resumed',
      } as any);
    }
  }

  // Sort events chronologically
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() || a.sequence_num - b.sequence_num);

  const spanStartSeqBySpanId = new Map<string, number>();
  for (const event of events) {
    if (event.span_id && event.id === event.span_id) {
      spanStartSeqBySpanId.set(event.span_id, event.sequence_num);
    }
  }
  for (const snap of snapshots) {
    if (!snap.source_event_id) continue;
    const seq = spanStartSeqBySpanId.get(snap.source_event_id);
    if (seq !== undefined) {
      snap.source_event_sequence_num = seq;
    }
  }

  const lastSnapshot = snapshots[snapshots.length - 1];
  const durationSeconds = timestamps.length >= 2
    ? (timestamps[timestamps.length - 1] - timestamps[0]) / 1e9
    : null;

  const replayPhase =
    lastSnapshot?.nodes.some((n) => n.status === 'failed') ? 'failed' : 'completed';
  const runtimeAgents = buildRuntimeAgentsFromEvents(events, replayPhase);

  const interruptsRecord: Record<string, any> = {};
  for (const intr of interrupts) {
    interruptsRecord[intr.interrupt_id] = {
      interrupt_id: intr.interrupt_id,
      status: intr.status,
      reason: intr.reason,
      agent_id: intr.agent_id ?? undefined,
      span_id: intr.span_id ?? undefined,
      decision: intr.decision ?? undefined,
      decision_comment: intr.decision_comment ?? undefined,
      resume_url: intr.resume_url ?? undefined,
      payload: intr.payload ?? {},
      decision_payload: intr.decision_payload ?? undefined,
      updated_at: intr.updated_at ? new Date(intr.updated_at).toISOString() : new Date().toISOString(),
    };
  }

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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    events,
    snapshots,
    current_state: {
      mission_id: missionId,
      branch_id: branchId,
      sequence_num: lastSnapshot?.sequence_num ?? 0,
      agents: runtimeAgents,
      interrupts: interruptsRecord,
      status: lastSnapshot?.nodes.some((n) => n.status === 'failed') ? 'failed' : 'completed',
      phase: replayPhase,
      nodes: lastSnapshot?.nodes ?? [],
      edges: lastSnapshot?.edges ?? [],
    },
  };
}
