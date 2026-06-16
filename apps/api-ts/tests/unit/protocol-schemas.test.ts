import { describe, expect, it } from 'vitest';
import {
  AttributeMapSchema,
  CreateMissionSchema,
  CreateInterruptSchema,
  DecideInterruptSchema,
  ResumeInterruptSchema,
  CreateReplayBranchSchema,
  MissionStatusSchema,
  MissionPhaseSchema,
  OtlpSpanSchema,
  OtlpIngestRequestSchema,
  UpdateMissionSchema,
} from '@agentlens/protocol';

// ====================================================================
// AttributeMapSchema
// ====================================================================

describe('AttributeMapSchema', () => {
  it('accepts valid attribute maps', () => {
    expect(AttributeMapSchema.safeParse({ 'gen_ai.agent.id': 'agent-1', count: 42 }).success).toBe(true);
    expect(AttributeMapSchema.safeParse({}).success).toBe(true);
    expect(AttributeMapSchema.safeParse({ tags: ['a', 'b'], score: 0.95, ok: true }).success).toBe(true);
  });
});

// ====================================================================
// OtlpSpanSchema
// ====================================================================

describe('OtlpSpanSchema', () => {
  const validSpan = {
    trace_id: 'trace-1',
    span_id: 'span-1',
    operation_name: 'test-op',
    start_time_unix_nano: 1_000_000_000,
    end_time_unix_nano: 2_000_000_000,
  };

  it('accepts a valid minimal span', () => {
    const result = OtlpSpanSchema.safeParse(validSpan);
    expect(result.success).toBe(true);
  });

  it('rejects missing trace_id', () => {
    const result = OtlpSpanSchema.safeParse({ ...validSpan, trace_id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing span_id', () => {
    const result = OtlpSpanSchema.safeParse({ ...validSpan, span_id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing operation_name', () => {
    const result = OtlpSpanSchema.safeParse({ ...validSpan, operation_name: '' });
    expect(result.success).toBe(false);
  });

  it('accepts string timestamps and converts to numbers', () => {
    const result = OtlpSpanSchema.safeParse({
      ...validSpan,
      start_time_unix_nano: '1000000000',
      end_time_unix_nano: '2000000000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.start_time_unix_nano).toBe('number');
    }
  });

  it('defaults status_code to OK', () => {
    const result = OtlpSpanSchema.safeParse(validSpan);
    if (result.success) {
      expect(result.data.status_code).toBe('OK');
    }
  });

  it('defaults events to empty array', () => {
    const result = OtlpSpanSchema.safeParse(validSpan);
    if (result.success) {
      expect(result.data.events).toEqual([]);
    }
  });

  it('accepts parent_span_id as null', () => {
    const result = OtlpSpanSchema.safeParse({ ...validSpan, parent_span_id: null });
    expect(result.success).toBe(true);
  });

  it('accepts parent_span_id as a string', () => {
    const result = OtlpSpanSchema.safeParse({ ...validSpan, parent_span_id: 'parent-1' });
    expect(result.success).toBe(true);
  });
});

// ====================================================================
// OtlpIngestRequestSchema
// ====================================================================

describe('OtlpIngestRequestSchema', () => {
  const minimalSpan = { trace_id: 't1', span_id: 's1', operation_name: 'test', start_time_unix_nano: 1, end_time_unix_nano: 2 };

  it('accepts valid ingest request', () => {
    const result = OtlpIngestRequestSchema.safeParse({ spans: [minimalSpan] });
    expect(result.success).toBe(true);
  });

  it('rejects empty spans array', () => {
    const result = OtlpIngestRequestSchema.safeParse({ spans: [] });
    expect(result.success).toBe(false);
  });

  it('allows optional mission_id', () => {
    const result = OtlpIngestRequestSchema.safeParse({ spans: [minimalSpan] });
    expect(result.success).toBe(true);
  });
});

// ====================================================================
// CreateMissionSchema
// ====================================================================

describe('CreateMissionSchema', () => {
  it('accepts valid mission creation', () => {
    const result = CreateMissionSchema.safeParse({ objective: 'Research AI trends' });
    expect(result.success).toBe(true);
  });

  it('rejects empty objective', () => {
    const result = CreateMissionSchema.safeParse({ objective: '' });
    expect(result.success).toBe(false);
  });

  it('accepts optional metadata', () => {
    const result = CreateMissionSchema.safeParse({
      objective: 'Test',
      metadata: { source: 'api', priority: 'high' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional is_encrypted flag', () => {
    const result = CreateMissionSchema.safeParse({ objective: 'Test', is_encrypted: true });
    expect(result.success).toBe(true);
  });
});

// ====================================================================
// UpdateMissionSchema
// ====================================================================

describe('UpdateMissionSchema', () => {
  it('accepts valid status update', () => {
    const result = UpdateMissionSchema.safeParse({ status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = UpdateMissionSchema.safeParse({ status: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('accepts valid phase', () => {
    const phases = ['planning', 'executing', 'reviewing', 'waiting_for_human', 'completed', 'failed'];
    for (const phase of phases) {
      expect(UpdateMissionSchema.safeParse({ phase }).success).toBe(true);
    }
  });

  it('rejects invalid phase', () => {
    const result = UpdateMissionSchema.safeParse({ phase: 'unknown_phase' });
    expect(result.success).toBe(false);
  });
});

// ====================================================================
// MissionStatusSchema
// ====================================================================

describe('MissionStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['active', 'paused', 'completed', 'failed', 'cancelled'];
    for (const status of statuses) {
      expect(MissionStatusSchema.safeParse(status).success).toBe(true);
    }
  });
});

// ====================================================================
// MissionPhaseSchema
// ====================================================================

describe('MissionPhaseSchema', () => {
  it('accepts all valid phases', () => {
    const phases = ['planning', 'executing', 'reviewing', 'waiting_for_human', 'completed', 'failed'];
    for (const phase of phases) {
      expect(MissionPhaseSchema.safeParse(phase).success).toBe(true);
    }
  });
});

// ====================================================================
// CreateInterruptSchema
// ====================================================================

describe('CreateInterruptSchema', () => {
  it('requires mission_id as UUID', () => {
    const result = CreateInterruptSchema.safeParse({
      mission_id: 'not-a-uuid',
      reason: 'Need approval',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid interrupt request', () => {
    const result = CreateInterruptSchema.safeParse({
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
      reason: 'Need human approval for deployment',
      agent_id: 'deployer',
      expires_at: '2026-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('requires reason', () => {
    const result = CreateInterruptSchema.safeParse({
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional resume_token', () => {
    const result = CreateInterruptSchema.safeParse({
      mission_id: '550e8400-e29b-41d4-a716-446655440000',
      reason: 'Need approval',
      resume_token: 'abcdef1234567890',
    });
    expect(result.success).toBe(true);
  });
});

// ====================================================================
// DecideInterruptSchema
// ====================================================================

describe('DecideInterruptSchema', () => {
  it('accepts approve decision', () => {
    const result = DecideInterruptSchema.safeParse({
      decision: 'approve',
      idempotency_key: 'k1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid decision', () => {
    const result = DecideInterruptSchema.safeParse({
      decision: 'maybe_later',
      idempotency_key: 'k1',
    });
    expect(result.success).toBe(false);
  });

  it('requires idempotency_key', () => {
    const result = DecideInterruptSchema.safeParse({ decision: 'approve' });
    expect(result.success).toBe(false);
  });
});

// ====================================================================
// ResumeInterruptSchema
// ====================================================================

describe('ResumeInterruptSchema', () => {
  it('requires resume_token', () => {
    const result = ResumeInterruptSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid resume request', () => {
    const result = ResumeInterruptSchema.safeParse({ resume_token: 'token123' });
    expect(result.success).toBe(true);
  });
});

// ====================================================================
// CreateReplayBranchSchema
// ====================================================================

describe('CreateReplayBranchSchema', () => {
  it('accepts empty input (all fields optional)', () => {
    const result = CreateReplayBranchSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts named fork', () => {
    const result = CreateReplayBranchSchema.safeParse({
      name: 'experiment',
      source_branch_id: 'main',
      forked_from_sequence_num: 5,
    });
    expect(result.success).toBe(true);
  });
});
