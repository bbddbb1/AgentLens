import { describe, expect, it, vi } from 'vitest';
import { missionStore } from '../../src/services/missionStore.js';

vi.mock('../../src/db/postgres.js', () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

describe('Audit Integrity Verification', () => {
  it('returns a valid stub report', async () => {
    // mock getMission to return something if needed, but verifyMissionIntegrity doesn't even call getMission in its stub implementation
    const report = await missionStore.verifyMissionIntegrity('550e8400-e29b-41d4-a716-446655440000');
    expect(report.is_valid).toBe(true);
    expect(report.branch_reports).toHaveLength(1);
    expect(report.branch_reports[0].is_valid).toBe(true);
  });
});
