import type { ReplayUpdatedMissionRealtimeMessage } from '@agentlens/protocol';

type LegacyReplayReloadMessage = {
  type: string;
  mission_id?: string;
  branch_id?: string;
  branch?: { id: string };
  snapshot?: { branch_id: string };
  interrupt?: { branch_id: string };
  job?: { branch_id: string };
};

const LEGACY_RELOAD_TYPES = new Set([
  'interrupt.created', 'interrupt.decided', 'interrupt.resumed',
  'branch.sandbox.queued', 'branch.sandbox.started', 'branch.sandbox.completed', 'branch.sandbox.failed', 'branch.sandbox.timeout',
]);

/** Returns whether a delivered realtime message warrants reloading this branch. */
export function shouldReloadReplayForRealtimeMessage(
  message: LegacyReplayReloadMessage | ReplayUpdatedMissionRealtimeMessage,
  currentBranchId: string | null,
): boolean {
  if (message.type === 'replay.updated') {
    return !currentBranchId || message.branch_id === currentBranchId;
  }
  if (!LEGACY_RELOAD_TYPES.has(message.type)) return false;
  const legacyMessage = message as LegacyReplayReloadMessage;
  const branchId = legacyMessage.branch?.id ?? legacyMessage.snapshot?.branch_id ?? legacyMessage.interrupt?.branch_id ?? legacyMessage.job?.branch_id;
  return !branchId || branchId === currentBranchId;
}
