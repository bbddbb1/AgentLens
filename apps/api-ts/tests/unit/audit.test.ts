import { describe, expect, it, vi } from 'vitest';
import { missionStore } from '../../src/services/missionStore.js';

vi.mock('../../src/db/postgres.js', () => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
}));

describe('Audit Integrity Verification', () => {
  it('returns an unsupported, unevaluated report', async () => {
    const report = await missionStore.verifyMissionIntegrity('550e8400-e29b-41d4-a716-446655440000');
    expect(report.is_valid).toBeNull();
    expect(report.verification_status).toBe('unsupported');
    expect(report.branch_reports).toHaveLength(1);
    expect(report.branch_reports[0].is_valid).toBeNull();
    expect(report.branch_reports[0].verification_status).toBe('unsupported');
  });
});
