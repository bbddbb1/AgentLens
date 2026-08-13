import {
  RUNTIME_EXPLANATION_VERSION,
  RuntimeExplanationUpdatedV1Schema,
  RuntimeExplanationV1Schema,
  type RuntimeExplanationV1,
} from '@agentlens/protocol';

export interface ExpectedRuntimeExplanationFrame {
  missionId: string;
  branchId: string;
  sequenceNum: number;
}

/** Shared fail-closed decoder for the frozen REST and realtime payload. */
export function decodeRuntimeExplanationV1(input: unknown): RuntimeExplanationV1 {
  return RuntimeExplanationV1Schema.parse(input);
}

export function runtimeExplanationFromRealtime(
  input: unknown,
  expected: ExpectedRuntimeExplanationFrame,
): RuntimeExplanationV1 | null {
  const decoded = RuntimeExplanationUpdatedV1Schema.safeParse(input);
  if (!decoded.success) return null;
  if (decoded.data.projection_version !== RUNTIME_EXPLANATION_VERSION) return null;
  if (decoded.data.mission_id !== expected.missionId) return null;
  if (decoded.data.branch_id !== expected.branchId) return null;
  if (decoded.data.runtime_explanation.frame.sequence_num !== expected.sequenceNum) return null;
  return decoded.data.runtime_explanation;
}
