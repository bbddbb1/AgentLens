/**
 * ROPS provenance classification — Runtime Object Presentation Specification.
 *
 * Every visible field in a ROPS presentation must be classified as Evidence (E),
 * a deterministic Runtime Projection (P), or Not Allowed (X). See
 * `docs/reference/rops.md` section 6 (Evidence Provenance Matrix) and P1/P4/P8.
 *
 * This module is a pure data layer over the frozen runtime core. It never reads
 * from the network, never calls an LLM, and never invents a field. It only
 * classifies and packs values that already exist on `RuntimeNodeProjection.facts`,
 * `GraphNode`, `GraphEdge`, `GraphSnapshot`, `EventEnvelope`, `InterruptRecord`,
 * `ReplayBranch`, and `Mission`.
 */

import type {
  CausalContext,
  ErrorAttribution,
  EventEnvelope,
  GraphEdge,
  GraphNode,
  InterruptRecord,
  Mission,
  ModelProvenance,
  NodeProjectionFacts,
  PolicyDecision,
  ProducedOutput,
  ProjectionProfile,
  ReplayBranch,
  RuntimeAgentState,
  RuntimeEventRef,
  RuntimeInterruptState,
  RuntimeNodeProjection,
} from '@agentlens/protocol';
import type { NodeCorrelatedEvidence } from './nodeEvidence.js';

/**
 * The three ROPS provenance classes (spec section 6).
 *
 * - `evidence`   — value present verbatim in a runtime record.
 * - `projection` — deterministic, ledger-derived value (labeled `[projection]`).
 * - `heuristic`  — deterministic projection derived from a non-authoritative
 *                  signal (labeled `[projection · heuristic]`); see P8. Used by
 *                  `classifySearch` when a search is inferred from a tool-name
 *                  pattern rather than an explicit `search.*` attribute. ROPS
 *                  never invents a metric the runtime did not emit: confidence
 *                  is Evidence-or-absent, never a heuristic formula.
 *
 * `notAllowed` is intentionally absent: a Not-Allowed field is never packed into
 * a view model, so it never appears as a value. Callers use `isAllowed` /
 * `FORBIDDEN_FIELDS` to decide what to omit.
 */
export type Provenance = 'evidence' | 'projection' | 'heuristic';

/**
 * A single ROPS-classified field value. `absent` is true when the field has no
 * Evidence and no Projection (spec P7): the presentation renders a stable
 * "not recorded" marker rather than a fabricated default.
 */
export interface RopsField<T = unknown> {
  readonly key: string;
  readonly provenance: Provenance;
  readonly value: T | undefined;
  readonly absent: boolean;
}

/** The set of `NodeProjectionGenerated` / summary fields ROPS forbids (P4). */
export const FORBIDDEN_FIELDS = [
  'generated.current_understanding',
  'generated.highlights',
  'generated.suggested_title',
  'generated.llm_warnings',
  'RuntimeSummary.narrative',
  'WhyThisState.aiNarrative',
  'ReviewPanel.summary',
  'ReviewPanel.conflicts',
  'ReviewPanel.anomalies',
] as const;

/** Predicate: is a field key allowed under ROPS? (false => X-class, never render). */
export function isAllowed(key: string): boolean {
  return !(FORBIDDEN_FIELDS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Primitive builders
// ---------------------------------------------------------------------------

/** Pack a verbatim runtime value as Evidence; absent when undefined/null. */
function evidence<T>(key: string, value: T | undefined | null): RopsField<T> {
  return {
    key,
    provenance: 'evidence',
    value: (value === null ? undefined : value) as T | undefined,
    absent: value === undefined || value === null,
  };
}

/**
 * Public Evidence packer for presentation components that receive raw values
 * from a pure correlation layer (e.g. `collectNodeEvidence`). The caller is
 * responsible for guaranteeing the value is verbatim runtime evidence; this
 * helper only classifies and packs it. Never use it for inferred/projection
 * values — use `projection(...)` for those.
 */
export const packEvidence = evidence;

/** Pack a deterministic projection; the caller must guarantee pure derivation. */
function projection<T>(key: string, value: T | undefined | null): RopsField<T> {
  return {
    key,
    provenance: 'projection',
    value: (value === null ? undefined : value) as T | undefined,
    absent: value === undefined || value === null,
  };
}


// ---------------------------------------------------------------------------
// Status / lifecycle vocabulary (spec section 7.1 / 7.2)
// ---------------------------------------------------------------------------

export type NodeStatusLabel = 'Idle' | 'Active' | 'Completed' | 'Failed' | 'Waiting' | 'Reviewing';

const NODE_STATUS_LABELS: Record<string, NodeStatusLabel> = {
  idle: 'Idle',
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
  waiting: 'Waiting',
  reviewing: 'Reviewing',
};

/** Deterministic label for a `NodeStatus` (mirrors `statusLabel` in the core). */
export function nodeStatusLabel(status: string | undefined): NodeStatusLabel | undefined {
  if (!status) return undefined;
  return NODE_STATUS_LABELS[status] ?? (status as NodeStatusLabel);
}

/** Duration in ms derived from `end_time - start_time` (spec 6.2, `duration_ms`). */
export function deriveDurationMs(
  startTime?: string,
  endTime?: string,
): number | undefined {
  if (!startTime || !endTime) return undefined;
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return end - start;
}

// ---------------------------------------------------------------------------
// Confidence provenance (spec 6.2 / 10.3 / P8)
// ---------------------------------------------------------------------------

/**
 * Classify `confidence` on a node projection (spec 10.3 / P0 / P8).
 *
 * Rule (passive observability): `confidence` is Evidence only when the runtime
 * emitted it. `AgentNodeScratch.confidence` — and therefore
 * `NodeProjectionFacts.confidence` — is set exclusively from a parsed
 * `gen_ai.agent.confidence` / `confidence` attribute (`projectionScratch.ts`)
 * and is left `undefined` when the runtime did not emit one. `scratchToFacts`
 * passes that value through verbatim and no longer synthesizes a fallback
 * formula, so a present `confidence` is always emitter-set Evidence and an
 * absent one renders as the stable "not recorded" marker. There is no
 * heuristic confidence path.
 */
export function classifyConfidence(
  confidence: number | undefined,
): RopsField<number> {
  return evidence('confidence', confidence);
}

// ---------------------------------------------------------------------------
// Relationship derivation (spec 6.4)
// ---------------------------------------------------------------------------

export interface DerivedRelationship {
  readonly kind: 'children' | 'producer' | 'consumer' | 'parent' | 'dependency';
  readonly edgeType: string;
  readonly nodeIds: readonly string[];
  readonly provenance: Provenance;
}

export interface ReadableRelationshipTarget {
  readonly id: string;
  readonly label: string;
  readonly type?: string;
  readonly status?: string;
  readonly resolved: boolean;
}

/** Resolve projected relationship ids to human-readable runtime node identities. */
export function resolveRelationshipTargets(
  nodeIds: readonly string[],
  nodes: readonly GraphNode[],
): ReadableRelationshipTarget[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return nodeIds.map((id) => {
    const node = nodesById.get(id);
    return {
      id,
      label: node?.activity?.label ?? node?.label ?? id,
      type: node?.type,
      status: node?.status,
      resolved: Boolean(node),
    };
  });
}

/** Derive `children`/`producer`/`consumer`/`parent` adjacency from edges (spec 6.4). */
export function deriveRelationships(
  nodeId: string,
  edges: readonly GraphEdge[],
): DerivedRelationship[] {
  const out: DerivedRelationship[] = [];
  const children = edges
    .filter((e) => e.source === nodeId)
    .map((e) => e.target);
  if (children.length > 0) {
    out.push({ kind: 'children', edgeType: 'outgoing', nodeIds: children, provenance: 'projection' });
  }
  const parents = edges
    .filter((e) => e.target === nodeId)
    .map((e) => e.source);
  if (parents.length > 0) {
    out.push({ kind: 'parent', edgeType: 'incoming', nodeIds: parents, provenance: 'projection' });
  }
  const producers = edges
    .filter((e) => e.target === nodeId && (e.type === 'produces' || e.type === 'uses' || e.type === 'data_flow'))
    .map((e) => e.source);
  if (producers.length > 0) {
    out.push({ kind: 'producer', edgeType: 'produces|uses|data_flow', nodeIds: producers, provenance: 'projection' });
  }
  const consumers = edges
    .filter((e) => e.source === nodeId && (e.type === 'produces' || e.type === 'uses' || e.type === 'data_flow'))
    .map((e) => e.target);
  if (consumers.length > 0) {
    out.push({ kind: 'consumer', edgeType: 'produces|uses|data_flow', nodeIds: consumers, provenance: 'projection' });
  }
  const deps = edges
    .filter((e) => e.source === nodeId && e.type === 'dependency')
    .map((e) => e.target);
  if (deps.length > 0) {
    out.push({ kind: 'dependency', edgeType: 'dependency', nodeIds: deps, provenance: 'projection' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// EventEnvelope provenance block (spec 9.4 / 6.1)
// ---------------------------------------------------------------------------

export interface EnvelopeProvenance {
  readonly actorType: RopsField<string>;
  readonly actorId: RopsField<string>;
  readonly originFramework: RopsField<string>;
  readonly model: {
    readonly provider: RopsField<string>;
    readonly modelName: RopsField<string>;
    readonly modelVersion: RopsField<string>;
    readonly tokensInput: RopsField<number>;
    readonly tokensOutput: RopsField<number>;
    readonly temperature: RopsField<number>;
    readonly stopReason: RopsField<string>;
  } | null;
  readonly policy: {
    readonly ruleId: RopsField<string>;
    readonly decision: RopsField<string>;
    readonly reason: RopsField<string>;
  } | null;
  readonly error: {
    readonly source: RopsField<string>;
    readonly cause: RopsField<string>;
    readonly severity: RopsField<string>;
    readonly recoveryAction: RopsField<string>;
    readonly originalError: RopsField<string>;
  } | null;
  readonly causal: {
    readonly parentSpanId: RopsField<string>;
    readonly toolCallId: RopsField<string>;
    readonly decisionForEventId: RopsField<string>;
    readonly triggeredByEventId: RopsField<string>;
  } | null;
  readonly contentHash: RopsField<string>;
  readonly previousHash: RopsField<string>;
}

/** Build the L4 provenance block from an `EventEnvelope` (spec 9.4). */
export function envelopeProvenance(env: EventEnvelope | undefined | null): EnvelopeProvenance | null {
  if (!env) return null;
  const model = env.model ? packModel(env.model) : null;
  const policy = env.policy ? packPolicy(env.policy) : null;
  const error = env.error ? packError(env.error) : null;
  const causal = env.causal ? packCausal(env.causal) : null;
  return {
    actorType: evidence('actor_type', env.actor_type),
    actorId: evidence('actor_id', env.actor_id),
    originFramework: evidence('origin_framework', env.origin_framework),
    model,
    policy,
    error,
    causal,
    contentHash: evidence('content_hash', env.content_hash),
    previousHash: evidence('previous_hash', env.previous_hash),
  };
}

function packModel(m: ModelProvenance): EnvelopeProvenance['model'] {
  return {
    provider: evidence('model.provider', m.provider),
    modelName: evidence('model.model_name', m.model_name),
    modelVersion: evidence('model.model_version', m.model_version),
    tokensInput: evidence('model.tokens_input', m.tokens_input),
    tokensOutput: evidence('model.tokens_output', m.tokens_output),
    temperature: evidence('model.temperature', m.temperature),
    stopReason: evidence('model.stop_reason', m.stop_reason),
  };
}

function packPolicy(p: PolicyDecision): EnvelopeProvenance['policy'] {
  return {
    ruleId: evidence('policy.rule_id', p.rule_id),
    decision: evidence('policy.decision', p.decision),
    reason: evidence('policy.reason', p.reason),
  };
}

function packError(e: ErrorAttribution): EnvelopeProvenance['error'] {
  return {
    source: evidence('error.source', e.source),
    cause: evidence('error.cause', e.cause),
    severity: evidence('error.severity', e.severity),
    recoveryAction: evidence('error.recovery_action', e.recovery_action),
    originalError: evidence('error.original_error', e.original_error),
  };
}

function packCausal(c: CausalContext): EnvelopeProvenance['causal'] {
  return {
    parentSpanId: evidence('causal.parent_span_id', c.parent_span_id),
    toolCallId: evidence('causal.tool_call_id', c.tool_call_id),
    decisionForEventId: evidence('causal.decision_for_event_id', c.decision_for_event_id),
    triggeredByEventId: evidence('causal.triggered_by_event_id', c.triggered_by_event_id),
  };
}

// ---------------------------------------------------------------------------
// Typed extraction whitelist (spec section 8.1)
// ---------------------------------------------------------------------------

/**
 * The payload keys the frozen scratch recognizes (`applyEventToScratch`).
 * Values under these keys are first-class Evidence presentable at L2+.
 * Any other payload/metadata key is Evidence but unrecognized — L4 only (8.2).
 */
export const PAYLOAD_WHITELIST: readonly string[] = [
  'task',
  'tool_name',
  'gen_ai.tool.name',
  'gen_ai.tool.input',
  'tool_input',
  'input',
  'tool_output',
  'output',
  'gen_ai.tool.output',
  'gen_ai.tool.status',
  'memory_key',
  'key',
  'value',
  'memory_value',
  'gen_ai.agent.memory.key',
  'gen_ai.agent.memory.value',
  'gen_ai.agent.memory.operation',
  'artifact_name',
  'name',
  'artifact_type',
  'type',
  'reason',
  'target_agent_id',
  'insight',
  'phase',
  'gen_ai.agent.role',
  'role',
  'agent_role',
  'gen_ai.agent.confidence',
  'confidence',
  'gen_ai.agent.drift_score',
  'drift_score',
  'gen_ai.agent.framework',
  'framework',
  'agent_framework',
  'gen_ai.agent.iteration',
  'agent.iteration',
  'iteration',
  'agentlens.actor.type',
  'actor_type',
  'agent_type',
  'goal',
  'summary',
  'gen_ai.agent.task.description',
  'gen_ai.agent.handoff.reason',
  'gen_ai.agent.delegation.reason',
  'decision',
  'decision_comment',
  'decision_payload',
  'resume_url',
  'gen_ai.agent.resume.token',
  'gen_ai.agent.timeout_at',
  'gen_ai.agent.policy.required_review',
  'gen_ai.agent.interrupt.id',
  'gen_ai.agent.interrupt.reason',
  'gen_ai.agent.id',
  'operation_name',
  // LLM call provenance (verbatim gen_ai.* attributes on llm.call spans)
  'gen_ai.system',
  'gen_ai.request.model',
  'gen_ai.model.version',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.request.temperature',
  'gen_ai.response.finish_reason',
  // No-schema Evidence keys: these have no semconv/SDK/projection, so they are
  // only present when an emitter set them verbatim. Whitelisting classifies
  // them as recognized Evidence (L2+ presentable) rather than unrecognized
  // (L4-only). They are never fabricated or inferred when absent.
  'search.query',
  'search_query',
  'query',
  'search.result_count',
  'result_count',
  'resultCount',
  'retrieval.backend',
  'retrieval_backend',
  'retrievalBackend',
];

/** Split a payload bag into (recognized, unrecognized) entries (spec 8.1/8.2). */
export function splitPayload(
  payload: Record<string, unknown> | undefined,
): { recognized: Array<readonly [string, unknown]>; unrecognized: Array<readonly [string, unknown]> } {
  const recognized: Array<readonly [string, unknown]> = [];
  const unrecognized: Array<readonly [string, unknown]> = [];
  if (!payload) return { recognized, unrecognized };
  for (const [k, v] of Object.entries(payload)) {
    if (PAYLOAD_WHITELIST.includes(k)) recognized.push([k, v] as const);
    else unrecognized.push([k, v] as const);
  }
  return { recognized, unrecognized };
}

// ---------------------------------------------------------------------------
// Profile-aware evidence rows (spec P1 — ProjectionProfile presentation)
// ---------------------------------------------------------------------------
// `ProjectionProfile` is presentation metadata carried on `GraphNode` (see
// packages/protocol/src/types.ts). It selects which standardized fields the
// inspector surfaces as first-class Evidence rows and which inspector
// component renders them. It is NOT a runtime-ontology expansion:
//   - It never re-maps `GraphNode.type`, merges nodes, hides nodes, or invents
//     a synthetic hierarchy (workflow topology invariants).
//   - Promotion is rule-based over verbatim attributes; `PAYLOAD_WHITELIST` is
//     not expanded for mere exposure. Only keys actually consumed by a row are
//     removed from `leftoverPayload` so they do not duplicate in the raw
//     payload section (raw boundary invariants).
//   - Unknown attributes remain verbatim forever; absence renders as
//     "not recorded", never an invented default.

/** A single first-class Evidence row surfaced for a profile. */
export interface ProfileEvidenceRow {
  readonly label: string;
  readonly field: RopsField<unknown>;
}

/** Result of building profile rows: the rows + payload with consumed keys removed. */
export interface ProfileEvidenceResult {
  readonly rows: readonly ProfileEvidenceRow[];
  /** `payload` with the keys consumed by the rows removed (no duplication in raw). */
  readonly leftoverPayload: Record<string, unknown> | undefined;
}

/** First non-null/undefined value among `aliases` in `payload`, else undefined. */
function pickAlias(
  payload: Record<string, unknown> | undefined,
  aliases: readonly string[],
): unknown | undefined {
  if (!payload) return undefined;
  for (const a of aliases) {
    const v = payload[a];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** Return `payload` with `keys` removed. Returns the same ref when nothing is removed. */
function removeKeys(
  payload: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!payload) return undefined;
  const set = new Set(keys);
  let touched = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (set.has(k)) {
      touched = true;
      continue;
    }
    out[k] = v;
  }
  return touched ? out : payload;
}

// Payload keys consumed (removed from the raw section) per profile. These mirror
// the alias sets in `nodeEvidence.ts` and the `PAYLOAD_WHITELIST` entries; they
// are not a whitelist expansion — they name exactly the keys the rows below read.
const LLM_CONSUMED_KEYS = [
  'gen_ai.system',
  'gen_ai.request.model',
  'gen_ai.model.version',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.request.temperature',
  'gen_ai.response.finish_reason',
  'gen_ai.agent.id',
] as const;

const TOOL_CONSUMED_KEYS = [
  'gen_ai.tool.name',
  'tool_name',
  'name',
  'gen_ai.tool.input',
  'tool_input',
  'input',
  'gen_ai.tool.output',
  'tool_output',
  'output',
  'gen_ai.tool.status',
  'tool_status',
  'status',
] as const;

const RETRIEVAL_CONSUMED_KEYS = [
  'retrieval.backend',
  'retrieval_backend',
  'retrievalBackend',
  'search.query',
  'search_query',
  'query',
  'search.result_count',
  'result_count',
  'resultCount',
  'gen_ai.tool.name',
  'tool_name',
  'gen_ai.tool.input',
  'tool_input',
  'gen_ai.tool.output',
  'tool_output',
] as const;

const MEMORY_CONSUMED_KEYS = [
  'gen_ai.agent.memory.key',
  'memory_key',
  'key',
  'gen_ai.agent.memory.value',
  'memory_value',
  'value',
  'gen_ai.agent.memory.operation',
] as const;

const ARTIFACT_CONSUMED_KEYS = [
  'artifact_name',
  'name',
  'artifact_type',
  'type',
  'value',
] as const;

const WORKFLOW_STEP_CONSUMED_KEYS = [
  'task',
  'gen_ai.workflow.step_id',
  'gen_ai.agent.task.description',
] as const;

function buildLlmRows(
  payload: Record<string, unknown> | undefined,
  prov: EnvelopeProvenance | null,
): ProfileEvidenceRow[] {
  const m = prov?.model;
  // Verbatim `gen_ai.*` span attributes win; the correlated `EventEnvelope`
  // model provenance is used only as a fallback when the span did not emit the
  // attribute. Both sources are Evidence (never fabricated).
  const row = (label: string, payloadKey: string, fallback: unknown): ProfileEvidenceRow => ({
    label,
    field: evidence(label, (payload?.[payloadKey] ?? fallback) as unknown),
  });
  return [
    row('gen_ai.system', 'gen_ai.system', m?.provider.value),
    row('gen_ai.request.model', 'gen_ai.request.model', m?.modelName.value),
    row('gen_ai.model.version', 'gen_ai.model.version', m?.modelVersion.value),
    row('gen_ai.usage.input_tokens', 'gen_ai.usage.input_tokens', m?.tokensInput.value),
    row('gen_ai.usage.output_tokens', 'gen_ai.usage.output_tokens', m?.tokensOutput.value),
    row('gen_ai.request.temperature', 'gen_ai.request.temperature', m?.temperature.value),
    row('gen_ai.response.finish_reason', 'gen_ai.response.finish_reason', m?.stopReason.value),
    row('gen_ai.agent.id', 'gen_ai.agent.id', undefined),
  ];
}

function buildToolRows(ev: NodeCorrelatedEvidence | undefined): ProfileEvidenceRow[] {
  const e: Partial<NodeCorrelatedEvidence> = ev ?? {};
  return [
    { label: 'tool_name', field: evidence('tool_name', e.toolName) },
    { label: 'tool_input', field: evidence('tool_input', e.toolInput) },
    { label: 'tool_output', field: evidence('tool_output', e.toolOutput) },
    { label: 'tool_status', field: evidence('tool_status', e.toolStatus) },
    { label: 'failure_reason', field: evidence('failure_reason', e.failureReason) },
    { label: 'failure_cause', field: evidence('failure_cause', e.failureCause) },
  ];
}

function buildRetrievalRows(ev: NodeCorrelatedEvidence | undefined): ProfileEvidenceRow[] {
  const e: Partial<NodeCorrelatedEvidence> = ev ?? {};
  return [
    { label: 'retrieval.backend', field: evidence('retrieval.backend', e.retrievalBackend) },
    { label: 'search.query', field: evidence('search.query', e.searchQuery) },
    { label: 'search.result_count', field: evidence('search.result_count', e.resultCount) },
    { label: 'tool_input', field: evidence('tool_input', e.toolInput) },
    { label: 'tool_output', field: evidence('tool_output', e.toolOutput) },
    { label: 'failure_reason', field: evidence('failure_reason', e.failureReason) },
    { label: 'failure_cause', field: evidence('failure_cause', e.failureCause) },
  ];
}

function buildMemoryRows(payload: Record<string, unknown> | undefined): ProfileEvidenceRow[] {
  return [
    {
      label: 'memory_key',
      field: evidence('memory_key', pickAlias(payload, ['gen_ai.agent.memory.key', 'memory_key', 'key'])),
    },
    {
      label: 'memory_value',
      field: evidence('memory_value', pickAlias(payload, ['gen_ai.agent.memory.value', 'memory_value', 'value'])),
    },
    {
      label: 'operation',
      field: evidence('operation', pickAlias(payload, ['gen_ai.agent.memory.operation'])),
    },
  ];
}

function buildArtifactRows(payload: Record<string, unknown> | undefined): ProfileEvidenceRow[] {
  return [
    {
      label: 'artifact_name',
      field: evidence('artifact_name', pickAlias(payload, ['artifact_name', 'name'])),
    },
    {
      label: 'artifact_type',
      field: evidence('artifact_type', pickAlias(payload, ['artifact_type', 'type'])),
    },
    { label: 'value', field: evidence('value', pickAlias(payload, ['value'])) },
  ];
}

function buildWorkflowStepRows(
  payload: Record<string, unknown> | undefined,
  ev: NodeCorrelatedEvidence | undefined,
): ProfileEvidenceRow[] {
  const e: Partial<NodeCorrelatedEvidence> = ev ?? {};
  const stepId = payload?.['gen_ai.workflow.step_id'];
  return [
    {
      label: 'task',
      field: evidence(
        'task',
        pickAlias(payload, ['task', 'gen_ai.workflow.step_id', 'gen_ai.agent.task.description']),
      ),
    },
    { label: 'gen_ai.workflow.step_id', field: evidence('gen_ai.workflow.step_id', stepId) },
    {
      label: 'gen_ai.agent.task.description',
      field: evidence('gen_ai.agent.task.description', payload?.['gen_ai.agent.task.description']),
    },
    { label: 'failure_reason', field: evidence('failure_reason', e.failureReason) },
    { label: 'failure_cause', field: evidence('failure_cause', e.failureCause) },
  ];
}

/**
 * Build the first-class Evidence rows for a `ProjectionProfile` and the
 * payload with consumed keys removed. Profiles that surface their fields via a
 * dedicated view (`agent` → AgentView, `checkpoint` → checkpoint view,
 * `mission` → Mission record, `human` / `generic` → generic view) return no
 * rows and leave the payload untouched so all attributes remain raw.
 */
export function buildProfileEvidenceRows(
  profile: ProjectionProfile,
  payload: Record<string, unknown> | undefined,
  ev: NodeCorrelatedEvidence | undefined,
  prov: EnvelopeProvenance | null,
): ProfileEvidenceResult {
  switch (profile) {
    case 'llm':
      return { rows: buildLlmRows(payload, prov), leftoverPayload: removeKeys(payload, LLM_CONSUMED_KEYS) };
    case 'tool':
      return { rows: buildToolRows(ev), leftoverPayload: removeKeys(payload, TOOL_CONSUMED_KEYS) };
    case 'retrieval':
      return { rows: buildRetrievalRows(ev), leftoverPayload: removeKeys(payload, RETRIEVAL_CONSUMED_KEYS) };
    case 'memory':
      return { rows: buildMemoryRows(payload), leftoverPayload: removeKeys(payload, MEMORY_CONSUMED_KEYS) };
    case 'artifact':
      return { rows: buildArtifactRows(payload), leftoverPayload: removeKeys(payload, ARTIFACT_CONSUMED_KEYS) };
    case 'workflow_step':
      return {
        rows: buildWorkflowStepRows(payload, ev),
        leftoverPayload: removeKeys(payload, WORKFLOW_STEP_CONSUMED_KEYS),
      };
    // 'agent' | 'checkpoint' | 'human' | 'mission' | 'generic' — no payload
    // promotion here; their inspectors use dedicated views and keep all
    // workload-specific attributes verbatim as raw.
    default:
      return { rows: [], leftoverPayload: payload };
  }
}

// ---------------------------------------------------------------------------
// Search heuristic (spec 3.6 / 6.3)
// ---------------------------------------------------------------------------

const SEARCH_TOOL_PATTERNS = /(search|retrieve|retrieval|query|lookup|cmdb|metric|topology)/i;

/**
 * Classify a ToolInvocation as a Search projection (spec 3.6).
 * Deterministic heuristic over the tool name and/or explicit `search.*` payload
 * keys. Returns `true` with provenance `heuristic` when pattern-matched, or
 * `true` with provenance `evidence` when an explicit `search.*` key is present.
 */
export function classifySearch(
  toolName: string | undefined,
  payload: Record<string, unknown> | undefined,
): { isSearch: true; provenance: Provenance } | { isSearch: false } {
  if (payload) {
    for (const k of Object.keys(payload)) {
      if (k.startsWith('search.')) return { isSearch: true, provenance: 'evidence' };
    }
  }
  if (toolName && SEARCH_TOOL_PATTERNS.test(toolName)) {
    return { isSearch: true, provenance: 'heuristic' };
  }
  return { isSearch: false };
}

// ---------------------------------------------------------------------------
// Token aggregation (spec 6.5)
// ---------------------------------------------------------------------------

/** Sum `tokens_input`/`tokens_output` across an envelope set (spec 6.5, P). */
export function aggregateTokens(
  envelopes: readonly EventEnvelope[],
): { tokensInput: number; tokensOutput: number } {
  let tokensInput = 0;
  let tokensOutput = 0;
  for (const env of envelopes) {
    if (env.model?.tokens_input !== undefined) tokensInput += env.model.tokens_input;
    if (env.model?.tokens_output !== undefined) tokensOutput += env.model.tokens_output;
  }
  return { tokensInput, tokensOutput };
}

// ---------------------------------------------------------------------------
// View-model builders per ROPS object type (spec section 3 / 9.3)
// ---------------------------------------------------------------------------

export interface AgentView {
  readonly objectType: 'Agent';
  readonly agentId: RopsField<string>;
  readonly name: RopsField<string>;
  readonly nodeType: RopsField<string>;
  readonly role: RopsField<string>;
  readonly agentType: RopsField<string>;
  readonly framework: RopsField<string>;
  readonly team: RopsField<string>;
  readonly status: RopsField<string>;
  readonly statusLabel: RopsField<NodeStatusLabel>;
  readonly iteration: RopsField<number>;
  readonly startTime: RopsField<string>;
  readonly endTime: RopsField<string>;
  readonly durationMs: RopsField<number>;
  readonly errorCount: RopsField<number>;
  readonly confidence: RopsField<number>;
  readonly driftScore: RopsField<number>;
  readonly requiresHuman: RopsField<boolean>;
  readonly pending: RopsField<string>;
  readonly producedOutputs: RopsField<ProducedOutput[]>;
  readonly nextTransition: RopsField<{ target: string; kind: string; reason?: string }>;
  readonly warnings: RopsField<ReadonlyArray<{ code: string; message: string; sequence_num: number; severity?: string }>>;
  readonly recentRuntimeEvents: RopsField<RuntimeEventRef[]>;
  readonly sourceSpanId: RopsField<string>;
  readonly sourceEventId: RopsField<string>;
}

/**
 * Build the Agent view from `RuntimeNodeProjection.facts` + `recent_runtime_events`.
 * Never reads `projection.generated` (spec P4 / 9.2).
 *
 * `confidence` is classified by `classifyConfidence` from `facts.confidence`
 * alone: Evidence when the runtime emitted `gen_ai.agent.confidence`, "not
 * recorded" when absent. The projection no longer fabricates a fallback, so no
 * emitter-presence hint is required (spec 10.3 / P0).
 */
export function buildAgentView(
  nodeProjection: RuntimeNodeProjection,
): AgentView {
  const facts: NodeProjectionFacts = nodeProjection.facts;
  const confidence = classifyConfidence(facts.confidence);
  const durationMs = facts.duration_ms !== undefined
    ? projection('duration_ms', facts.duration_ms)
    : projection('duration_ms', deriveDurationMs(facts.start_time, facts.end_time));
  return {
    objectType: 'Agent',
    agentId: evidence('agent_id', facts.agent_id ?? nodeProjection.agent_id),
    name: evidence('name', nodeProjection.name),
    nodeType: evidence('node_type', nodeProjection.node_type),
    role: evidence('role', facts.role),
    agentType: evidence('agent_type', facts.agent_type),
    framework: evidence('framework', facts.framework),
    team: evidence<string>('team', undefined),
    status: evidence('status', facts.status),
    statusLabel: projection('status_label', nodeStatusLabel(facts.status)),
    iteration: evidence('iteration', facts.iteration),
    startTime: evidence('start_time', facts.start_time),
    endTime: evidence('end_time', facts.end_time),
    durationMs,
    errorCount: evidence('error_count', facts.error_count),
    confidence,
    driftScore: evidence('drift_score', facts.drift_score),
    requiresHuman: evidence('requires_human', facts.requires_human),
    pending: evidence('pending', facts.pending ?? undefined),
    producedOutputs: evidence('produced_outputs', facts.produced_outputs),
    nextTransition: evidence('next_transition', facts.next_transition),
    warnings: evidence('warnings', facts.warnings),
    recentRuntimeEvents: evidence('recent_runtime_events', nodeProjection.recent_runtime_events),
    sourceSpanId: evidence('source_span_id', facts.source_span_id),
    sourceEventId: evidence('source_event_id', facts.source_event_id),
  };
}

export interface GraphNodeView {
  readonly objectType: 'WorkflowStep' | 'ToolInvocation' | 'Memory' | 'Artifact' | 'Agent';
  readonly id: RopsField<string>;
  readonly label: RopsField<string>;
  readonly nodeType: RopsField<string>;
  readonly status: RopsField<string>;
  readonly statusLabel: RopsField<NodeStatusLabel>;
  readonly role: RopsField<string>;
  readonly team: RopsField<string>;
  readonly framework: RopsField<string>;
  readonly startTime: RopsField<string>;
  readonly endTime: RopsField<string>;
  readonly durationMs: RopsField<number>;
  readonly errorCount: RopsField<number>;
  readonly confidence: RopsField<number>;
  readonly agentId: RopsField<string>;
  readonly spanId: RopsField<string>;
  readonly traceId: RopsField<string>;
  readonly sourceSpanId: RopsField<string>;
  readonly sourceEventId: RopsField<string>;
  readonly metadata: RopsField<Record<string, unknown>>;
}

/**
 * Build a view over a `GraphNode` (spec 3.3/3.5/3.7/3.9/3.4). The `objectType`
 * is derived deterministically from `node.type`. `GraphNode.confidence` is
 * treated as Evidence only when present (the graph layer does not run the
 * inferred formula; that lives in the node projection).
 */
export function buildGraphNodeView(node: GraphNode): GraphNodeView {
  const objectType: GraphNodeView['objectType'] =
    node.type === 'agent' ? 'Agent'
      : node.type === 'task' ? 'WorkflowStep'
      : node.type === 'tool' ? 'ToolInvocation'
      : node.type === 'memory' ? 'Memory'
      : node.type === 'artifact' ? 'Artifact'
      : 'ToolInvocation';
  return {
    objectType,
    id: evidence('id', node.id),
    label: evidence('label', node.label),
    nodeType: evidence('node_type', node.type),
    status: evidence('status', node.status),
    statusLabel: projection('status_label', nodeStatusLabel(node.status)),
    role: evidence('role', node.agent_role),
    team: evidence('team', node.agent_team),
    framework: evidence('framework', node.framework),
    startTime: evidence('start_time', node.start_time),
    endTime: evidence('end_time', node.end_time),
    durationMs: projection('duration_ms', node.duration_ms ?? deriveDurationMs(node.start_time, node.end_time)),
    errorCount: evidence('error_count', node.error_count),
    confidence: evidence('confidence', node.confidence),
    agentId: evidence('agent_id', node.agent_id),
    spanId: evidence('span_id', node.span_id),
    traceId: evidence('trace_id', node.trace_id),
    sourceSpanId: evidence('source_span_id', node.source_span_id),
    sourceEventId: evidence('source_event_id', node.source_event_id),
    metadata: evidence('metadata', node.metadata),
  };
}

export interface InterruptView {
  readonly objectType: 'Interrupt';
  readonly interruptId: RopsField<string>;
  readonly status: RopsField<string>;
  readonly reason: RopsField<string>;
  readonly agentId: RopsField<string>;
  readonly spanId: RopsField<string>;
  readonly resumeUrl: RopsField<string>;
  readonly payload: RopsField<Record<string, unknown>>;
  readonly decision: RopsField<string>;
  readonly decisionComment: RopsField<string>;
  readonly decisionPayload: RopsField<Record<string, unknown>>;
  readonly createdAt: RopsField<string>;
  readonly updatedAt: RopsField<string>;
  readonly expiresAt: RopsField<string>;
  readonly decidedAt: RopsField<string>;
  readonly resumedAt: RopsField<string>;
}

/** Build the Interrupt view from an `InterruptRecord` (spec 3.10). */
export function buildInterruptView(rec: InterruptRecord): InterruptView {
  return {
    objectType: 'Interrupt',
    interruptId: evidence('interrupt_id', rec.interrupt_id),
    status: evidence('status', rec.status),
    reason: evidence('reason', rec.reason),
    agentId: evidence('agent_id', rec.agent_id),
    spanId: evidence('span_id', rec.span_id),
    resumeUrl: evidence('resume_url', rec.resume_url),
    payload: evidence('payload', rec.payload),
    decision: evidence('decision', rec.decision),
    decisionComment: evidence('decision_comment', rec.decision_comment),
    decisionPayload: evidence('decision_payload', rec.decision_payload),
    createdAt: evidence('created_at', rec.created_at),
    updatedAt: evidence('updated_at', rec.updated_at),
    expiresAt: evidence('expires_at', rec.expires_at),
    decidedAt: evidence('decided_at', rec.decided_at),
    resumedAt: evidence('resumed_at', rec.resumed_at),
  };
}

/** Build the Interrupt view from a `RuntimeInterruptState` (subset of fields). */
export function buildInterruptViewFromState(state: RuntimeInterruptState): InterruptView {
  return {
    objectType: 'Interrupt',
    interruptId: evidence('interrupt_id', state.interrupt_id),
    status: evidence('status', state.status),
    reason: evidence('reason', state.reason),
    agentId: evidence('agent_id', state.agent_id),
    spanId: evidence('span_id', state.span_id),
    resumeUrl: evidence('resume_url', state.resume_url),
    payload: evidence('payload', state.payload),
    decision: evidence('decision', state.decision),
    decisionComment: evidence('decision_comment', state.decision_comment),
    decisionPayload: evidence('decision_payload', state.decision_payload),
    createdAt: evidence('updated_at', state.updated_at),
    updatedAt: evidence('updated_at', state.updated_at),
    expiresAt: evidence<string>('expires_at', undefined),
    decidedAt: evidence<string>('decided_at', undefined),
    resumedAt: evidence<string>('resumed_at', undefined),
  };
}

export interface BranchView {
  readonly objectType: 'Branch';
  readonly id: RopsField<string>;
  readonly name: RopsField<string>;
  readonly parentBranchId: RopsField<string>;
  readonly forkedFromSequenceNum: RopsField<number>;
  readonly status: RopsField<string>;
  readonly metadata: RopsField<Record<string, unknown>>;
  readonly createdAt: RopsField<string>;
  readonly updatedAt: RopsField<string>;
}

/** Build the Branch view from a `ReplayBranch` (spec 3.11). */
export function buildBranchView(branch: ReplayBranch): BranchView {
  return {
    objectType: 'Branch',
    id: evidence('id', branch.id),
    name: evidence('name', branch.name),
    parentBranchId: evidence('parent_branch_id', branch.parent_branch_id),
    forkedFromSequenceNum: evidence('forked_from_sequence_num', branch.forked_from_sequence_num),
    status: evidence('status', branch.status),
    metadata: evidence('metadata', branch.metadata),
    createdAt: evidence('created_at', branch.created_at),
    updatedAt: evidence('updated_at', branch.updated_at),
  };
}

export interface CheckpointView {
  readonly objectType: 'Checkpoint';
  readonly sequenceNum: RopsField<number>;
  readonly timestamp: RopsField<string>;
  readonly phase: RopsField<string>;
  readonly triggeringEventType: RopsField<string>;
  readonly triggeringEventDescription: RopsField<string>;
  readonly sourceEventId: RopsField<string>;
  readonly branchId: RopsField<string>;
  readonly nodeCount: RopsField<number>;
  readonly edgeCount: RopsField<number>;
}

/** Build the Checkpoint view from a `GraphSnapshot` (spec 3.12). */
export function buildCheckpointView(snapshot: { sequence_num: number; timestamp: string; phase?: string; event_type?: string; event_description?: string; source_event_id?: string; branch_id?: string; nodes: readonly unknown[]; edges: readonly unknown[] }): CheckpointView {
  return {
    objectType: 'Checkpoint',
    sequenceNum: evidence('sequence_num', snapshot.sequence_num),
    timestamp: evidence('timestamp', snapshot.timestamp),
    phase: evidence('phase', snapshot.phase),
    triggeringEventType: evidence('event_type', snapshot.event_type),
    triggeringEventDescription: evidence('event_description', snapshot.event_description),
    sourceEventId: evidence('source_event_id', snapshot.source_event_id),
    branchId: evidence('branch_id', snapshot.branch_id),
    nodeCount: projection('node_count', snapshot.nodes.length),
    edgeCount: projection('edge_count', snapshot.edges.length),
  };
}

export interface MissionView {
  readonly objectType: 'Mission';
  readonly id: RopsField<string>;
  readonly objective: RopsField<string>;
  readonly status: RopsField<string>;
  readonly phase: RopsField<string>;
  readonly ownerId: RopsField<string>;
  readonly createdAt: RopsField<string>;
  readonly updatedAt: RopsField<string>;
  readonly completedAt: RopsField<string>;
  readonly visibility: RopsField<string>;
  readonly isEncrypted: RopsField<boolean>;
  readonly metadata: RopsField<Record<string, unknown>>;
}

/** Build the Mission view from a `Mission` (spec 3.1). */
export function buildMissionView(mission: Mission): MissionView {
  return {
    objectType: 'Mission',
    id: evidence('id', mission.id),
    objective: evidence('objective', mission.objective),
    status: evidence('status', mission.status),
    phase: evidence('phase', mission.phase),
    ownerId: evidence('owner_id', mission.owner_id),
    createdAt: evidence('created_at', mission.created_at),
    updatedAt: evidence('updated_at', mission.updated_at),
    completedAt: evidence('completed_at', mission.completed_at),
    visibility: evidence('visibility', mission.visibility),
    isEncrypted: evidence('is_encrypted', mission.is_encrypted),
    metadata: evidence('metadata', mission.metadata),
  };
}

export interface RuntimeAgentStateView {
  readonly objectType: 'Agent';
  readonly agentId: RopsField<string>;
  readonly name: RopsField<string>;
  readonly role: RopsField<string>;
  readonly team: RopsField<string>;
  readonly status: RopsField<string>;
  readonly statusLabel: RopsField<NodeStatusLabel>;
  readonly confidence: RopsField<number>;
  readonly summary: RopsField<string>;
  readonly currentTaskId: RopsField<string>;
  readonly currentSpanId: RopsField<string>;
  readonly pendingInterruptId: RopsField<string>;
  readonly lastEventSequenceNum: RopsField<number>;
  readonly lastReason: RopsField<string>;
  readonly history: RopsField<number[]>;
  readonly metadata: RopsField<Record<string, unknown>>;
}

/** Build an Agent view from `RuntimeAgentState` (the in-memory replay state). */
export function buildRuntimeAgentStateView(state: RuntimeAgentState): RuntimeAgentStateView {
  return {
    objectType: 'Agent',
    agentId: evidence('agent_id', state.agent_id),
    name: evidence('name', state.name),
    role: evidence('role', state.role),
    team: evidence('team', state.team),
    status: evidence('status', state.status),
    statusLabel: projection('status_label', nodeStatusLabel(state.status)),
    confidence: evidence('confidence', state.confidence),
    summary: evidence('summary', state.summary),
    currentTaskId: evidence('current_task_id', state.current_task_id),
    currentSpanId: evidence('current_span_id', state.current_span_id),
    pendingInterruptId: evidence('pending_interrupt_id', state.pending_interrupt_id),
    lastEventSequenceNum: evidence('last_event_sequence_num', state.last_event_sequence_num),
    lastReason: evidence('last_reason', state.last_reason),
    history: evidence('history', state.history),
    metadata: evidence('metadata', state.metadata),
  };
}

// ---------------------------------------------------------------------------
// L1 headline-metric selection (spec R-4 / section 10.2)
// ---------------------------------------------------------------------------

export interface HeadlineMetric {
  readonly key: string;
  readonly provenance: Provenance;
  readonly value: number;
  readonly display: string;
}

/**
 * Select the single L1 headline metric for an Agent (spec R-4 / 10.2):
 * `duration_ms` when completed, else `error_count` when >0, else none.
 */
export function agentHeadlineMetric(view: AgentView): HeadlineMetric | null {
  if (view.durationMs.value !== undefined && view.status.value === 'completed') {
    return {
      key: 'duration_ms',
      provenance: 'projection',
      value: view.durationMs.value,
      display: formatDurationMs(view.durationMs.value),
    };
  }
  const errCount = view.errorCount.value;
  if (errCount !== undefined && errCount > 0) {
    return {
      key: 'error_count',
      provenance: 'evidence',
      value: errCount,
      display: `${errCount} error${errCount === 1 ? '' : 's'}`,
    };
  }
  return null;
}

/** Select the L1 headline metric for a WorkflowStep (spec 10.2). */
export function stepHeadlineMetric(view: GraphNodeView): HeadlineMetric | null {
  if (view.durationMs.value !== undefined) {
    return {
      key: 'duration_ms',
      provenance: 'projection',
      value: view.durationMs.value,
      display: formatDurationMs(view.durationMs.value),
    };
  }
  const errCount = view.errorCount.value;
  if (errCount !== undefined && errCount > 0) {
    return {
      key: 'error_count',
      provenance: 'evidence',
      value: errCount,
      display: `${errCount} error${errCount === 1 ? '' : 's'}`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formatting helpers (deterministic, locale-independent — spec 7.7)
// ---------------------------------------------------------------------------

/** Format a `duration_ms` with a deterministic unit rule (spec 7.7). */
export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/** Format an ISO timestamp deterministically (spec 7.7). */
export function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}
