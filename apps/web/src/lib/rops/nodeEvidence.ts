/**
 * Runtime evidence correlation for a graph node (ROPS evidence layer).
 *
 * This module is a PURE, read-only reducer over the already-fetched
 * `EventEnvelope` stream. It correlates a selected `GraphNode` to the
 * envelopes that share its `span_id` and extracts raw runtime evidence
 * verbatim from envelope payloads / error blocks / node metadata.
 *
 * It is NOT a runtime object model and NOT a presentation layer:
 *   - It does not import `RopsField`, `ProvenanceTag`, or any React code.
 *   - It does not pack, label, format, truncate, or order values for display.
 *   - It does not infer, classify, summarize, or reinterpret runtime behavior.
 *   - It never invents a value the runtime did not emit.
 *
 * Presentation components (the ROPS inspector + hover) own the decision of
 * which of these raw values to render, in what order, and how to pack them as
 * `RopsField` Evidence. See `TOOL_EVIDENCE_ORDER` / `TASK_EVIDENCE_ORDER` in
 * `RopsInspector.tsx`.
 */

import type {
  EventEnvelope,
  GraphNode,
  ProducedOutput,
  RuntimeNodeProjection,
} from '@agentlens/protocol';

/** Event types that carry tool-call I/O evidence on their payload. */
const TOOL_CALL_EVENT_TYPES = new Set([
  'tool.called',
  'tool.call',
  'agent.tool.call',
]);

/** Payload key aliases for each evidence field, checked in priority order. */
const TOOL_NAME_KEYS = ['gen_ai.tool.name', 'tool_name', 'name'] as const;
const TOOL_INPUT_KEYS = ['gen_ai.tool.input', 'tool_input', 'input'] as const;
const TOOL_OUTPUT_KEYS = ['gen_ai.tool.output', 'tool_output', 'output'] as const;
const TOOL_STATUS_KEYS = ['gen_ai.tool.status', 'tool_status', 'status'] as const;
const SEARCH_QUERY_KEYS = ['search.query', 'search_query', 'query'] as const;
const RESULT_COUNT_KEYS = ['search.result_count', 'result_count', 'resultCount'] as const;
const RETRIEVAL_BACKEND_KEYS = ['retrieval.backend', 'retrieval_backend', 'retrievalBackend'] as const;

/** Recorded runtime evidence correlated to a node. Values are verbatim or unset. */
export interface NodeCorrelatedEvidence {
  /** Envelopes whose span_id matches the node's source span, in sequence order. */
  readonly envelopes: readonly EventEnvelope[];
  /** The tool-call envelope (carries tool I/O), if present. */
  readonly toolCallEnvelope: EventEnvelope | null;
  /** The span.failed envelope (carries failure reason), if present. */
  readonly failureEnvelope: EventEnvelope | null;
  /** Recorded values pulled verbatim from envelope payload / node metadata. */
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly toolOutput?: unknown;
  readonly toolStatus?: string;
  readonly searchQuery?: string;
  readonly resultCount?: number;
  readonly retrievalBackend?: string;
  readonly failureReason?: string;
  readonly failureCause?: string;
  /** Pass-through of `projection.facts.produced_outputs` when supplied. */
  readonly producedOutputs?: ProducedOutput[];
}

/**
 * Correlate `envelopes` to `node` by span_id and extract recorded evidence.
 *
 * The correlation key is the node's source span id (every node sets
 * `source_span_id` / `evidence_span_id` / `span_id` to its span at projection
 * time, see `apps/api-ts/src/services/runtime/projection.ts:278-291`). Tool
 * I/O lives on a span-event envelope sharing that span id; failure reason
 * lives on the `span.failed` envelope sharing that span id.
 *
 * Deterministic, side-effect-free, and tolerant of partial envelopes.
 */
export function collectNodeEvidence(
  node: GraphNode,
  envelopes: readonly EventEnvelope[],
  projection?: RuntimeNodeProjection | null,
): NodeCorrelatedEvidence {
  const spanId = node.source_span_id ?? node.evidence_span_id ?? node.span_id;
  const metadata = (node.metadata ?? {}) as Record<string, unknown>;

  const matched = spanId
    ? envelopes
        .filter((e) => e.span_id === spanId)
        .sort((a, b) => (a.sequence_num ?? 0) - (b.sequence_num ?? 0))
    : [];

  const toolCallEnvelope = selectRichestToolCallEnvelope(matched);
  const failureEnvelope = matched.find((e) => e.event_type === 'span.failed') ?? null;

  const toolPayload = (toolCallEnvelope?.payload ?? {}) as Record<string, unknown>;
  const failurePayload = (failureEnvelope?.payload ?? {}) as Record<string, unknown>;
  const error = failureEnvelope?.error;

  const toolName = firstString(toolPayload, TOOL_NAME_KEYS) ?? firstString(metadata, TOOL_NAME_KEYS);
  const toolStatus = firstString(toolPayload, TOOL_STATUS_KEYS) ?? firstString(metadata, TOOL_STATUS_KEYS);
  const toolInput = firstValue(toolPayload, TOOL_INPUT_KEYS) ?? firstValue(metadata, TOOL_INPUT_KEYS);
  const toolOutput = firstValue(toolPayload, TOOL_OUTPUT_KEYS) ?? firstValue(metadata, TOOL_OUTPUT_KEYS);

  const searchQuery = firstString(toolPayload, SEARCH_QUERY_KEYS);
  const resultCountRaw = firstValue(toolPayload, RESULT_COUNT_KEYS);
  const resultCount = toNumber(resultCountRaw);
  const retrievalBackend = firstString(toolPayload, RETRIEVAL_BACKEND_KEYS);

  // Failure reason: prefer the structured ErrorAttribution, then the verbatim
  // status_message carried on the failed span's payload. All Evidence.
  const failureReason =
    error?.original_error ??
    error?.recovery_action ??
    (typeof failurePayload.status_message === 'string' ? failurePayload.status_message : undefined);
  const failureCause = error?.cause;

  const producedOutputs = projection?.facts?.produced_outputs;

  return {
    envelopes: matched,
    toolCallEnvelope,
    failureEnvelope,
    toolName,
    toolInput,
    toolOutput,
    toolStatus,
    searchQuery,
    resultCount,
    retrievalBackend,
    failureReason,
    failureCause,
    producedOutputs,
  };
}

/** Prefer the tool.called envelope that carries the most I/O evidence. */
function selectRichestToolCallEnvelope(
  envelopes: readonly EventEnvelope[],
): EventEnvelope | null {
  const candidates = envelopes.filter((e) => TOOL_CALL_EVENT_TYPES.has(e.event_type));
  if (candidates.length === 0) return null;

  return candidates.reduce<EventEnvelope | null>((best, envelope) => {
    if (!best) return envelope;
    return toolCallEvidenceScore(envelope) > toolCallEvidenceScore(best) ? envelope : best;
  }, null);
}

function toolCallEvidenceScore(envelope: EventEnvelope): number {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  let score = 0;
  if (firstValue(payload, TOOL_INPUT_KEYS) !== undefined) score += 2;
  if (firstValue(payload, TOOL_OUTPUT_KEYS) !== undefined) score += 2;
  if (firstString(payload, TOOL_NAME_KEYS)) score += 1;
  if (firstString(payload, TOOL_STATUS_KEYS)) score += 1;
  if (envelope.source_event_id) score += 1;
  return score;
}

/** First string value found under any of `keys` in `bag`; undefined otherwise. */
function firstString(
  bag: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const k of keys) {
    const v = bag[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' || typeof v === 'boolean') {
      const s = String(v);
      if (s.length > 0) return s;
    }
  }
  return undefined;
}

/** First value (any type) found under any of `keys` in `bag`; undefined otherwise. */
function firstValue(
  bag: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const k of keys) {
    if (bag[k] !== undefined && bag[k] !== null) return bag[k];
  }
  return undefined;
}

/** Coerce a raw value to a finite number; undefined when not numeric. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
