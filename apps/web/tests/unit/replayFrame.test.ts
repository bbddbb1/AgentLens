import { describe, expect, it } from 'vitest';
import type { GraphSnapshot, MissionEventRecord } from '@agentlens/protocol';
import {
  eventAtFrame,
  eventsThroughFrame,
  findFrameForEvent,
  selectEnvelopeForNode,
  sequenceNumThroughFrame,
} from '../../src/lib/replayFrame.js';

function event(
  id: string,
  sequenceNum: number,
  timestamp: string,
  extra: Partial<MissionEventRecord> = {},
): MissionEventRecord {
  return {
    id,
    mission_id: 'm1',
    branch_id: 'main',
    sequence_num: sequenceNum,
    branch_sequence_num: sequenceNum,
    event_type: extra.event_type ?? 'task.started',
    timestamp,
    payload: extra.payload ?? {},
    metadata: {},
    span_id: extra.span_id,
    ...extra,
  };
}

const snapshots: GraphSnapshot[] = [
  {
    id: 'snap-0',
    mission_id: 'm1',
    sequence_num: 0,
    timestamp: '2026-06-27T12:53:10.000Z',
    nodes: [],
    edges: [],
    source_event_id: 'span-mission',
    source_event_sequence_num: 0,
  },
  {
    id: 'snap-1',
    mission_id: 'm1',
    sequence_num: 1,
    timestamp: '2026-06-27T12:53:18.000Z',
    nodes: [],
    edges: [],
    source_event_id: 'span-llm',
    source_event_sequence_num: 1,
  },
  {
    id: 'snap-2',
    mission_id: 'm1',
    sequence_num: 2,
    timestamp: '2026-06-27T12:53:30.000Z',
    nodes: [],
    edges: [],
    source_event_id: 'span-report',
    source_event_sequence_num: 2,
  },
];

const events: MissionEventRecord[] = [
  event('span-mission', 0, '2026-06-27T12:53:10.000Z', { event_type: 'mission.created' }),
  event('span-llm', 3, '2026-06-27T12:53:18.000Z', { span_id: 'span-llm' }),
  event('span-llm-event-0', 4, '2026-06-27T12:53:20.000Z', {
    event_type: 'tool.called',
    span_id: 'span-llm',
    payload: { 'gen_ai.tool.name': 'search' },
  }),
  event('span-report', 8, '2026-06-27T12:53:30.000Z', { span_id: 'span-report', event_type: 'task.started' }),
  event('span-report-end', 9, '2026-06-27T12:53:35.000Z', { span_id: 'span-report', event_type: 'span.completed' }),
];

describe('sequenceNumThroughFrame', () => {
  it('uses full event stream on the last snapshot frame', () => {
    expect(sequenceNumThroughFrame(snapshots, events, 2)).toBe(9);
  });

  it('cuts off at the span-start checkpoint for earlier frames', () => {
    expect(sequenceNumThroughFrame(snapshots, events, 1)).toBeGreaterThanOrEqual(3);
    expect(sequenceNumThroughFrame(snapshots, events, 0)).toBe(0);
  });

  it('includes every event at the exact source nanosecond without admitting a later same-millisecond event', () => {
    const sameTimeEvents = [
      event('a-root', 900, '2026-06-27T12:53:10.000Z', { metadata: { runtime_timestamp_unix_nano: '1000000000' } }),
      event('b-lifecycle', 100, '2026-06-27T12:53:10.000Z', { metadata: { runtime_timestamp_unix_nano: '1000000000' } }),
      event('c-future', 500, '2026-06-27T12:53:10.000Z', { metadata: { runtime_timestamp_unix_nano: '1000000001' } }),
    ];
    const sameTimeSnapshots = [{
      ...snapshots[0],
      sequence_num: 100,
      source_event_id: 'b-lifecycle',
      source_event_sequence_num: 100,
    }];

    expect(sequenceNumThroughFrame([...sameTimeSnapshots, snapshots[1]], sameTimeEvents, 0)).toBe(100);
    expect(eventsThroughFrame([...sameTimeSnapshots, snapshots[1]], sameTimeEvents, 0).map((entry) => entry.id))
      .toEqual(['a-root', 'b-lifecycle']);
  });
});

describe('eventAtFrame', () => {
  it('returns the span-start event for a snapshot frame', () => {
    expect(eventAtFrame(snapshots, events, 1)?.id).toBe('span-llm');
  });

  it('returns the latest event on the last frame', () => {
    expect(eventAtFrame(snapshots, events, 2)?.id).toBe('span-report-end');
  });
});

describe('eventsThroughFrame', () => {
  it('includes all events through the frame cutoff', () => {
    const visible = eventsThroughFrame(snapshots, events, 1);
    expect(visible.map((e) => e.id)).toEqual(['span-mission', 'span-llm']);
  });
});

describe('findFrameForEvent', () => {
  it('maps a span-start event to its snapshot frame', () => {
    expect(findFrameForEvent(snapshots, events, 'span-llm')).toBe(1);
  });
});

describe('selectEnvelopeForNode', () => {
  it('prefers the envelope with model provenance on the node span', () => {
    const envelopes = [
      {
        id: 'span-llm',
        sequence_num: 3,
        event_type: 'task.started',
        span_id: 'span-llm',
        payload: {},
      },
      {
        id: 'span-llm-event-0',
        sequence_num: 4,
        event_type: 'tool.called',
        span_id: 'span-llm',
        payload: { 'gen_ai.request.model': 'diagnosis-v1' },
        model: {
          provider: 'openai',
          model_name: 'diagnosis-v1',
          tokens_input: 100,
          tokens_output: 50,
        },
        origin_framework: 'langgraph',
        source_event_id: 'tool.called',
      },
    ] as import('@agentlens/protocol').EventEnvelope[];

    const picked = selectEnvelopeForNode(
      { id: 'span-llm', span_id: 'span-llm', source_span_id: 'span-llm' },
      envelopes,
    );

    expect(picked?.id).toBe('span-llm-event-0');
    expect(picked?.model?.model_name).toBe('diagnosis-v1');
  });
});
