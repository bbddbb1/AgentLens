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

function evidenceLogicalId(event: SequencedRuntimeRecord): string | undefined {
  const value = event.metadata?.evidence_logical_id;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Materialize exactly the evidence revisions known through an immutable
 * admission cursor, then order the selected frame by source time.
 */
export function eventsThroughCursor<T extends SequencedRuntimeRecord>(
  events: readonly T[],
  sequenceNum?: number,
): T[] {
  const admitted = sequenceNum === undefined
    ? [...events]
    : events.filter((event) => event.sequence_num <= sequenceNum);
  const latestAdmissionByLogicalId = new Map<string, number>();
  for (const event of admitted) {
    const logicalId = evidenceLogicalId(event);
    if (!logicalId) continue;
    const current = latestAdmissionByLogicalId.get(logicalId);
    if (current === undefined || event.sequence_num > current) {
      latestAdmissionByLogicalId.set(logicalId, event.sequence_num);
    }
  }

  return orderFrameEvents(admitted.filter((event) => {
    const logicalId = evidenceLogicalId(event);
    return !logicalId || latestAdmissionByLogicalId.get(logicalId) === event.sequence_num;
  }));
}
