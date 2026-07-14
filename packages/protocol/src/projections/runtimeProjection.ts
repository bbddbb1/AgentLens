/** Bump when any projection envelope shape changes. */
export const RUNTIME_PROJECTION_VERSION = 1;

export const NODE_PROJECTION_VERSION = 1;
export const NODE_GENERATED_PROJECTION_VERSION = 1;
export const DETERMINISTIC_PROMPT_VERSION = 'deterministic-v1';
export const NODE_LLM_PROMPT_VERSION = 'node-understanding-v1';

export function isNodeProjectionCacheValid(
  cached: { projection_version?: number; prompt_version?: string },
): boolean {
  return cached.projection_version === NODE_GENERATED_PROJECTION_VERSION
    && cached.prompt_version === NODE_LLM_PROMPT_VERSION;
}

/**
 * Base interface for all disposable runtime projections derived from EventEnvelope + replay.
 * Implementations: Node, Mission/Summary, Graph, Timeline, Policy, HITL (future).
 */
export interface RuntimeProjection {
  projection_version: number;
  mission_id: string;
  branch_id: string;
  sequence_num: number;
  generated_at: string;
}

type SequencedRuntimeRecord = {
  id?: string;
  sequence_num: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

function rawRuntimeTimestamp(event: SequencedRuntimeRecord): bigint | undefined {
  const value = event.metadata?.runtime_timestamp_unix_nano;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
}

/**
 * Replay arrays are event-time ordered. `sequence_num` is a stable evidence
 * cursor, not a sortable ordinal, so ties use the cursor only as a deterministic
 * final key.
 */
export function compareRuntimeEvidence(
  left: SequencedRuntimeRecord,
  right: SequencedRuntimeRecord,
): number {
  const leftRaw = rawRuntimeTimestamp(left);
  const rightRaw = rawRuntimeTimestamp(right);
  if (leftRaw !== undefined && rightRaw !== undefined && leftRaw !== rightRaw) {
    return leftRaw < rightRaw ? -1 : 1;
  }
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (left.id && right.id && left.id !== right.id) return left.id.localeCompare(right.id);
  return left.sequence_num - right.sequence_num;
}

export function orderFrameEvents<T extends SequencedRuntimeRecord>(events: readonly T[]): T[] {
  return [...events].sort(compareRuntimeEvidence);
}

/** Select the chronological evidence prefix ending at an exact stable cursor. */
export function eventsThroughCursor<T extends SequencedRuntimeRecord>(
  events: readonly T[],
  sequenceNum?: number,
): T[] {
  const ordered = orderFrameEvents(events);
  if (sequenceNum === undefined) return ordered;
  const cutoffIndex = ordered.findIndex((event) => event.sequence_num === sequenceNum);
  return cutoffIndex < 0 ? [] : ordered.slice(0, cutoffIndex + 1);
}
