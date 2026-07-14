import { eventsThroughCursor, orderFrameEvents } from '@agentlens/protocol';
import type { EventEnvelope, GraphSnapshot, MissionEventRecord } from '@agentlens/protocol';

/** Snapshot at a replay frame index (clamped). */
export function getSnapshotAtFrame(
  snapshots: readonly GraphSnapshot[],
  frameIndex: number,
): GraphSnapshot | null {
  if (snapshots.length === 0) return null;
  const frame = Math.max(0, Math.min(frameIndex, snapshots.length - 1));
  return snapshots[frame] ?? null;
}

/**
 * Event sequence number inclusive through a replay frame.
 * Frames index **snapshots** (span-start checkpoints), not the events array.
 */
export function sequenceNumThroughFrame(
  snapshots: readonly GraphSnapshot[],
  events: readonly MissionEventRecord[],
  frameIndex: number,
): number | undefined {
  if (events.length === 0) return undefined;
  if (snapshots.length === 0) {
    const idx = Math.max(0, Math.min(frameIndex, events.length - 1));
    return events[idx]?.sequence_num;
  }

  const frame = Math.max(0, Math.min(frameIndex, snapshots.length - 1));
  if (frame === snapshots.length - 1) {
    return events[events.length - 1]?.sequence_num;
  }

  const snapshot = snapshots[frame];
  const spanStartSeq = snapshot.source_event_id
    ? events.find((event) => event.id === snapshot.source_event_id)?.sequence_num
    : undefined;
  const linkedSeq =
    snapshot.source_event_sequence_num !== undefined &&
    snapshot.source_event_sequence_num !== snapshot.sequence_num
      ? snapshot.source_event_sequence_num
      : spanStartSeq;

  if (linkedSeq !== undefined) return lastSequenceAtSourceTimestamp(events, linkedSeq);
  return lastSequenceThroughTimestamp(events, snapshot.timestamp, linkedSeq);
}

/** Representative mission event for timeline / audit context at a frame. */
export function eventAtFrame(
  snapshots: readonly GraphSnapshot[],
  events: readonly MissionEventRecord[],
  frameIndex: number,
): MissionEventRecord | null {
  if (events.length === 0) return null;
  if (snapshots.length === 0) {
    const idx = Math.max(0, Math.min(frameIndex, events.length - 1));
    return events[idx] ?? null;
  }

  const frame = Math.max(0, Math.min(frameIndex, snapshots.length - 1));
  if (frame === snapshots.length - 1) {
    return events[events.length - 1] ?? null;
  }

  const snapshot = snapshots[frame];
  if (snapshot.source_event_id) {
    const spanStart = events.find((event) => event.id === snapshot.source_event_id);
    if (spanStart) return spanStart;
  }

  return lastEventThroughTimestamp(events, snapshot.timestamp) ?? events[0] ?? null;
}

/** Map a mission event id to the snapshot frame that best contains it. */
export function findFrameForEvent(
  snapshots: readonly GraphSnapshot[],
  events: readonly MissionEventRecord[],
  eventId: string,
): number | null {
  const event = events.find((entry) => entry.id === eventId);
  if (!event) return null;
  if (snapshots.length === 0) {
    const idx = events.findIndex((entry) => entry.id === eventId);
    return idx >= 0 ? idx : null;
  }

  const directIdx = snapshots.findIndex((snapshot) => snapshot.source_event_id === event.id);
  if (directIdx >= 0) return directIdx;

  const eventMs = Date.parse(event.timestamp);
  if (Number.isNaN(eventMs)) return snapshots.length - 1;

  let bestFrame = 0;
  for (let i = 0; i < snapshots.length; i++) {
    const snapMs = Date.parse(snapshots[i].timestamp);
    if (!Number.isNaN(snapMs) && snapMs <= eventMs) {
      bestFrame = i;
    }
  }
  return bestFrame;
}

function lastSequenceThroughTimestamp(
  events: readonly MissionEventRecord[],
  timestamp: string,
  floorSeq?: number,
): number | undefined {
  const snapshotMs = Date.parse(timestamp);
  let lastSeq = floorSeq;

  for (const event of orderFrameEvents(events)) {
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isNaN(snapshotMs) && !Number.isNaN(eventMs) && eventMs <= snapshotMs) {
      lastSeq = event.sequence_num;
    }
  }

  return lastSeq ?? events[0]?.sequence_num;
}

function lastSequenceAtSourceTimestamp(
  events: readonly MissionEventRecord[],
  sourceSequenceNum: number,
): number {
  const ordered = orderFrameEvents(events);
  const source = ordered.find((event) => event.sequence_num === sourceSequenceNum);
  const sourceRaw = source?.metadata?.runtime_timestamp_unix_nano;
  if (typeof sourceRaw !== 'string') return sourceSequenceNum;
  let last = sourceSequenceNum;
  for (const event of ordered) {
    const eventRaw = event.metadata?.runtime_timestamp_unix_nano;
    if (typeof eventRaw !== 'string') continue;
    if (BigInt(eventRaw) > BigInt(sourceRaw)) break;
    last = event.sequence_num;
  }
  return last;
}

function lastEventThroughTimestamp(
  events: readonly MissionEventRecord[],
  timestamp: string,
): MissionEventRecord | null {
  const snapshotMs = Date.parse(timestamp);
  if (Number.isNaN(snapshotMs)) return null;

  let best: MissionEventRecord | null = null;
  for (const event of orderFrameEvents(events)) {
    const eventMs = Date.parse(event.timestamp);
    if (!Number.isNaN(eventMs) && eventMs <= snapshotMs) {
      best = event;
    }
  }
  return best;
}

/** Mission events visible at or before a replay frame. */
export function eventsThroughFrame(
  snapshots: readonly GraphSnapshot[],
  events: readonly MissionEventRecord[],
  frameIndex: number,
): MissionEventRecord[] {
  const cutoff = sequenceNumThroughFrame(snapshots, events, frameIndex);
  if (cutoff === undefined) return [...events];
  return eventsThroughCursor(events, cutoff);
}

function envelopeEvidenceScore(envelope: EventEnvelope): number {
  let score = 0;
  if (envelope.model?.model_name) score += 4;
  if (envelope.model?.provider) score += 2;
  if (envelope.model?.tokens_input !== undefined) score += 2;
  if (envelope.model?.tokens_output !== undefined) score += 2;
  if (envelope.origin_framework) score += 3;
  if (envelope.actor_type) score += 1;
  if (envelope.actor_id) score += 1;
  if (envelope.content_hash) score += 1;
  if (envelope.source_event_id) score += 2;
  const payloadKeys = Object.keys(envelope.payload ?? {});
  score += Math.min(payloadKeys.length, 6);
  if (envelope.event_type === 'tool.called' || envelope.event_type === 'tool.call') {
    score += 1;
  }
  return score;
}

/** Pick the richest audit envelope for a graph node's span (provenance / L3). */
export function selectEnvelopeForNode(
  node: { source_span_id?: string; evidence_span_id?: string; span_id?: string; id: string },
  envelopes: readonly EventEnvelope[],
): EventEnvelope | null {
  const spanId = node.source_span_id ?? node.evidence_span_id ?? node.span_id ?? node.id;
  const matched = orderFrameEvents(envelopes.filter((envelope) => envelope.span_id === spanId));

  if (matched.length === 0) return null;

  return matched.reduce<EventEnvelope | null>((best, envelope) => {
    if (!best) return envelope;
    return envelopeEvidenceScore(envelope) > envelopeEvidenceScore(best) ? envelope : best;
  }, null);
}
