import {
  createRuntimeExplanationUpdatedV1,
  serializeRuntimeExplanationV1,
  type RuntimeExplanationProjection,
} from '@agentlens/protocol';
import { realtimeManager } from './missions.js';

export async function publishMissionEvent(missionId: string, type: string, payload: Record<string, unknown> = {}): Promise<void> {
  await realtimeManager.publish(missionId, {
    type,
    mission_id: missionId,
    ...payload,
  });
}

/** One validated producer for the frozen RuntimeExplanation realtime contract. */
export async function publishRuntimeExplanationEvent(
  missionId: string,
  explanation: RuntimeExplanationProjection,
): Promise<void> {
  const runtimeExplanation = serializeRuntimeExplanationV1(explanation);
  const message = createRuntimeExplanationUpdatedV1({
    type: 'runtime.explanation.updated',
    mission_id: missionId,
    branch_id: runtimeExplanation.branch_id,
    projection_version: runtimeExplanation.projection_version,
    runtime_explanation: runtimeExplanation,
  });
  await realtimeManager.publish(missionId, message);
}
