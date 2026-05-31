import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// -- Mock PG Pool --
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../../src/db/postgres.js', () => ({
  pool: {
    connect: () => Promise.resolve(mockClient),
    query: vi.fn(),
  },
}));

import { missionStore } from '../../src/services/missionStore.js';

// -- Helpers --
function deterministicStringify(obj: any): string {
  if (obj === undefined) return '';
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj) ?? 'null';
  }
  if (Array.isArray(obj)) {
    return '[' + obj.filter(item => item !== undefined).map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const props = keys
    .filter(key => obj[key] !== undefined)
    .map(key => JSON.stringify(key) + ':' + deterministicStringify(obj[key]));
  return '{' + props.join(',') + '}';
}

function calculateHash(event: any, previousHash: string | null): string {
  const hashInput = deterministicStringify({
    mission_id: event.mission_id,
    branch_id: event.branch_id,
    sequence_num: event.sequence_num,
    branch_sequence_num: event.branch_sequence_num,
    event_type: event.event_type,
    timestamp: event.timestamp,
    agent_id: event.agent_id ?? null,
    payload: event.payload ?? {},
    metadata: event.metadata ?? {},
    previous_hash: previousHash
  });
  return createHash('sha256').update(hashInput).digest('hex');
}

function createMockEvent(overrides: any = {}) {
  const base = {
    id: overrides.id ?? 'e1',
    mission_id: '550e8400-e29b-41d4-a716-446655440000',
    branch_id: overrides.branch_id ?? 'main',
    sequence_num: overrides.sequence_num ?? 0,
    branch_sequence_num: overrides.branch_sequence_num ?? 0,
    event_type: overrides.event_type ?? 'span.started',
    timestamp: overrides.timestamp ?? '2026-05-31T00:00:00.000Z',
    agent_id: overrides.agent_id ?? 'agent1',
    payload: overrides.payload ?? { foo: 'bar' },
    metadata: overrides.metadata ?? {},
  };
  return base;
}

describe('Audit Integrity Verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('proves a correct hash chain is fully valid', async () => {
    const e0 = createMockEvent({ id: 'e0', sequence_num: 0, branch_sequence_num: 0 });
    const h0 = calculateHash(e0, null);
    (e0 as any).content_hash = h0;
    (e0 as any).previous_hash = null;

    const e1 = createMockEvent({ id: 'e1', sequence_num: 1, branch_sequence_num: 1 });
    const h1 = calculateHash(e1, h0);
    (e1 as any).content_hash = h1;
    (e1 as any).previous_hash = h0;

    mockClient.query.mockResolvedValueOnce({
      rows: [e0, e1],
      rowCount: 2,
    });

    const report = await missionStore.verifyMissionIntegrity('550e8400-e29b-41d4-a716-446655440000');

    expect(report.is_valid).toBe(true);
    expect(report.branch_reports).toHaveLength(1);
    expect(report.branch_reports[0].is_valid).toBe(true);
    expect(report.branch_reports[0].errors).toHaveLength(0);
  });

  it('detects payload tampering', async () => {
    const e0 = createMockEvent({ id: 'e0', sequence_num: 0, branch_sequence_num: 0 });
    const h0 = calculateHash(e0, null);
    (e0 as any).content_hash = h0;
    (e0 as any).previous_hash = null;

    // Tamper with payload
    e0.payload = { foo: 'tampered-value' };

    mockClient.query.mockResolvedValueOnce({
      rows: [e0],
      rowCount: 1,
    });

    const report = await missionStore.verifyMissionIntegrity('550e8400-e29b-41d4-a716-446655440000');

    expect(report.is_valid).toBe(false);
    expect(report.branch_reports[0].is_valid).toBe(false);
    expect(report.branch_reports[0].errors[0]).toContain('Hash mismatch');
  });

  it('detects missing events in lineage', async () => {
    const e0 = createMockEvent({ id: 'e0', sequence_num: 0, branch_sequence_num: 0 });
    const h0 = calculateHash(e0, null);
    (e0 as any).content_hash = h0;
    (e0 as any).previous_hash = null;

    const e1 = createMockEvent({ id: 'e1', sequence_num: 1, branch_sequence_num: 1 });
    const h1 = calculateHash(e1, h0);
    (e1 as any).content_hash = h1;
    (e1 as any).previous_hash = h0;

    // Omit e0 to simulate deletion
    mockClient.query.mockResolvedValueOnce({
      rows: [e1],
      rowCount: 1,
    });

    const report = await missionStore.verifyMissionIntegrity('550e8400-e29b-41d4-a716-446655440000');

    expect(report.is_valid).toBe(false);
    expect(report.branch_reports[0].is_valid).toBe(false);
    expect(report.branch_reports[0].errors.some(err => err.includes('Previous hash mismatch'))).toBe(true);
  });

  it('isolates branch corruption to the compromised branch only', async () => {
    // Branch 1: Main (valid)
    const eMain = createMockEvent({ id: 'eM', branch_id: 'main', sequence_num: 0, branch_sequence_num: 0 });
    const hMain = calculateHash(eMain, null);
    (eMain as any).content_hash = hMain;
    (eMain as any).previous_hash = null;

    // Branch 2: Dev (corrupted)
    const eDev = createMockEvent({ id: 'eD', branch_id: 'dev', sequence_num: 1, branch_sequence_num: 0 });
    const hDev = calculateHash(eDev, null);
    (eDev as any).content_hash = hDev;
    (eDev as any).previous_hash = null;

    // Tamper with dev
    eDev.payload = { bad: 'data' };

    mockClient.query.mockResolvedValueOnce({
      rows: [eMain, eDev],
      rowCount: 2,
    });

    const report = await missionStore.verifyMissionIntegrity('550e8400-e29b-41d4-a716-446655440000');

    expect(report.is_valid).toBe(false);
    
    const mainReport = report.branch_reports.find(r => r.branch_id === 'main');
    const devReport = report.branch_reports.find(r => r.branch_id === 'dev');

    expect(mainReport!.is_valid).toBe(true);
    expect(devReport!.is_valid).toBe(false);
    expect(devReport!.errors[0]).toContain('Hash mismatch');
  });
});
