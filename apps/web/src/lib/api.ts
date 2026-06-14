/**
 * API client for AgentLens TS backend.
 */

import type {
  GraphSnapshot,
  InterruptRecord,
  Mission,
  MissionEventRecord,
  ReplayBranch,
  ReplayStateResponse,
  SemanticSummaryResult,
  RuntimeSummary,
  RuntimeNodeProjection,
  AuditIntegrityReport,
  MissionAuditEventResponse,
} from '@agentlens/protocol';
import type { Comment, Review } from '@/stores/reviewStore';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';

interface ListMissionsResponse {
  missions: Mission[];
  total: number;
  page: number;
  per_page: number;
}

interface GraphResponse {
  mission_id: string;
  current: GraphSnapshot | null;
  total_snapshots: number;
}

interface SnapshotsResponse {
  snapshots: GraphSnapshot[];
  offset: number;
  limit: number;
  count: number;
}

interface InterruptsResponse {
  interrupts: InterruptRecord[];
}

interface BranchesResponse {
  branches: ReplayBranch[];
}

interface EventsResponse {
  events: MissionEventRecord[];
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`API Error ${res.status}: ${error}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  missions: {
    list: (page = 1, perPage = 20, status?: string) =>
      request<ListMissionsResponse>(`/api/v1/missions?page=${page}&per_page=${perPage}${status ? `&status=${status}` : ''}`),

    get: (id: string) => request<Mission>(`/api/v1/missions/${id}`),

    create: (data: { objective: string; metadata?: Record<string, unknown> }) =>
      request<Mission>('/api/v1/missions', { method: 'POST', body: JSON.stringify(data) }),

    update: (id: string, data: { status?: string; phase?: string }) =>
      request<Mission>(`/api/v1/missions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

    delete: (id: string) => request<void>(`/api/v1/missions/${id}`, { method: 'DELETE' }),
  },

  graph: {
    get: (missionId: string, branchId?: string) =>
      request<GraphResponse>(`/api/v1/missions/${missionId}/graph${branchId ? `?branch_id=${branchId}` : ''}`),

    snapshots: (missionId: string, offset = 0, limit = 50, branchId?: string) =>
      request<SnapshotsResponse>(`/api/v1/missions/${missionId}/graph/snapshots?offset=${offset}&limit=${limit}${branchId ? `&branch_id=${branchId}` : ''}`),
  },

  replay: {
    get: (missionId: string, branchId?: string) =>
      request<ReplayStateResponse>(`/api/v1/missions/${missionId}/replay${branchId ? `?branch_id=${branchId}` : ''}`),
    branches: (missionId: string) => request<BranchesResponse>(`/api/v1/missions/${missionId}/replay/branches`),
    createBranch: (missionId: string, data: { name?: string; source_branch_id?: string; forked_from_sequence_num?: number; metadata?: Record<string, unknown> }) =>
      request<{ branch: ReplayBranch; job: unknown }>(`/api/v1/missions/${missionId}/replay/branches`, { method: 'POST', body: JSON.stringify(data) }),
    jobs: (missionId: string) => request<{ jobs: unknown[] }>(`/api/v1/missions/${missionId}/branch-jobs`),
    jobLogs: (missionId: string, jobId: string) => request<{ job: unknown, logs: unknown[] }>(`/api/v1/missions/${missionId}/branch-jobs/${jobId}`),
  },

  events: {
    list: (missionId: string, branchId?: string) =>
      request<EventsResponse>(`/api/v1/missions/${missionId}/events${branchId ? `?branch_id=${branchId}` : ''}`),
  },

  reviews: {
    list: (missionId: string) => request<Review[]>(`/api/v1/missions/${missionId}/reviews`),

    create: (missionId: string, data: { status?: string; body?: string }) =>
      request<Review>(`/api/v1/missions/${missionId}/reviews`, { method: 'POST', body: JSON.stringify(data) }),
  },

  comments: {
    list: (missionId: string, targetType?: string, targetId?: string) => {
      const url = `/api/v1/missions/${missionId}/comments`;
      const params = new URLSearchParams();
      if (targetType) params.set('target_type', targetType);
      if (targetId) params.set('target_id', targetId);
      const qs = params.toString();
      return request<Comment[]>(qs ? `${url}?${qs}` : url);
    },

    create: (missionId: string, data: {
      body: string;
      review_id?: string;
      parent_id?: string;
      target_type?: string;
      target_id?: string;
      target_context?: Record<string, unknown>;
    }) =>
      request<Comment>(`/api/v1/missions/${missionId}/comments`, { method: 'POST', body: JSON.stringify(data) }),

    resolve: (missionId: string, commentId: string) =>
      request<{ status: string }>(`/api/v1/missions/${missionId}/comments/${commentId}/resolve`, { method: 'PATCH' }),
  },

  semantic: {
    summaries: (missionId: string, level?: string, branchId?: string) => {
      const params = new URLSearchParams();
      if (level) params.append('level', level);
      if (branchId) params.append('branch_id', branchId);
      const query = params.toString();
      return request<SemanticSummaryResult[]>(`/api/v1/missions/${missionId}/summary${query ? `?${query}` : ''}`);
    },

    generate: (missionId: string, branchId?: string) => {
      const query = branchId ? `?branch_id=${branchId}` : '';
      return request<SemanticSummaryResult>(`/api/v1/missions/${missionId}/summary/generate${query}`, { method: 'POST' });
    },

    whyThisState: (missionId: string, data: { sequence_num: number; branch_id?: string }) =>
      request<SemanticSummaryResult>(`/api/v1/missions/${missionId}/why-this-state`, { method: 'POST', body: JSON.stringify(data) }),

    whyThisStateDemo: (data: {
      missionId: string;
      phase?: string;
      eventDescription?: string;
      agentStates: Array<{ name: string; role: string; status: string; summary?: string }>;
      pendingInterrupts: number;
    }) =>
      request<SemanticSummaryResult>('/api/why-this-state', { method: 'POST', body: JSON.stringify(data) }),
  },

  runtimeSummary: {
    get: (missionId: string, options?: { branchId?: string; sequenceNum?: number; enhance?: boolean }) => {
      const params = new URLSearchParams();
      if (options?.branchId) params.append('branch_id', options.branchId);
      if (options?.sequenceNum !== undefined) params.append('sequence_num', String(options.sequenceNum));
      if (options?.enhance) params.append('enhance', 'true');
      const query = params.toString();
      return request<RuntimeSummary>(`/api/v1/missions/${missionId}/runtime-summary${query ? `?${query}` : ''}`);
    },

    enhance: (missionId: string, branchId?: string) => {
      const query = branchId ? `?branch_id=${branchId}` : '';
      return request<RuntimeSummary>(`/api/v1/missions/${missionId}/runtime-summary/enhance${query}`, { method: 'POST' });
    },
  },

  nodeProjection: {
    get: (missionId: string, agentId: string, options?: { branchId?: string; sequenceNum?: number }) => {
      const params = new URLSearchParams();
      if (options?.branchId) params.append('branch_id', options.branchId);
      if (options?.sequenceNum !== undefined) params.append('sequence_num', String(options.sequenceNum));
      const query = params.toString();
      return request<RuntimeNodeProjection>(`/api/v1/missions/${missionId}/nodes/${agentId}/projection${query ? `?${query}` : ''}`);
    },

    enhance: (missionId: string, agentId: string, options?: { branchId?: string; sequenceNum?: number }) => {
      const params = new URLSearchParams();
      if (options?.branchId) params.append('branch_id', options.branchId);
      if (options?.sequenceNum !== undefined) params.append('sequence_num', String(options.sequenceNum));
      const query = params.toString();
      return request<RuntimeNodeProjection>(`/api/v1/missions/${missionId}/nodes/${agentId}/projection/enhance${query ? `?${query}` : ''}`, { method: 'POST' });
    },
  },

  ingest: {
    otlp: (data: unknown) => request<{ accepted: number; mission_id: string; snapshot_sequence?: number }>('/api/v1/ingest/otlp', { method: 'POST', body: JSON.stringify(data) }),
  },

  interrupts: {
    list: (missionId: string, status?: string, branchId?: string) => {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (branchId) params.append('branch_id', branchId);
      const query = params.toString();
      return request<InterruptsResponse>(`/api/v1/missions/${missionId}/interrupts${query ? `?${query}` : ''}`);
    },

    decide: (missionId: string, interruptId: string, data: { decision: string; comment?: string; payload?: Record<string, unknown>; idempotency_key: string }, branchId?: string) => {
      const query = branchId ? `?branch_id=${branchId}` : '';
      return request<InterruptRecord>(`/api/v1/missions/${missionId}/interrupts/${interruptId}/decision${query}`, { method: 'POST', body: JSON.stringify(data) });
    },
  },

  sharing: {
    share: (missionId: string, data: { user_email: string; permission: string; encrypted_key: string }) =>
      request<Record<string, unknown>>(`/api/v1/missions/${missionId}/share`, { method: 'POST', body: JSON.stringify(data) }),

    list: (missionId: string) => request<Record<string, unknown>[]>(`/api/v1/missions/${missionId}/shares`),
  },

  audit: {
    events: (missionId: string, branchId?: string, sequenceNum?: number) => {
      const params = new URLSearchParams();
      if (branchId) params.append('branch_id', branchId);
      if (sequenceNum !== undefined) params.append('sequence_num', String(sequenceNum));
      const query = params.toString();
      return request<MissionAuditEventResponse>(`/api/v1/missions/${missionId}/audit/events${query ? `?${query}` : ''}`);
    },
    verify: (missionId: string) =>
      request<AuditIntegrityReport>(`/api/v1/missions/${missionId}/audit/verify`),
  },
};
