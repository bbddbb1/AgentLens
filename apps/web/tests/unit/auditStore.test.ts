import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@agentlens/protocol';

const apiMocks = vi.hoisted(() => ({
  events: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { audit: { events: apiMocks.events } },
}));

import { useAuditStore } from '@/stores/auditStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function envelope(id: string, sequenceNum: number): EventEnvelope {
  return {
    id,
    mission_id: 'mission-1',
    branch_id: 'main',
    sequence_num: sequenceNum,
    branch_sequence_num: sequenceNum,
    event_type: 'span.completed',
    timestamp: '2026-07-31T00:00:00.000Z',
    payload: {},
    metadata: {},
  };
}

describe('auditStore frame authority', () => {
  beforeEach(() => {
    useAuditStore.getState().clear();
    apiMocks.events.mockReset();
  });

  it('rejects an older response that resolves after a newer frame', async () => {
    const first = deferred<{ events: EventEnvelope[] }>();
    const second = deferred<{ events: EventEnvelope[] }>();
    apiMocks.events.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    useAuditStore.getState().load('mission-1', 'main', 4);
    useAuditStore.getState().load('mission-1', 'main', 9);

    second.resolve({ events: [envelope('event-9', 9)] });
    await vi.waitFor(() => expect(useAuditStore.getState().loadedFor?.sequenceNum).toBe(9));

    first.resolve({ events: [envelope('event-4', 4)] });
    await Promise.resolve();
    await Promise.resolve();

    expect(useAuditStore.getState().events.map((event) => event.id)).toEqual(['event-9']);
    expect(useAuditStore.getState().loadedFor).toEqual({
      missionId: 'mission-1',
      branchId: 'main',
      sequenceNum: 9,
    });
  });

  it('invalidates an in-flight request when evidence is cleared', async () => {
    const pending = deferred<{ events: EventEnvelope[] }>();
    apiMocks.events.mockReturnValueOnce(pending.promise);

    useAuditStore.getState().load('mission-1', 'main', 3);
    useAuditStore.getState().clear();
    pending.resolve({ events: [envelope('event-3', 3)] });
    await Promise.resolve();
    await Promise.resolve();

    expect(useAuditStore.getState().events).toEqual([]);
    expect(useAuditStore.getState().loadedFor).toBeNull();
    expect(useAuditStore.getState().isLoading).toBe(false);
  });

  it('keeps failure explicit for the requested frame', async () => {
    apiMocks.events.mockRejectedValueOnce(new Error('audit unavailable'));

    useAuditStore.getState().load('mission-1', 'main', 12);
    await vi.waitFor(() => expect(useAuditStore.getState().isLoading).toBe(false));

    expect(useAuditStore.getState().events).toEqual([]);
    expect(useAuditStore.getState().loadedFor).toBeNull();
    expect(useAuditStore.getState().error).toBe('audit unavailable');
  });

  it('reloads tuple A after tuple B clears the cache and then fails', async () => {
    apiMocks.events.mockResolvedValueOnce({
      events: [envelope('event-a1', 4)],
    });
    useAuditStore.getState().load('mission-1', 'main', 4);
    await vi.waitFor(() => expect(useAuditStore.getState().loadedFor?.sequenceNum).toBe(4));

    apiMocks.events.mockRejectedValueOnce(new Error('frame B unavailable'));
    useAuditStore.getState().load('mission-1', 'main', 8);
    await vi.waitFor(() => expect(useAuditStore.getState().error).toBe('frame B unavailable'));
    expect(useAuditStore.getState().events).toEqual([]);
    expect(useAuditStore.getState().loadedFor).toBeNull();

    apiMocks.events.mockResolvedValueOnce({
      events: [envelope('event-a2', 4)],
    });
    useAuditStore.getState().load('mission-1', 'main', 4);
    await vi.waitFor(() => expect(useAuditStore.getState().events[0]?.id).toBe('event-a2'));

    expect(apiMocks.events).toHaveBeenCalledTimes(3);
    expect(useAuditStore.getState().loadedFor).toEqual({
      missionId: 'mission-1',
      branchId: 'main',
      sequenceNum: 4,
    });
  });
});
