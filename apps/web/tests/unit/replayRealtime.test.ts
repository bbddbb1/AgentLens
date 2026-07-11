import { describe, expect, it } from 'vitest';
import { shouldReloadReplayForRealtimeMessage } from '../../src/lib/replayRealtime.js';

describe('replay realtime reload handling', () => {
  it('reloads only the matching branch for replay.updated', () => {
    expect(shouldReloadReplayForRealtimeMessage({ type: 'replay.updated', mission_id: 'm1', branch_id: 'main' }, 'main')).toBe(true);
    expect(shouldReloadReplayForRealtimeMessage({ type: 'replay.updated', mission_id: 'm1', branch_id: 'other' }, 'main')).toBe(false);
  });

  it('keeps existing interrupt reload behavior and ignores graph.snapshot.created', () => {
    expect(shouldReloadReplayForRealtimeMessage({ type: 'interrupt.created', interrupt: { branch_id: 'main' } }, 'main')).toBe(true);
    expect(shouldReloadReplayForRealtimeMessage({ type: 'graph.snapshot.created', snapshot: { branch_id: 'main' } }, 'main')).toBe(false);
  });
});
