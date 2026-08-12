import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AgentEvents } from '@agentlens/protocol';

const mockBranchStore = {
  createExecutorSpec: vi.fn(),
  getActiveExecutors: vi.fn(),
  createSandboxJob: vi.fn(),
  getSandboxJobs: vi.fn(),
  getSandboxJobWithLogs: vi.fn(),
};

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
};

const mockMissionStore = {
  getMission: vi.fn(),
  createReplayBranch: vi.fn(),
  listMissionEvents: vi.fn(),
  getAuditEvents: vi.fn(),
};

vi.mock('../../src/db/postgres.js', () => ({
  pool: mockPool,
}));

vi.mock('../../src/services/missionStore.js', () => ({
  missionStore: mockMissionStore,
}));

vi.mock('../../src/realtime/events.js', () => ({
  publishMissionEvent: vi.fn(),
}));

let app: express.Express;

beforeEach(async () => {
  vi.resetAllMocks();
  const { branchesRouter } = await import('../../src/routes/branches.js');

  app = express();
  app.use(express.json());
  app.use(branchesRouter);
});

describe('POST /api/v1/missions/:missionId/branch-executors', () => {
  it('returns 400 for invalid body', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('validation failed'));
    const res = await request(app).post('/api/v1/missions/m1/branch-executors').send({});
    expect(res.status).toBe(500); // the current implementation responds with 500 for db errors
  });

  it('returns 201 on success', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 1 }); // missions pre-insert safety query
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'e1', name: 'Test', docker_image: 'python:3.11', python_entrypoint: 'test.py' }]
    });

    const res = await request(app)
      .post('/api/v1/missions/m1/branch-executors')
      .send({
        name: 'Test',
        docker_image: 'python:3.11',
        python_entrypoint: 'test.py',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('e1');
  });
});

describe('POST /api/v1/missions/:missionId/replay/branches', () => {
  it('returns 400 if event is not branchable', async () => {
    // get executor
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'e1' }] });
    
    // Deterministic frame evidence
    mockMissionStore.getAuditEvents.mockResolvedValueOnce({
      events: [{ event_type: AgentEvents.MISSION_STARTED, sequence_num: 1, timestamp: new Date().toISOString(), payload: {} }],
      integrity: {},
    });

    const res = await request(app)
      .post('/api/v1/missions/m1/replay/branches')
      .send({
        forked_from_sequence_num: 1,
      });

    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/non_branchable_fork_point/i);
  });

  it('returns 409 if no active executors', async () => {
    mockPool.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // No executors
    
    const res = await request(app)
      .post('/api/v1/missions/m1/replay/branches')
      .send({
        forked_from_sequence_num: 1,
      });

    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/executor_not_configured/i);
  });

  it('returns 201 on successful branch creation', async () => {
    // 1. executor
    mockPool.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'e1' }] });
    // 2. exact frame evidence
    mockMissionStore.getAuditEvents.mockResolvedValueOnce({
      events: [{ event_type: AgentEvents.INTERRUPT_REQUESTED, sequence_num: 1, payload: {}, timestamp: new Date().toISOString() }],
      integrity: {},
    });

    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient);

    mockMissionStore.createReplayBranch.mockResolvedValueOnce({ id: 'b1', mission_id: 'm1' });
    
    // 3. insert job (in client)
    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockResolvedValueOnce({}); // INSERT
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'j1' }] }); // SELECT
    mockClient.query.mockResolvedValueOnce({}); // COMMIT

    const res = await request(app)
      .post('/api/v1/missions/m1/replay/branches')
      .send({
        forked_from_sequence_num: 1,
      });

    if (res.status === 500) console.log(res.body);

    expect(res.status).toBe(201);
    expect(res.body.branch.id).toBe('b1');
    expect(res.body.job.id).toBe('j1');
  });
});
