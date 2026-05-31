import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => {
  return {
    mockQuery: vi.fn(),
  };
});

vi.mock('pg', () => {
  class MockPool {
    query = mockQuery;
    connect = vi.fn();
  }
  return {
    Pool: MockPool,
  };
});

import { initializeDatabase } from '../../src/db/postgres.js';

describe('postgres database initialization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs all CREATE TABLE and ALTER TABLE queries during startup', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await initializeDatabase();

    expect(mockQuery).toHaveBeenCalled();
    const calls = mockQuery.mock.calls;
    const queryTexts = calls.map((c) => c[0] as string);

    // Verify all key schema tables are included in initialization
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS missions'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS ingest_batches'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS branch_executor_specs'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS branch_sandbox_jobs'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS branch_sandbox_logs'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS interrupts'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS mission_replay_branches'))).toBe(true);
    expect(queryTexts.some((q) => q.includes('CREATE TABLE IF NOT EXISTS mission_events'))).toBe(true);
  });
});
