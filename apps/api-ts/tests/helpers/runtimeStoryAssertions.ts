import { expect } from 'vitest';
import type { RuntimeExplanationProjection, RuntimeSummary } from '@agentlens/protocol';

export function expectSharedRuntimeFrame(
  summary: RuntimeSummary,
  explanation: RuntimeExplanationProjection,
): void {
  expect(summary.mission_id).toBe(explanation.mission_id);
  expect(summary.branch_id).toBe(explanation.branch_id);
  expect(summary.sequence_num).toBe(explanation.as_of_sequence_num);
}

export function expectNoSecretLeak(value: unknown, secret: string): void {
  expect(JSON.stringify(value)).not.toContain(secret);
}

export function expectActivityIds(
  explanation: RuntimeExplanationProjection,
  ids: string[],
): void {
  expect(explanation.activities.map((activity) => activity.id)).toEqual(ids);
}
