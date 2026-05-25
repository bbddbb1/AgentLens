import { realtimeManager } from './missions.js';

export async function publishMissionEvent(missionId: string, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  await realtimeManager.publish(missionId, {
    type,
    mission_id: missionId,
    ...payload,
  });
}
