import { describe, expect, it, vi, beforeEach } from 'vitest';

// -- mock pg pool --
const mockQuery = vi.fn();
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

vi.mock('../../src/db/postgres.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => Promise.resolve(mockClient),
  },
}));

import { missionStore } from '../../src/services/missionStore.js';
import { projectReplay } from '../../src/services/runtime/projection.js';
import { SEMANTIC_PRESENTATION_AUTHORITY_VERSION } from '../../src/services/semantic.js';

beforeEach(() => {
  vi.resetAllMocks();
});

// -- helpers --
function fakeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    objective: 'Test mission',
    status: 'active',
    phase: 'executing',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T01:00:00.000Z'),
    completed_at: null,
    metadata: {},
    is_encrypted: false,
    visibility: 'private',
    owner_id: null,
    ...overrides,
  };
}

// ====================================================================
// Row mapping (via getMission / listMissions)
// ====================================================================

describe('missionStore — row mapping', () => {
  it('maps a mission row correctly', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });

    const mission = await missionStore.getMission('550e8400-e29b-41d4-a716-446655440000');

    expect(mission).toBeDefined();
    expect(mission!.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(mission!.objective).toBe('Test mission');
    expect(mission!.status).toBe('active');
    expect(mission!.phase).toBe('executing');
    expect(mission!.is_encrypted).toBe(false);
    expect(mission!.visibility).toBe('private');
    expect(mission!.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null for missing mission', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const mission = await missionStore.getMission('nonexistent');
    expect(mission).toBeNull();
  });
});

// ====================================================================
// createMission
// ====================================================================

describe('missionStore — createMission', () => {
  it('creates a mission in a transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 }) // INSERT mission
      .mockResolvedValueOnce({ rows: [fakeRow({ id: 'main' })], rowCount: 1 }) // ensureBranch
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // COMMIT

    const mission = await missionStore.createMission({ objective: 'Research AI trends' });

    expect(mission!.id).toBeDefined();
    expect(mockClient.query).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('rolls back on error', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // BEGIN
      .mockRejectedValueOnce(new Error('DB error')); // INSERT fails
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // ROLLBACK

    await expect(
      missionStore.createMission({ objective: 'x' }),
    ).rejects.toThrow('DB error');

    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ====================================================================
// getMission
// ====================================================================

describe('missionStore — getMission', () => {
  it('queries by id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });

    await missionStore.getMission('550e8400-e29b-41d4-a716-446655440000');

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM missions WHERE id = $1',
      ['550e8400-e29b-41d4-a716-446655440000'],
    );
  });
});

// ====================================================================
// listMissions
// ====================================================================

describe('missionStore — listMissions', () => {
  it('returns paginated results', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 10 }], rowCount: 1 }) // COUNT
      .mockResolvedValueOnce({ rows: [fakeRow(), fakeRow()], rowCount: 2 }); // SELECT

    const result = await missionStore.listMissions(1, 20);

    expect(result.total).toBe(10);
    expect(result.page).toBe(1);
    expect(result.per_page).toBe(20);
    expect(result.missions).toHaveLength(2);
  });

  it('filters by status', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 });

    await missionStore.listMissions(1, 20, 'completed');

    // At least one call includes the status filter
    const allCalls = mockQuery.mock.calls;
    const hasStatusCall = allCalls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('WHERE status')
    );
    expect(hasStatusCall).toBe(true);
  });
});

describe('missionStore — semantic presentation cache', () => {
  it('reads only the requested branch and the bounded presentation authority', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        summary: 'bounded child summary', conflicts: [], anomalies: [],
        branch_id: 'child', level: 'mission', created_at: new Date('2026-01-01T00:00:00.000Z'),
      }],
      rowCount: 1,
    });

    const result = await missionStore.listSummaries('mission-1', undefined, 'child');

    expect(result).toHaveLength(1);
    expect(result[0]?.summary).toBe('bounded child summary');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/branch_id = \$2[\s\S]*authority_version = \$3/),
      ['mission-1', 'child', SEMANTIC_PRESENTATION_AUTHORITY_VERSION],
    );
  });

  it('builds why-this-state from the exact requested frame and never falls back to latest', async () => {
    const getMission = vi.spyOn(missionStore, 'getMission').mockResolvedValue(fakeRow() as any);
    const getReplay = vi.spyOn(missionStore, 'getReplayFromTelemetry').mockResolvedValue({
      mission_id: 'mission-1', branch_id: 'main', branches: [],
      events: [
        {
          id: 'frame-zero-event', mission_id: 'mission-1', branch_id: 'main',
          branch_sequence_num: 0, sequence_num: 0, event_type: 'task.started',
          timestamp: '2026-01-01T00:00:00.000Z', payload: { task: 'root' }, metadata: {},
          span_id: 'root-span',
        },
        {
          id: 'later-trigger', mission_id: 'mission-1', branch_id: 'main',
          branch_sequence_num: 1, sequence_num: 1, event_type: 'tool.called',
          timestamp: '2026-01-01T00:00:01.000Z', payload: { 'gen_ai.tool.name': 'late' }, metadata: {},
          span_id: 'late-span', causal: { triggered_by_event_id: 'frame-zero-event', tool_call_id: 'late' },
        },
      ],
      snapshots: [
        { id: 'frame-0', mission_id: 'mission-1', branch_id: 'main', sequence_num: 0, timestamp: '2026-01-01T00:00:00.000Z', nodes: [], edges: [] },
        { id: 'frame-1', mission_id: 'mission-1', branch_id: 'main', sequence_num: 1, timestamp: '2026-01-01T00:00:01.000Z', nodes: [], edges: [] },
      ],
      current_state: { status: 'active', phase: 'executing', agents: {}, interrupts: {}, nodes: [], edges: [] },
    } as any);
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

    try {
      const historical = await missionStore.generateWhyThisState('mission-1', 0, 'main');
      expect(historical?.frame?.sequence_num).toBe(0);
      expect(historical?.summary).not.toContain('trigger reference');
      expect(historical?.evidence_refs?.some((ref) => ref.event_id === 'later-trigger')).toBe(false);
      expect(await missionStore.generateWhyThisState('mission-1', 2, 'main')).toBeNull();
    } finally {
      getMission.mockRestore();
      getReplay.mockRestore();
    }
  });
});

// ====================================================================
// updateMission
// ====================================================================

describe('missionStore — updateMission', () => {
  it('updates mission and returns the updated row', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 }) // getMission
      .mockResolvedValueOnce({ rows: [fakeRow({ status: 'completed' })], rowCount: 1 }); // UPDATE

    const mission = await missionStore.updateMission('m1', { status: 'completed' });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mission!.status).toBe('completed');
  });

  it('returns null if mission does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // getMission not found

    const result = await missionStore.updateMission('nonexistent', { status: 'completed' });
    expect(result).toBeNull();
  });
});

// ====================================================================
// deleteMission
// ====================================================================

describe('missionStore — deleteMission', () => {
  it('deletes and returns true when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await missionStore.deleteMission('m1');
    expect(result).toBe(true);
  });

  it('returns false when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await missionStore.deleteMission('nonexistent');
    expect(result).toBe(false);
  });
});

// ====================================================================
// ingestSpans
// ====================================================================

describe('missionStore — ingestSpans', () => {
  it('returns null for empty spans', async () => {
    const result = await missionStore.ingestSpans('m1', []);
    expect(result).toBeNull();
  });
});

// ====================================================================
// reviews
// ====================================================================

describe('missionStore — reviews', () => {
  it('creates a review', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', mission_id: 'm1', status: 'approved', body: 'LGTM', created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z') }],
      rowCount: 1,
    });

    const review = await missionStore.createReview('m1', 'approved', 'LGTM');

    expect(review.id).toBe('r1');
    expect(review.status).toBe('approved');
    expect(review.body).toBe('LGTM');
    expect(review.mission_id).toBe('m1');
  });

  it('lists reviews for a mission', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'r2', mission_id: 'm1', status: 'pending', body: null, created_at: new Date('2026-01-01T00:00:00.000Z'), updated_at: new Date('2026-01-01T00:00:00.000Z') },
      ],
      rowCount: 1,
    });

    const reviews = await missionStore.listReviews('m1');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe('r2');
  });
});

// ====================================================================
// comments
// ====================================================================

describe('missionStore — comments', () => {
  it('creates a comment', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'c1', mission_id: 'm1', review_id: 'r1', author_id: null, parent_id: null,
        body: 'Interesting', target_type: 'node', target_id: 'n1', target_context: {},
        resolved: false, created_at: new Date('2026-01-01T00:00:00.000Z'),
      }],
      rowCount: 1,
    });

    const comment = await missionStore.createComment({
      missionId: 'm1', body: 'Interesting', reviewId: 'r1', targetType: 'node', targetId: 'n1',
    });

    expect(comment.id).toBe('c1');
    expect(comment.body).toBe('Interesting');
    expect(comment.review_id).toBe('r1');
    expect(comment.resolved).toBe(false);
  });

  it('resolves a comment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const result = await missionStore.resolveComment('m1', 'c1');
    expect(result).toBe(true);
  });

  it('returns false when comment not found for resolve', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await missionStore.resolveComment('m1', 'nonexistent');
    expect(result).toBe(false);
  });
});

// ====================================================================
// artifacts
// ====================================================================

describe('missionStore — artifacts', () => {
  it('creates an artifact', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'a1', mission_id: 'm1', name: 'report.pdf', artifact_type: 'document',
        object_key: 'm1/a1/report.pdf', content_type: 'application/pdf',
        size_bytes: 1024, metadata: {}, created_at: new Date('2026-01-01T00:00:00.000Z'),
      }],
      rowCount: 1,
    });

    const artifact = await missionStore.createArtifact({
      id: 'a1', missionId: 'm1', name: 'report.pdf', artifactType: 'document',
      objectKey: 'm1/a1/report.pdf', contentType: 'application/pdf', sizeBytes: 1024,
    });

    expect(artifact.id).toBe('a1');
    expect(artifact.name).toBe('report.pdf');
    expect(artifact.object_key).toBe('m1/a1/report.pdf');
    expect(artifact.size_bytes).toBe(1024);
  });

  it('lists artifacts for a mission', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'a1', mission_id: 'm1', name: 'report.pdf', artifact_type: 'document',
        object_key: 'm1/a1/report.pdf', content_type: 'application/pdf',
        size_bytes: 1024, metadata: {}, created_at: new Date('2026-01-01T00:00:00.000Z'),
      }],
      rowCount: 1,
    });

    const artifacts = await missionStore.listArtifacts('m1');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].name).toBe('report.pdf');
  });

  it('gets artifact by id', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'a1', mission_id: 'm1', name: 'report.pdf', artifact_type: 'document',
        object_key: 'm1/a1/report.pdf', content_type: null, size_bytes: null,
        metadata: {}, created_at: new Date('2026-01-01T00:00:00.000Z'),
      }],
      rowCount: 1,
    });

    const artifact = await missionStore.getArtifact('m1', 'a1');
    expect(artifact!.id).toBe('a1');
    expect(artifact!.content_type).toBeUndefined();
  });

  it('returns null for missing artifact', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const artifact = await missionStore.getArtifact('m1', 'nonexistent');
    expect(artifact).toBeNull();
  });
});

// ====================================================================
// share
// ====================================================================

describe('missionStore — sharing', () => {
  it('creates a share record', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 's1', mission_id: 'm1', user_id: 'u1', permission: 'viewer',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
      }],
      rowCount: 1,
    });

    const share = await missionStore.createShare({
      missionId: 'm1', userId: 'u1', encryptedKeyBase64: 'aGVsbG8=', permission: 'viewer',
    });

    expect(share.id).toBe('s1');
    expect(share.permission).toBe('viewer');
  });
});

// ====================================================================
// findUserByEmail
// ====================================================================

describe('missionStore — findUserByEmail', () => {
  it('finds a user by email', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'test@example.com' }],
      rowCount: 1,
    });

    const user = await missionStore.findUserByEmail('test@example.com');
    expect(user!.id).toBe('u1');
    expect(user!.email).toBe('test@example.com');
  });

  it('returns null for unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const user = await missionStore.findUserByEmail('nobody@example.com');
    expect(user).toBeNull();
  });
});

// ====================================================================
// createInterrupt
// ====================================================================

describe('missionStore — createInterrupt', () => {
  it('returns null if mission not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // getMission

    const result = await missionStore.createInterrupt({
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
      reason: 'Need approval',
    });

    expect(result).toBeNull();
  });
});

describe('missionStore — getAuditEvents and EventEnvelope', () => {
  it('hydrates EventEnvelope correctly with actor, model, error, causal, and policy fields', async () => {
    const now = '2026-05-31T00:00:00.000Z';
    const rawSpan = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
      branch_id: 'main',
      trace_id: 'trace1',
      span_id: 'span1',
      parent_span_id: 'parent1',
      name: 'test',
      start_time_unix_nano: '1717113600000000000',
      end_time_unix_nano: null,
      status_code: 'OK',
      attributes: {
        'agent.span.kind': 'execute_tool',
        'gen_ai.agent.id': 'agent1',
        actor_type: 'tool',
        actor_id: 'test_tool',
        origin_framework: 'langgraph',
        causal: { parent_span_id: 'parent1' },
        model: { model_name: 'gemini-3.5-flash' },
        error_attribution: { source: 'model', cause: 'hallucination' },
        policy_decision: { rule_id: 'rule1', decision: 'allow' }
      },
      events: []
    };

    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 }); // getMission
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'main', name: 'Main', status: 'active', created_at: now, updated_at: now }], rowCount: 1 }); // branches
    mockClient.query.mockResolvedValueOnce({ rows: [rawSpan], rowCount: 1 }); // spans
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // interrupts

    const response = await missionStore.getAuditEvents('550e8400-e29b-41d4-a716-446655440000', 'main');

    expect(response.events).toHaveLength(1);
    const event = response.events[0];
    expect(event.actor_type).toBe('tool');
    expect(event.actor_id).toBe('test_tool');
    expect(event.origin_framework).toBe('langgraph');
    expect(event.causal).toEqual({ parent_span_id: 'parent1' });
    expect(event.model).toEqual({ model_name: 'gemini-3.5-flash' });
    expect(event.error).toEqual({ source: 'model', cause: 'hallucination' });
    expect(event.policy).toEqual({ rule_id: 'rule1', decision: 'allow' });
    expect(response.integrity.is_valid).toBeNull();
    expect(response.integrity.verification_status).toBe('unsupported');
  });

  it('filters by branch and sequence number in getAuditEvents query', async () => {
    const now = '2026-05-31T00:00:00.000Z';
    mockQuery.mockResolvedValueOnce({ rows: [fakeRow()], rowCount: 1 }); // getMission
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'dev-branch', name: 'Dev', status: 'active', created_at: now, updated_at: now }], rowCount: 1 }); // branches
    
    const spanRows = [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          mission_id: '550e8400-e29b-41d4-a716-446655440000',
          branch_id: 'dev-branch',
          trace_id: 't1',
          span_id: 'span1',
          name: 'span1',
          start_time_unix_nano: '1000000',
          end_time_unix_nano: '2000000',
          status_code: 'OK',
          attributes: {},
          events: [],
        },
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          mission_id: '550e8400-e29b-41d4-a716-446655440000',
          branch_id: 'dev-branch',
          trace_id: 't1',
          span_id: 'span2',
          name: 'span2',
          start_time_unix_nano: '3000000',
          end_time_unix_nano: '4000000',
          status_code: 'OK',
          attributes: {},
          events: [],
        },
      ];
    mockClient.query.mockResolvedValueOnce({
      rows: spanRows,
      rowCount: 2,
    }); // spans
    mockClient.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // interrupts

    const cutoff = projectReplay(
      '550e8400-e29b-41d4-a716-446655440000',
      'dev-branch',
      spanRows.map((row) => ({
        ...row,
        operation_name: row.name,
      })),
    ).events[1].sequence_num;
    const result = await missionStore.getAuditEvents('550e8400-e29b-41d4-a716-446655440000', 'dev-branch', cutoff);
    
    // Each finished span has started + completed evidence. The exact stable cursor
    // for the first completion selects the same chronological prefix.
    expect(result.events).toHaveLength(2);
    expect(result.events[1].sequence_num).toBe(cutoff);
  });
});
