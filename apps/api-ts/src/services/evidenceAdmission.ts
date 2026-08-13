import type { PoolClient } from 'pg';

/** Allocate the mission-local immutable R0-A evidence admission cursor. */
export async function allocateEvidenceAdmission(client: PoolClient, missionId: string): Promise<number> {
  const result = await client.query(
    `INSERT INTO evidence_admission_counters (mission_id, next_seq)
     VALUES ($1, 1)
     ON CONFLICT (mission_id) DO UPDATE
     SET next_seq = evidence_admission_counters.next_seq + 1
     WHERE evidence_admission_counters.next_seq < 2147483647
     RETURNING next_seq`,
    [missionId],
  );
  const value = Number(result.rows[0]?.next_seq);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Evidence admission cursor exhausted for mission ${missionId}`);
  }
  return value;
}
