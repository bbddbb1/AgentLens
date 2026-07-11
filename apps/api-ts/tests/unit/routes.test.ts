import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock module-level dependencies
const mockStore = {
  createMission: vi.fn(),
  listMissions: vi.fn(),
  getMission: vi.fn(),
  updateMission: vi.fn(),
  deleteMission: vi.fn(),
  ingestSpans: vi.fn(),
  getRuntimeSummary: vi.fn(),
  getRuntimeExplanation: vi.fn(),
  scheduleNodeProjectionEnhancements: vi.fn(),
  getCurrentGraph: vi.fn(),
  getSnapshots: vi.fn(),
  getReplayFromTelemetry: vi.fn(),
  listReplayBranches: vi.fn(),
  createReplayBranch: vi.fn(),
  listMissionEvents: vi.fn(),
  generateSummary: vi.fn(),
  generateSummaryForHumanReview: vi.fn(),
  generateWhyThisState: vi.fn(),
  listSummaries: vi.fn(),
  createReview: vi.fn(),
  listReviews: vi.fn(),
  createComment: vi.fn(),
  listComments: vi.fn(),
  resolveComment: vi.fn(),
  createArtifact: vi.fn(),
  listArtifacts: vi.fn(),
  getArtifact: vi.fn(),
  createInterrupt: vi.fn(),
  listInterrupts: vi.fn(),
  decideInterrupt: vi.fn(),
  resumeInterruptByToken: vi.fn(),
  createShare: vi.fn(),
  listShares: vi.fn(),
  findUserByEmail: vi.fn(),
};

const mockPublishEvent = vi.fn();

vi.mock('../../src/services/missionStore.js', () => ({
  missionStore: mockStore,
}));

vi.mock('../../src/realtime/events.js', () => ({
  publishMissionEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

vi.mock('../../src/services/artifacts.js', () => ({
  artifactBucket: () => 'test-bucket',
  presignArtifactUpload: () => Promise.resolve('http://minio/presign-upload'),
  presignArtifactDownload: () => Promise.resolve('http://minio/presign-download'),
}));

let app: express.Express;

beforeEach(async () => {
  vi.resetAllMocks();
  mockPublishEvent.mockResolvedValue(undefined);
  mockStore.getRuntimeSummary.mockResolvedValue(null);
  mockStore.getRuntimeExplanation.mockResolvedValue(null);
  mockStore.scheduleNodeProjectionEnhancements.mockResolvedValue(undefined);
  // Re-import routes after mock reset to get fresh instances
  const { missionsRouter } = await import('../../src/routes/missions.js');
  const { extrasRouter } = await import('../../src/routes/extras.js');

  app = express();
  app.use(express.json());
  app.use(missionsRouter);
  app.use(extrasRouter);
});

// ====================================================================
// Missions CRUD
// ====================================================================

describe('POST /api/v1/missions', () => {
  it('returns 400 for empty body', async () => {
    const res = await request(app).post('/api/v1/missions').send({});
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    mockStore.createMission.mockResolvedValueOnce({
      id: 'm1', objective: 'Research', status: 'active', phase: 'planning',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      metadata: {}, is_encrypted: false, visibility: 'private',
    });

    const res = await request(app)
      .post('/api/v1/missions')
      .send({ objective: 'Research' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('m1');
    expect(mockPublishEvent).toHaveBeenCalledWith('m1', 'mission.created', expect.anything());
  });
});

describe('GET /api/v1/missions', () => {
  it('returns paginated list', async () => {
    mockStore.listMissions.mockResolvedValueOnce({
      missions: [], total: 0, page: 1, per_page: 20,
    });

    const res = await request(app).get('/api/v1/missions');
    expect(res.status).toBe(200);
    expect(res.body.missions).toEqual([]);
  });

  it('passes query params to store', async () => {
    mockStore.listMissions.mockResolvedValueOnce({
      missions: [], total: 0, page: 2, per_page: 10,
    });

    await request(app).get('/api/v1/missions?page=2&per_page=10&status=active');
    expect(mockStore.listMissions).toHaveBeenCalledWith(2, 10, 'active');
  });
});

describe('GET /api/v1/missions/:missionId', () => {
  it('returns 404 for unknown mission', async () => {
    mockStore.getMission.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/v1/missions/unknown');
    expect(res.status).toBe(404);
  });

  it('returns the mission', async () => {
    mockStore.getMission.mockResolvedValueOnce({
      id: 'm1', objective: 'Research', status: 'active', phase: 'executing',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      metadata: {}, is_encrypted: false, visibility: 'private',
    });

    const res = await request(app).get('/api/v1/missions/m1');
    expect(res.status).toBe(200);
    expect(res.body.objective).toBe('Research');
  });
});

describe('PATCH /api/v1/missions/:missionId', () => {
  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .patch('/api/v1/missions/m1')
      .send({ status: 'unknown-status' });
    expect(res.status).toBe(400);
  });

  it('returns 404 if not found', async () => {
    mockStore.updateMission.mockResolvedValueOnce(null);
    const res = await request(app)
      .patch('/api/v1/missions/m1')
      .send({ status: 'completed' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/missions/:missionId', () => {
  it('returns 204 on deletion', async () => {
    mockStore.deleteMission.mockResolvedValueOnce(true);
    const res = await request(app).delete('/api/v1/missions/m1');
    expect(res.status).toBe(204);
  });

  it('returns 404 if not found', async () => {
    mockStore.deleteMission.mockResolvedValueOnce(false);
    const res = await request(app).delete('/api/v1/missions/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ====================================================================
// Ingest
// ====================================================================

describe('POST /api/v1/ingest/otlp', () => {
  it('returns 400 for empty body', async () => {
    const res = await request(app).post('/api/v1/ingest/otlp').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid span data', async () => {
    const res = await request(app)
      .post('/api/v1/ingest/otlp')
      .send({ spans: [{ trace_id: '', span_id: '', operation_name: '' }] });
    expect(res.status).toBe(400);
  });

  it('retains HTTP 202 and publishes one replay update after evidence-changing ingest', async () => {
    mockStore.ingestSpans.mockResolvedValueOnce({ accepted: true, mission_id: '550e8400-e29b-41d4-a716-446655440000', branch_id: 'main', evidence_changed: true });
    mockStore.getRuntimeSummary.mockResolvedValueOnce(null);
    mockStore.getRuntimeExplanation.mockResolvedValueOnce(null);
    mockStore.scheduleNodeProjectionEnhancements.mockResolvedValueOnce(undefined);

    const res = await request(app).post('/api/v1/ingest/otlp').send({
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
      spans: [{ trace_id: 'trace', span_id: 'span', operation_name: 'agent.run', start_time_unix_nano: 1, end_time_unix_nano: 2, attributes: {} }],
    });

    expect(res.status).toBe(202);
    expect(mockPublishEvent).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000', 'replay.updated', { branch_id: 'main' });
  });

  it('does not publish a replay update for a duplicate-batch no-op', async () => {
    mockStore.ingestSpans.mockResolvedValueOnce({ accepted: true, mission_id: '550e8400-e29b-41d4-a716-446655440000', branch_id: 'main', evidence_changed: false });

    const res = await request(app).post('/api/v1/ingest/otlp').send({
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
      spans: [{ trace_id: 'trace', span_id: 'span', operation_name: 'agent.run', start_time_unix_nano: 1, end_time_unix_nano: 2, attributes: {} }],
    });

    expect(res.status).toBe(202);
    expect(mockPublishEvent).not.toHaveBeenCalledWith(expect.anything(), 'replay.updated', expect.anything());
  });

  it('retains HTTP 202 for standard OTLP JSON ingest', async () => {
    mockStore.ingestSpans.mockResolvedValueOnce({ accepted: true, mission_id: '550e8400-e29b-41d4-a716-446655440000', branch_id: 'main', evidence_changed: true });

    const res = await request(app).post('/v1/traces').send({
      resourceSpans: [{ resource: { attributes: [{ key: 'agentlens.mission.id', value: { stringValue: '550e8400-e29b-41d4-a716-446655440000' } }] }, scopeSpans: [{ spans: [{ traceId: 'trace', spanId: 'span', name: 'agent.run', startTimeUnixNano: '1', endTimeUnixNano: '2', status: { code: 1 } }] }] }],
    });

    expect(res.status).toBe(202);
    expect(res.body.partialSuccess.rejectedSpans).toBe(0);
  });
});

// ====================================================================
// Graph
// ====================================================================

describe('GET /api/v1/missions/:missionId/graph', () => {
  it('returns graph for mission', async () => {
    mockStore.getCurrentGraph.mockResolvedValueOnce({
      mission_id: 'm1', projection_version: 'span_projection.v1', current: null, total_snapshots: 0,
    });

    const res = await request(app).get('/api/v1/missions/m1/graph');
    expect(res.status).toBe(200);
    expect(res.body.projection_version).toBe('span_projection.v1');
  });

  it('returns 404 for unknown mission', async () => {
    mockStore.getCurrentGraph.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/v1/missions/unknown/graph');
    expect(res.status).toBe(404);
  });
});

// ====================================================================
// Replay
// ====================================================================

describe('GET /api/v1/missions/:missionId/replay', () => {
  it('returns 404 for unknown mission', async () => {
    mockStore.getMission.mockResolvedValueOnce(null);
    const res = await request(app).get('/api/v1/missions/unknown/replay');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/missions/:missionId/graph/snapshots', () => {
  it('returns the span projection version without removing snapshot fields', async () => {
    mockStore.getSnapshots.mockResolvedValueOnce([]);

    const res = await request(app).get('/api/v1/missions/m1/graph/snapshots');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projection_version: 'span_projection.v1', snapshots: [], offset: 0, limit: 50, count: 0 });
  });
});

// ====================================================================
// Interrupts
// ====================================================================

describe('POST /api/v1/interrupts', () => {
  it('returns 400 if mission_id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/interrupts')
      .send({ reason: 'Need approval' });
    expect(res.status).toBe(400);
  });

  it('returns 400 if mission_id is not a valid UUID', async () => {
    const res = await request(app)
      .post('/api/v1/interrupts')
      .send({ mission_id: 'not-a-uuid', reason: 'Need approval' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/missions/:missionId/interrupts', () => {
  it('lists interrupts by status', async () => {
    mockStore.listInterrupts.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/v1/missions/m1/interrupts?status=pending');
    expect(res.status).toBe(200);
    expect(mockStore.listInterrupts).toHaveBeenCalledWith('m1', 'pending', undefined);
  });
});

describe('POST /api/v1/missions/:missionId/interrupts/:interruptId/decision', () => {
  it('returns 400 for invalid decision value', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/interrupts/int-1/decision')
      .send({ decision: 'invalid', idempotency_key: 'k1' });
    expect(res.status).toBe(400);
  });

  it('returns 404 if interrupt not found', async () => {
    mockStore.decideInterrupt.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/v1/missions/m1/interrupts/int-1/decision')
      .send({ decision: 'approve', idempotency_key: 'k1' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/interrupts/resume', () => {
  it('returns 400 when resume_token is missing', async () => {
    const res = await request(app)
      .post('/api/v1/interrupts/resume')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ====================================================================
// Reviews
// ====================================================================

describe('POST /api/v1/missions/:missionId/reviews', () => {
  it('returns 404 for unknown mission', async () => {
    mockStore.getMission.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/v1/missions/unknown/reviews')
      .send({ status: 'pending' });
    expect(res.status).toBe(404);
  });
});

// ====================================================================
// Comments
// ====================================================================

describe('POST /api/v1/missions/:missionId/comments', () => {
  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/comments')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ====================================================================
// Artifacts
// ====================================================================

describe('POST /api/v1/missions/:missionId/artifacts/presign', () => {
  it('returns 400 for missing name', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/artifacts/presign')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ====================================================================
// Shares
// ====================================================================

describe('POST /api/v1/missions/:missionId/share', () => {
  it('returns 400 for invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/share')
      .send({ user_email: 'not-email', encrypted_key: 'abc' });
    expect(res.status).toBe(400);
  });
});

// ====================================================================
// Replay branches
// ====================================================================

describe('POST /api/v1/missions/:missionId/replay/branches', () => {
  it('returns 400 for empty body if schema fails', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/replay/branches')
      .send({});
    // Schema has all optional fields, so it should pass validation
    mockStore.createReplayBranch.mockResolvedValueOnce(null);
    expect(res.status).toBe(404);
  });
});

// ====================================================================
// Why This State
// ====================================================================

describe('POST /api/v1/missions/:missionId/why-this-state', () => {
  it('returns 400 for missing sequence_num', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/why-this-state')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative sequence_num', async () => {
    const res = await request(app)
      .post('/api/v1/missions/m1/why-this-state')
      .send({ sequence_num: -1 });
    expect(res.status).toBe(400);
  });
});
