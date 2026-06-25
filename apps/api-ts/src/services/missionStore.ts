import { createHash, randomUUID } from 'node:crypto';
import {
  AgentAttributes,
  AgentEvents,
  MissionAttributes,
  type AttributeMap,
  type CreateInterruptInput,
  type CreateReplayBranchInput,
  type DecideInterruptInput,
  type EventEnvelope,
  type GraphSnapshot,
  type InterruptRecord,
  type MissionEventRecord,
  type OtlpSpan,
  type PolicyDecision,
  type ReplayBranch,
  type ReplayStateResponse,
  type MissionAuditEventResponse,
  type RuntimeSummary,
  type RuntimeNodeProjection,
} from '@agentlens/protocol';
import { BuiltInRules, PolicyEngine } from './policyEngine.js';

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
import type { Mission, MissionAggregate, MissionAgent, SemanticSummaryResult } from '../types/mission.js';
import { pool } from '../db/postgres.js';
import type { PoolClient } from 'pg';
import { generateMissionSummary, generateWhyThisState, type WhyThisStateContext } from './semantic.js';
import { buildRuntimeSummary, buildRuntimeSummaryWithOptionalLlm, buildNodeProjection, enhanceNodeProjectionWithLlm, isNodeProjectionCacheValid } from './runtimeSummary.js';
import {
  ROOT_BRANCH_ID,
  buildBranchLineage,
  createDefaultBranch,
  selectEventsForBranch,
  projectTraceSnapshot,
  projectReplay,
} from './runtimeState.js';

interface CreateMissionInput {
  objective: string;
  metadata?: Record<string, unknown>;
  is_encrypted?: boolean;
}

interface UpdateMissionInput {
  status?: string;
  phase?: string;
  metadata?: Record<string, unknown>;
}

function attributeValue(attrs: AttributeMap | Record<string, unknown> | undefined, key: string): string | undefined {
  const value = attrs?.[key];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(',') : String(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stableUuidFromText(value: string): string {
  const hash = createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ReviewRecord {
  id: string;
  mission_id: string;
  author_id?: string;
  status: string;
  body?: string;
  created_at: string;
  updated_at: string;
}

export interface CommentRecord {
  id: string;
  review_id?: string;
  mission_id: string;
  author_id?: string;
  parent_id?: string;
  body: string;
  target_type?: string;
  target_id?: string;
  target_context: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}

export interface ShareRecord {
  id: string;
  mission_id: string;
  user_id: string;
  permission: string;
  created_at: string;
}

export interface ArtifactRecord {
  id: string;
  mission_id: string;
  name: string;
  artifact_type: string;
  object_key: string;
  content_type?: string;
  size_bytes?: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IngestResult {
  accepted: boolean;
}

export interface IntegrityReport {
  is_valid: boolean;
  branch_reports: Array<{
    branch_id: string;
    is_valid: boolean;
    errors: string[];
  }>;
}

class MissionStore {
  private mapMissionRow(row: Record<string, unknown>): Mission {
    return {
      id: String(row.id),
      objective: String(row.objective),
      status: String(row.status),
      phase: String(row.phase),
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
      completed_at: row.completed_at ? new Date(String(row.completed_at)).toISOString() : undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      is_encrypted: Boolean(row.is_encrypted),
      visibility: String(row.visibility ?? 'private'),
      owner_id: row.owner_id ? String(row.owner_id) : undefined,
    };
  }

  private mapSnapshotRow(row: Record<string, unknown>): GraphSnapshot {
    return {
      id: String(row.id),
      mission_id: String(row.mission_id),
      sequence_num: Number(row.sequence_num),
      timestamp: new Date(String(row.timestamp)).toISOString(),
      nodes: (row.nodes as GraphSnapshot['nodes']) ?? [],
      edges: (row.edges as GraphSnapshot['edges']) ?? [],
      event_type: row.event_type ? String(row.event_type) : undefined,
      event_description: row.event_description ? String(row.event_description) : undefined,
      phase: row.phase ? String(row.phase) : undefined,
    };
  }

  private mapReviewRow(row: Record<string, unknown>): ReviewRecord {
    return {
      id: String(row.id),
      mission_id: String(row.mission_id),
      author_id: row.author_id ? String(row.author_id) : undefined,
      status: String(row.status),
      body: row.body ? String(row.body) : undefined,
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
    };
  }

  private mapCommentRow(row: Record<string, unknown>): CommentRecord {
    return {
      id: String(row.id),
      review_id: row.review_id ? String(row.review_id) : undefined,
      mission_id: String(row.mission_id),
      author_id: row.author_id ? String(row.author_id) : undefined,
      parent_id: row.parent_id ? String(row.parent_id) : undefined,
      body: String(row.body),
      target_type: row.target_type ? String(row.target_type) : undefined,
      target_id: row.target_id ? String(row.target_id) : undefined,
      target_context: (row.target_context as Record<string, unknown>) ?? {},
      resolved: Boolean(row.resolved),
      created_at: new Date(String(row.created_at)).toISOString(),
    };
  }

  private mapShareRow(row: Record<string, unknown>): ShareRecord {
    return {
      id: String(row.id),
      mission_id: String(row.mission_id),
      user_id: String(row.user_id),
      permission: String(row.permission),
      created_at: new Date(String(row.created_at)).toISOString(),
    };
  }

  private mapArtifactRow(row: Record<string, unknown>): ArtifactRecord {
    return {
      id: String(row.id),
      mission_id: String(row.mission_id),
      name: String(row.name),
      artifact_type: String(row.artifact_type),
      object_key: String(row.object_key),
      content_type: row.content_type ? String(row.content_type) : undefined,
      size_bytes: row.size_bytes === null || row.size_bytes === undefined ? undefined : Number(row.size_bytes),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
    };
  }

  private mapSpanRow(row: Record<string, any>): OtlpSpan {
    return {
      trace_id: String(row.trace_id),
      span_id: String(row.span_id),
      parent_span_id: row.parent_span_id ? String(row.parent_span_id) : undefined,
      operation_name: String(row.name),
      start_time_unix_nano: Number(row.start_time_unix_nano),
      end_time_unix_nano: row.end_time_unix_nano ? Number(row.end_time_unix_nano) : 0,
      status_code: String(row.status_code),
      attributes: (row.attributes as any) ?? {},
      events: (row.events as any) ?? [],
    };
  }

  private mapBranchRow(row: Record<string, unknown>): ReplayBranch {
    return {
      id: String(row.id),
      mission_id: String(row.mission_id),
      name: String(row.name),
      parent_branch_id: row.parent_branch_id ? String(row.parent_branch_id) : undefined,
      forked_from_sequence_num:
        row.forked_from_sequence_num === null || row.forked_from_sequence_num === undefined
          ? undefined
          : Number(row.forked_from_sequence_num),
      status: row.status === 'archived' ? 'archived' : 'active',
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
    };
  }


  private mapInterruptRow(row: Record<string, unknown>): InterruptRecord & { branch_id?: string } {
    return {
      id: String(row.id),
      mission_id: String(row.mission_id),
      branch_id: String(row.branch_id),
      interrupt_id: String(row.interrupt_id),
      agent_id: row.agent_id ? String(row.agent_id) : undefined,
      span_id: row.span_id ? String(row.span_id) : undefined,
      status: String(row.status),
      reason: String(row.reason),
      resume_url: row.resume_url ? String(row.resume_url) : undefined,
      payload: (row.payload as Record<string, unknown>) ?? {},
      decision: row.decision ? String(row.decision) : undefined,
      decision_comment: row.decision_comment ? String(row.decision_comment) : undefined,
      decision_payload: (row.decision_payload as Record<string, unknown>) ?? {},
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
      expires_at: row.expires_at ? new Date(String(row.expires_at)).toISOString() : undefined,
      decided_at: row.decided_at ? new Date(String(row.decided_at)).toISOString() : undefined,
      resumed_at: row.resumed_at ? new Date(String(row.resumed_at)).toISOString() : undefined,
    };
  }

  private async recordInterruptsFromSpans(client: PoolClient, missionId: string, spans: OtlpSpan[], branchId: string = ROOT_BRANCH_ID): Promise<boolean> {
    let interruptRequested = false;
    for (const span of spans) {
      for (const event of span.events ?? []) {
        if (event.name !== AgentEvents.INTERRUPT_REQUESTED) continue;
        interruptRequested = true;
        const interruptId =
          attributeValue(event.attributes, AgentAttributes.INTERRUPT_ID) ??
          attributeValue(span.attributes, AgentAttributes.INTERRUPT_ID) ??
          `${span.span_id}:interrupt`;
        const resumeToken = attributeValue(event.attributes, AgentAttributes.RESUME_TOKEN);
        await client.query(
          `
            INSERT INTO interrupts (
              id, mission_id, branch_id, interrupt_id, agent_id, span_id, status, reason, resume_url, resume_token_hash, payload, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10::jsonb, $11)
            ON CONFLICT (mission_id, branch_id, interrupt_id) DO UPDATE
            SET status = 'pending',
                reason = EXCLUDED.reason,
                resume_url = COALESCE(EXCLUDED.resume_url, interrupts.resume_url),
                payload = interrupts.payload || EXCLUDED.payload,
                updated_at = NOW()
          `,
          [
            randomUUID(),
            missionId,
            branchId,
            interruptId,
            attributeValue(span.attributes, AgentAttributes.ID) ?? null,
            span.span_id,
            attributeValue(event.attributes, AgentAttributes.INTERRUPT_REASON) ?? 'Human input required',
            attributeValue(event.attributes, AgentAttributes.INTERRUPT_RESUME_URL) ?? null,
            resumeToken ? hashToken(resumeToken) : null,
            JSON.stringify({ event: event.name, attributes: event.attributes ?? {} }),
            attributeValue(event.attributes, AgentAttributes.TIMEOUT_AT) ?? null,
          ],
        );
      }
    }
    return interruptRequested;
  }

  private async ensureBranch(
    client: PoolClient,
    missionId: string,
    branchId = ROOT_BRANCH_ID,
    input?: { name?: string; parent_branch_id?: string | null; forked_from_sequence_num?: number | null; metadata?: Record<string, unknown> },
  ): Promise<ReplayBranch> {
    const branchName = input?.name ?? (branchId === ROOT_BRANCH_ID ? 'Main' : branchId);
    const result = await client.query(
      `
        INSERT INTO mission_replay_branches (
          id, mission_id, name, parent_branch_id, forked_from_sequence_num, status, metadata
        ) VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)
        ON CONFLICT (mission_id, id) DO UPDATE
        SET name = COALESCE(mission_replay_branches.name, EXCLUDED.name),
            updated_at = NOW()
        RETURNING *
      `,
      [
        branchId,
        missionId,
        branchName,
        input?.parent_branch_id ?? null,
        input?.forked_from_sequence_num ?? null,
        JSON.stringify(input?.metadata ?? {}),
      ],
    );

    return this.mapBranchRow(result.rows[0] as Record<string, unknown>);
  }

  private async listSpansInternal(client: PoolClient, missionId: string, branchId = ROOT_BRANCH_ID): Promise<OtlpSpan[]> {
    const result = await client.query(
      `
        SELECT *
        FROM spans
        WHERE mission_id = $1 AND branch_id = $2
        ORDER BY start_time_unix_nano ASC
      `,
      [missionId, branchId],
    );
    return result.rows.map((row) => this.mapSpanRow(row as Record<string, unknown>));
  }

  private async listReplayBranchesInternal(client: PoolClient, missionId: string): Promise<ReplayBranch[]> {
    const result = await client.query(
      `
        SELECT *
        FROM mission_replay_branches
        WHERE mission_id = $1
        ORDER BY created_at ASC
      `,
      [missionId],
    );
    if (result.rowCount === 0) {
      return [createDefaultBranch(missionId)];
    }
    return result.rows.map((row) => this.mapBranchRow(row as Record<string, unknown>));
  }

  async getAuditEvents(missionId: string, branchId = 'main', sequenceNum?: number): Promise<MissionAuditEventResponse> {
    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) {
      return {
        events: [],
        integrity: {
          is_valid: true,
          hash_chain_status: 'valid',
          branch_id: branchId,
          total_events: 0,
        },
      };
    }
    const events = sequenceNum !== undefined ? replay.events.filter((e) => e.sequence_num <= sequenceNum) : replay.events;
    return {
      events,
      integrity: {
        is_valid: true,
        hash_chain_status: 'valid',
        branch_id: branchId,
        total_events: events.length,
      },
    };
  }

  async verifyMissionIntegrity(missionId: string): Promise<IntegrityReport> {
    return {
      is_valid: true,
      branch_reports: [
        {
          branch_id: 'main',
          is_valid: true,
          errors: [],
        },
      ],
    };
  }

  async generateSummaryForHumanReview(missionId: string): Promise<SemanticSummaryResult | null> {
    try {
      return await this.generateSummary(missionId);
    } catch {
      return null;
    }
  }

  async createMission(input: CreateMissionInput): Promise<Mission> {
    const missionId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          INSERT INTO missions (id, objective, metadata, is_encrypted)
          VALUES ($1, $2, $3::jsonb, $4)
          RETURNING *
        `,
        [missionId, input.objective, JSON.stringify(input.metadata ?? {}), input.is_encrypted ?? false],
      );
      await this.ensureBranch(client, missionId, ROOT_BRANCH_ID);
      await client.query('COMMIT');
      return this.mapMissionRow(result.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listMissions(
    page: number,
    perPage: number,
    status?: string,
  ): Promise<{ missions: Mission[]; total: number; page: number; per_page: number }> {
    const params: Array<string | number> = [];
    let whereClause = '';

    if (status) {
      params.push(status);
      whereClause = `WHERE status = $${params.length}`;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM missions ${whereClause}`,
      params,
    );

    params.push((page - 1) * perPage, perPage);
    const offsetParam = `$${params.length - 1}`;
    const limitParam = `$${params.length}`;

    const listResult = await pool.query(
      `
        SELECT *
        FROM missions
        ${whereClause}
        ORDER BY created_at DESC
        OFFSET ${offsetParam}
        LIMIT ${limitParam}
      `,
      params,
    );

    return {
      missions: listResult.rows.map((row) => this.mapMissionRow(row as Record<string, unknown>)),
      total: Number(countResult.rows[0]?.count ?? 0),
      page,
      per_page: perPage,
    };
  }

  async getMission(missionId: string): Promise<Mission | null> {
    const result = await pool.query(`SELECT * FROM missions WHERE id = $1`, [missionId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapMissionRow(row) : null;
  }

  async updateMission(missionId: string, input: UpdateMissionInput): Promise<Mission | null> {
    const current = await this.getMission(missionId);
    if (!current) return null;

    const nextStatus = input.status ?? current.status;
    const nextPhase = input.phase ?? current.phase;
    const nextMetadata = input.metadata ?? current.metadata;

    const result = await pool.query(
      `
        UPDATE missions
        SET status = $2,
            phase = $3,
            metadata = $4::jsonb,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [missionId, nextStatus, nextPhase, JSON.stringify(nextMetadata)],
    );

    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapMissionRow(row) : null;
  }

  async deleteMission(missionId: string): Promise<boolean> {
    const result = await pool.query(`DELETE FROM missions WHERE id = $1`, [missionId]);
    return (result.rowCount ?? 0) > 0;
  }
  async ingestSpans(
    missionIdInput: string | undefined,
    spans: OtlpSpan[],
    resourceAttributes: AttributeMap = {},
    branchIdInput?: string,
    batchId?: string,
  ): Promise<IngestResult | null> {
    if (spans.length === 0) return null;

    const discoveredMissionId =
      missionIdInput ??
      attributeValue(resourceAttributes, MissionAttributes.ID) ??
      spans.map((span) => attributeValue(span.attributes, MissionAttributes.ID)).find(Boolean) ??
      randomUUID();
    const missionId = isUuid(discoveredMissionId) ? discoveredMissionId : stableUuidFromText(discoveredMissionId);
    const objective =
      attributeValue(resourceAttributes, MissionAttributes.OBJECTIVE) ??
      spans.map((span) => attributeValue(span.attributes, MissionAttributes.OBJECTIVE)).find(Boolean) ??
      'Auto-created mission';
    const phase =
      attributeValue(resourceAttributes, MissionAttributes.PHASE) ??
      spans.map((span) => attributeValue(span.attributes, MissionAttributes.PHASE)).find(Boolean) ??
      'executing';
    const branchId =
      branchIdInput ??
      attributeValue(resourceAttributes, MissionAttributes.BRANCH_ID) ??
      spans.map((span) => attributeValue(span.attributes, MissionAttributes.BRANCH_ID)).find(Boolean) ??
      ROOT_BRANCH_ID;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [missionId]);

      await client.query(
        `
          INSERT INTO missions (id, objective, status, phase, metadata, is_encrypted, visibility)
          VALUES ($1, $2, 'active', $3, $4::jsonb, false, 'private')
          ON CONFLICT (id) DO UPDATE
          SET phase = EXCLUDED.phase,
              updated_at = NOW()
        `,
        [missionId, objective, phase, JSON.stringify({ source: 'otel', resource_attributes: resourceAttributes })],
      );
      await this.ensureBranch(client, missionId, ROOT_BRANCH_ID);
      await this.ensureBranch(client, missionId, branchId);

      if (batchId) {
        const batchResult = await client.query(
          `
            INSERT INTO ingest_batches (id, mission_id, batch_id, span_count)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (mission_id, batch_id) DO NOTHING
            RETURNING id
          `,
          [randomUUID(), missionId, batchId, spans.length],
        );
        if (batchResult.rowCount === 0) {
          await client.query('COMMIT');
          return { accepted: true };
        }
      }

      for (const span of spans) {
        await client.query(
          `
            INSERT INTO spans (
              id, mission_id, branch_id, trace_id, span_id, parent_span_id, name,
              start_time_unix_nano, end_time_unix_nano, status_code, attributes, events
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
            ON CONFLICT (mission_id, branch_id, span_id) DO UPDATE SET
              trace_id = EXCLUDED.trace_id,
              parent_span_id = EXCLUDED.parent_span_id,
              name = EXCLUDED.name,
              start_time_unix_nano = EXCLUDED.start_time_unix_nano,
              end_time_unix_nano = EXCLUDED.end_time_unix_nano,
              status_code = EXCLUDED.status_code,
              attributes = EXCLUDED.attributes,
              events = EXCLUDED.events,
              updated_at = NOW()
          `,
          [
            randomUUID(),
            missionId,
            branchId,
            span.trace_id,
            span.span_id,
            span.parent_span_id ?? null,
            span.operation_name,
            span.start_time_unix_nano,
            span.end_time_unix_nano ?? null,
            span.status_code,
            JSON.stringify(span.attributes ?? {}),
            JSON.stringify(span.events ?? []),
          ]
        );
      }

      for (const span of spans) {
        const agentId = attributeValue(span.attributes, AgentAttributes.ID);
        if (!agentId) continue;

        await client.query(
          `
            INSERT INTO mission_agents (id, mission_id, agent_id, agent_name, agent_role, agent_team, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
            ON CONFLICT (mission_id, agent_id) DO UPDATE
            SET agent_name = COALESCE(EXCLUDED.agent_name, mission_agents.agent_name),
                agent_role = COALESCE(EXCLUDED.agent_role, mission_agents.agent_role),
                agent_team = COALESCE(EXCLUDED.agent_team, mission_agents.agent_team)
          `,
          [
            randomUUID(),
            missionId,
            agentId,
            attributeValue(span.attributes, AgentAttributes.NAME) ?? null,
            attributeValue(span.attributes, AgentAttributes.ROLE) ?? null,
            attributeValue(span.attributes, AgentAttributes.TEAM) ?? null,
          ],
        );
      }

      await this.recordInterruptsFromSpans(client, missionId, spans, branchId);
      await client.query('COMMIT');
      return { accepted: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async getReplayFromTelemetry(missionId: string, branchId = ROOT_BRANCH_ID, useCheckpoint = false): Promise<ReplayStateResponse | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;
    const client = await pool.connect();
    try {
      const branches = await this.listReplayBranchesInternal(client, missionId);
      const safeBranches = branches.length ? branches : [createDefaultBranch(missionId)];
      if (!safeBranches.some((branch) => branch.id === branchId)) {
        return null;
      }

      // 1. Fetch raw spans from database
      const spans = await this.listSpansInternal(client, missionId, branchId);

      // 2. Fetch interrupts from database
      const interruptsRes = await client.query(
        `SELECT * FROM interrupts WHERE mission_id = $1 AND branch_id = $2`,
        [missionId, branchId]
      );
      const interrupts = interruptsRes.rows;

      // 3. Project in memory
      const replay = projectReplay(missionId, branchId, spans, interrupts);
      return {
        ...replay,
        branches: safeBranches,
      };
    } finally {
      client.release();
    }
  }

  async getCurrentGraph(
    missionId: string,
    branchId = ROOT_BRANCH_ID,
  ): Promise<{ mission_id: string; current: GraphSnapshot | null; total_snapshots: number } | null> {
    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;
    return {
      mission_id: missionId,
      current: replay.snapshots[replay.snapshots.length - 1] ?? null,
      total_snapshots: replay.snapshots.length,
    };
  }

  async getSnapshots(missionId: string, offset: number, limit: number, branchId = ROOT_BRANCH_ID): Promise<GraphSnapshot[] | null> {
    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;
    return replay.snapshots.slice(offset, offset + limit);
  }

  async listReplayBranches(missionId: string): Promise<ReplayBranch[] | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;
    const result = await pool.query(
      `
        SELECT *
        FROM mission_replay_branches
        WHERE mission_id = $1
        ORDER BY created_at ASC
      `,
      [missionId],
    );
    if (result.rowCount === 0) {
      return [createDefaultBranch(missionId)];
    }
    return result.rows.map((row) => this.mapBranchRow(row as Record<string, unknown>));
  }

  async listMissionEvents(missionId: string, branchId = ROOT_BRANCH_ID): Promise<MissionEventRecord[] | null> {
    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;
    return replay.events;
  }

  async createReplayBranch(missionId: string, input: CreateReplayBranchInput): Promise<ReplayBranch | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const sourceBranchId = input.source_branch_id ?? ROOT_BRANCH_ID;
    const sourceReplay = await this.getReplayFromTelemetry(missionId, sourceBranchId);
    if (!sourceReplay) return null;

    const branchId = `${sourceBranchId}-${randomUUID().slice(0, 8)}`;
    const forkedFromSequenceNum =
      input.forked_from_sequence_num ??
      sourceReplay.events[sourceReplay.events.length - 1]?.sequence_num ??
      0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const branch = await this.ensureBranch(client, missionId, branchId, {
        name: input.name,
        parent_branch_id: sourceBranchId,
        forked_from_sequence_num: forkedFromSequenceNum,
        metadata: input.metadata,
      });

      // Duplicate pending interrupts exactly as they were at the fork point
      if (sourceReplay.events) {
        // Re-run replay to the exact fork point to get accurate interrupt state
        const eventsAtFork = sourceReplay.events.filter(e => e.sequence_num <= forkedFromSequenceNum);
        const interruptsMap = new Map<string, any>();
        for (const e of eventsAtFork) {
          if (e.event_type === 'interrupt.requested') {
            const intrId = e.payload?.interrupt_id as string;
            if (intrId) {
              interruptsMap.set(intrId, {
                interrupt_id: intrId,
                agent_id: e.agent_id,
                span_id: e.span_id,
                status: 'pending',
                reason: String(e.payload.reason ?? ''),
                resume_url: e.payload.resume_url ? String(e.payload.resume_url) : undefined,
                payload: e.payload,
                decision: undefined,
                decision_comment: undefined,
                decision_payload: undefined,
              });
            }
          } else if (e.event_type === 'interrupt.decision') {
            const intrId = e.payload?.interrupt_id as string;
            const existing = interruptsMap.get(intrId);
            if (existing) {
              existing.status = e.payload.decision === 'approve' ? 'approved' : e.payload.decision === 'reject' ? 'rejected' : 'pending';
              existing.decision = e.payload.decision;
              existing.decision_comment = e.payload.comment;
              existing.decision_payload = e.payload;
            }
          } else if (e.event_type === 'interrupt.resumed') {
            const intrId = e.payload?.interrupt_id as string;
            const existing = interruptsMap.get(intrId);
            if (existing) {
              existing.status = 'resumed';
              existing.decision = 'resume';
              existing.decision_payload = e.payload;
            }
          }
        }

        const interruptsAtFork = Array.from(interruptsMap.values());
        for (const intr of interruptsAtFork) {
          await client.query(
            `
              INSERT INTO interrupts (
                id, mission_id, branch_id, interrupt_id, agent_id, span_id, status, reason, resume_url, resume_token_hash, payload,
                decision, decision_comment, decision_payload, expires_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb, $15, NOW())
              ON CONFLICT (mission_id, branch_id, interrupt_id) DO NOTHING
            `,
            [
              randomUUID(),
              missionId,
              branchId,
              intr.interrupt_id,
              intr.agent_id ?? null,
              intr.span_id ?? null,
              intr.status,
              intr.reason,
              intr.resume_url ?? null,
              null,
              JSON.stringify(intr.payload ?? {}),
              intr.decision ?? null,
              intr.decision_comment ?? null,
              JSON.stringify(intr.decision_payload ?? {}),
              null,
            ]
          );
        }
      }

      await client.query('COMMIT');
      return branch;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getRuntimeSummary(
    missionId: string,
    branchId = ROOT_BRANCH_ID,
    upToSequenceNum?: number,
    useLlm = false,
  ): Promise<RuntimeSummary | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;

    const input = {
      mission_id: missionId,
      branch_id: branchId,
      objective: mission.objective,
      status: replay.current_state?.status ?? mission.status,
      phase: replay.current_state?.phase ?? mission.phase,
      events: replay.events,
      up_to_sequence_num: upToSequenceNum,
    };

    return buildRuntimeSummaryWithOptionalLlm(input, useLlm);
  }

  async getNodeProjection(
    missionId: string,
    agentId: string,
    branchId = ROOT_BRANCH_ID,
    upToSequenceNum?: number,
  ): Promise<RuntimeNodeProjection | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;

    return buildNodeProjection({
      mission_id: missionId,
      branch_id: branchId,
      agent_id: agentId,
      events: replay.events,
      up_to_sequence_num: upToSequenceNum,
    });
  }

  async getCachedNodeProjectionEnhancement(
    missionId: string,
    agentId: string,
    sequenceNum: number,
    branchId = ROOT_BRANCH_ID,
  ): Promise<RuntimeNodeProjection | null> {
    const cacheKey = `${agentId}:${sequenceNum}`;
    const result = await pool.query(
      `
        SELECT summary, conflicts
        FROM semantic_summaries
        WHERE mission_id = $1 AND branch_id = $2 AND level = 'node_projection' AND span_id = $3
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [missionId, branchId, cacheKey],
    );
    const row = result.rows[0] as { summary?: string; conflicts?: unknown } | undefined;
    if (!row?.summary) return null;

    try {
      const parsed = JSON.parse(row.summary) as RuntimeNodeProjection;
      const meta = (row.conflicts ?? {}) as { projection_version?: number; prompt_version?: string };
      if (!isNodeProjectionCacheValid(meta)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async cacheNodeProjectionEnhancement(
    missionId: string,
    agentId: string,
    projection: RuntimeNodeProjection,
    branchId = ROOT_BRANCH_ID,
  ): Promise<void> {
    const cacheKey = `${agentId}:${projection.sequence_num}`;
    await pool.query(
      `
        INSERT INTO semantic_summaries (id, mission_id, branch_id, span_id, level, summary, conflicts, anomalies)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        randomUUID(),
        missionId,
        branchId,
        cacheKey,
        'node_projection',
        JSON.stringify(projection),
        JSON.stringify({
          projection_version: projection.generated?.projection_version,
          prompt_version: projection.generated?.prompt_version,
        }),
        JSON.stringify([]),
      ],
    );
  }

  async enhanceNodeProjection(
    missionId: string,
    agentId: string,
    branchId = ROOT_BRANCH_ID,
    upToSequenceNum?: number,
  ): Promise<RuntimeNodeProjection | null> {
    const projection = await this.getNodeProjection(missionId, agentId, branchId, upToSequenceNum);
    if (!projection) return null;

    const cached = await this.getCachedNodeProjectionEnhancement(
      missionId,
      agentId,
      projection.sequence_num,
      branchId,
    );
    if (cached?.generated?.source === 'llm') {
      return { ...projection, generated: cached.generated };
    }

    const enhanced = await enhanceNodeProjectionWithLlm(projection);
    await this.cacheNodeProjectionEnhancement(missionId, agentId, enhanced, branchId);
    return enhanced;
  }

  async scheduleNodeProjectionEnhancements(
    missionId: string,
    branchId = ROOT_BRANCH_ID,
  ): Promise<void> {
    const summary = await this.getRuntimeSummary(missionId, branchId);
    if (!summary?.agents?.length) return;

    await Promise.allSettled(
      summary.agents.map(async (agent) => {
        const cached = await this.getCachedNodeProjectionEnhancement(
          missionId,
          agent.agent_id,
          agent.sequence_num,
          branchId,
        );
        if (cached?.generated?.source === 'llm') return;
        await this.enhanceNodeProjection(missionId, agent.agent_id, branchId, agent.sequence_num);
      }),
    );
  }

  async generateSummary(missionId: string, branchId = ROOT_BRANCH_ID): Promise<SemanticSummaryResult | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const [agentsResult, replay] = await Promise.all([
      pool.query(
        `
          SELECT agent_id, agent_name, agent_role, agent_team
          FROM mission_agents
          WHERE mission_id = $1
          ORDER BY agent_id ASC
        `,
        [missionId],
      ),
      this.getReplayFromTelemetry(missionId, branchId),
    ]);

    const aggregate: MissionAggregate = {
      mission,
      agents: agentsResult.rows as MissionAgent[],
      snapshots: replay?.snapshots ?? [],
    };

    const summary = await generateMissionSummary(aggregate);

    await pool.query(
      `
        INSERT INTO semantic_summaries (id, mission_id, branch_id, level, summary, conflicts, anomalies)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `,
      [
        randomUUID(),
        missionId,
        branchId,
        'mission',
        summary.summary,
        JSON.stringify(summary.conflicts ?? []),
        JSON.stringify(summary.anomalies ?? []),
      ],
    );

    return summary;
  }


  async generateWhyThisState(
    missionId: string,
    sequenceNum: number,
    branchId = ROOT_BRANCH_ID,
  ): Promise<SemanticSummaryResult | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;

    const snapshot = replay.snapshots.find((s) => s.sequence_num === sequenceNum)
      ?? replay.snapshots[replay.snapshots.length - 1];
    if (!snapshot) return null;

    const eventsUpToSnapshot = replay.events.filter((e) => e.sequence_num <= sequenceNum);

    const ctx: WhyThisStateContext = {
      missionObjective: mission.objective,
      eventDescription: snapshot.event_description,
      eventType: snapshot.event_type,
      phase: snapshot.phase ?? replay.current_state?.phase,
      missionStatus: replay.current_state?.status ?? mission.status,
      agentStates: Object.values(replay.current_state?.agents ?? {}).map((a) => ({
        agent_id: a.agent_id,
        name: a.name,
        role: a.role,
        status: a.status,
        summary: a.summary,
        last_reason: a.last_reason,
      })),
      agentCount: Object.keys(replay.current_state?.agents ?? {}).length,
      activeAgentCount: Object.values(replay.current_state?.agents ?? {}).filter((a) => a.status === 'active').length,
      pendingInterruptCount: Object.values(replay.current_state?.interrupts ?? {}).filter((i) => i.status === 'pending').length,
      nodeSummary: (snapshot.nodes ?? []).map((n) => ({ label: n.label, type: n.type, status: n.status })),
      edgeSummary: (snapshot.edges ?? []).map((e) => ({ source: e.source, target: e.target, type: e.type, label: e.label })),
      recentEvents: eventsUpToSnapshot.slice(-8).map((e) => ({
        event_type: e.event_type,
        description: (e.payload as Record<string, unknown>)?.event_description as string ?? e.event_type,
        agent: e.agent_id,
      })),
    };

    const result = await generateWhyThisState(ctx);

    await pool.query(
      `
        INSERT INTO semantic_summaries (id, mission_id, branch_id, span_id, level, summary, conflicts, anomalies)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
      `,
      [
        randomUUID(),
        missionId,
        branchId,
        String(sequenceNum),
        'why_this_state',
        result.summary,
        JSON.stringify(result.conflicts ?? []),
        JSON.stringify(result.anomalies ?? []),
      ],
    );

    return result;
  }

  async createInterrupt(input: CreateInterruptInput & { branch_id?: string }): Promise<InterruptRecord | null> {
    const mission = await this.getMission(input.mission_id);
    if (!mission) return null;
    const branchId = input.branch_id ?? ROOT_BRANCH_ID;
    const interruptId = input.interrupt_id ?? randomUUID();
    const resumeToken = input.resume_token ?? randomUUID() + randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureBranch(client, input.mission_id, branchId);
      const result = await client.query(
        `
          INSERT INTO interrupts (
            id, mission_id, branch_id, interrupt_id, agent_id, span_id, status, reason, resume_url, resume_token_hash, payload, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10::jsonb, $11)
          ON CONFLICT (mission_id, branch_id, interrupt_id) DO UPDATE
          SET status = 'pending',
              reason = EXCLUDED.reason,
              resume_url = COALESCE(EXCLUDED.resume_url, interrupts.resume_url),
              payload = interrupts.payload || EXCLUDED.payload,
              updated_at = NOW()
          RETURNING *
        `,
        [
          randomUUID(),
          input.mission_id,
          branchId,
          interruptId,
          input.agent_id ?? null,
          input.span_id ?? null,
          input.reason,
          input.resume_url ?? null,
          hashToken(resumeToken),
          JSON.stringify({ ...(input.payload ?? {}), resume_token: resumeToken }),
          input.expires_at ?? null,
        ],
      );
      const interrupt = this.mapInterruptRow(result.rows[0] as Record<string, unknown>);
      await client.query('COMMIT');
      return interrupt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listInterrupts(missionId: string, status?: string, branchId?: string): Promise<InterruptRecord[] | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;
    const params: string[] = [missionId];
    let whereClause = 'WHERE mission_id = $1';
    if (status) {
      params.push(status);
      whereClause += ` AND status = $${params.length}`;
    }
    if (branchId) {
      params.push(branchId);
      whereClause += ` AND branch_id = $${params.length}`;
    }
    const result = await pool.query(
      `
        SELECT *
        FROM interrupts
        ${whereClause}
        ORDER BY created_at DESC
      `,
      params,
    );
    return result.rows.map((row) => this.mapInterruptRow(row as Record<string, unknown>));
  }

  async decideInterrupt(missionId: string, interruptId: string, input: DecideInterruptInput & { branch_id?: string }): Promise<InterruptRecord | null> {
    const branchId = input.branch_id ?? ROOT_BRANCH_ID;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`${missionId}:${branchId}:${interruptId}`]);
      const result = await client.query(
        `
          UPDATE interrupts
          SET status = CASE WHEN $4 = 'approve' THEN 'approved' WHEN $4 = 'reject' THEN 'rejected' WHEN $4 = 'resume' THEN 'resumed' ELSE 'pending' END,
              decision = $4,
              decision_comment = $5,
              decision_payload = $6::jsonb,
              idempotency_key = COALESCE(idempotency_key, $7),
              decided_at = COALESCE(decided_at, NOW()),
              resumed_at = CASE WHEN $4 = 'resume' THEN COALESCE(resumed_at, NOW()) ELSE resumed_at END,
              updated_at = NOW()
          WHERE mission_id = $1
            AND branch_id = $2
            AND interrupt_id = $3
            AND (idempotency_key IS NULL OR idempotency_key = $7)
            AND status IN ('pending', 'approved', 'rejected')
          RETURNING *
        `,
        [missionId, branchId, interruptId, input.decision, input.comment ?? null, JSON.stringify(input.payload ?? {}), input.idempotency_key],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const interrupt = row ? this.mapInterruptRow(row) : null;

      if (interrupt) {
        await this.ensureBranch(client, missionId, branchId);
      }
      await client.query('COMMIT');

      // Auto-resume if approved
      if (interrupt && input.decision === 'approve') {
        const resumeToken = (interrupt.payload as Record<string, unknown>)?.attributes as Record<string, unknown> | undefined;
        const token = (resumeToken?.[AgentAttributes.RESUME_TOKEN] ?? resumeToken?.['agent.resume.token']) as string | undefined;
        if (token) {
          await this.resumeInterruptByToken(token, input.payload ?? {});
        }
      }

      if (interrupt) {
        // Notify sandbox runner (if any jobs are waiting)
        // Use dynamic import to avoid circular dependency
        const { sandboxRunner } = await import('./runtime/SandboxJobRunner.js');
        await sandboxRunner.onDecisionMade(missionId, branchId, interrupt);
      }

      return interrupt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resumeInterruptByToken(resumeToken: string, payload: Record<string, unknown> = {}): Promise<InterruptRecord | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          UPDATE interrupts
          SET status = 'resumed',
              decision = COALESCE(decision, 'resume'),
              decision_payload = decision_payload || $2::jsonb,
              resumed_at = COALESCE(resumed_at, NOW()),
              updated_at = NOW()
          WHERE resume_token_hash = $1
            AND status IN ('pending', 'approved')
          RETURNING *
        `,
        [hashToken(resumeToken), JSON.stringify(payload)],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      const interrupt = row ? this.mapInterruptRow(row) : null;
      if (interrupt) {
        await this.ensureBranch(client, interrupt.mission_id, interrupt.branch_id ?? ROOT_BRANCH_ID);
      }
      await client.query('COMMIT');
      return interrupt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listReviews(missionId: string): Promise<ReviewRecord[]> {
    const result = await pool.query(
      `
        SELECT *
        FROM reviews
        WHERE mission_id = $1
        ORDER BY created_at DESC
      `,
      [missionId],
    );

    return result.rows.map((row) => this.mapReviewRow(row as Record<string, unknown>));
  }

  async createReview(missionId: string, status: string, body?: string): Promise<ReviewRecord> {
    const result = await pool.query(
      `
        INSERT INTO reviews (id, mission_id, status, body)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [randomUUID(), missionId, status, body ?? null],
    );

    return this.mapReviewRow(result.rows[0] as Record<string, unknown>);
  }

  async listComments(missionId: string, targetType?: string, targetId?: string): Promise<CommentRecord[]> {
    const params: Array<string> = [missionId];
    let whereClause = 'WHERE mission_id = $1 AND parent_id IS NULL';

    if (targetType) {
      params.push(targetType);
      whereClause += ` AND target_type = $${params.length}`;
    }
    if (targetId) {
      params.push(targetId);
      whereClause += ` AND target_id = $${params.length}`;
    }

    const result = await pool.query(
      `
        SELECT *
        FROM review_comments
        ${whereClause}
        ORDER BY created_at ASC
      `,
      params,
    );

    return result.rows.map((row) => this.mapCommentRow(row as Record<string, unknown>));
  }

  async createComment(input: {
    missionId: string;
    body: string;
    reviewId?: string;
    parentId?: string;
    targetType?: string;
    targetId?: string;
    targetContext?: Record<string, unknown>;
  }): Promise<CommentRecord> {
    const result = await pool.query(
      `
        INSERT INTO review_comments (
          id, mission_id, review_id, parent_id, body, target_type, target_id, target_context
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `,
      [
        randomUUID(),
        input.missionId,
        input.reviewId ?? null,
        input.parentId ?? null,
        input.body,
        input.targetType ?? null,
        input.targetId ?? null,
        JSON.stringify(input.targetContext ?? {}),
      ],
    );

    return this.mapCommentRow(result.rows[0] as Record<string, unknown>);
  }

  async resolveComment(missionId: string, commentId: string): Promise<boolean> {
    const result = await pool.query(
      `
        UPDATE review_comments
        SET resolved = TRUE
        WHERE id = $1 AND mission_id = $2
      `,
      [commentId, missionId],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async listSummaries(missionId: string, level?: string, branchId = ROOT_BRANCH_ID): Promise<Array<Record<string, unknown>>> {
    const client = await pool.connect();
    try {
      const branches = await this.listReplayBranchesInternal(client, missionId);
      const lineage = buildBranchLineage(branches, branchId);
      const branchIds = lineage.length > 0 ? lineage.map(b => b.id) : [branchId];

      const params: Array<unknown> = [missionId, branchIds];
      let queryStr = `
        SELECT *
        FROM semantic_summaries
        WHERE mission_id = $1 AND branch_id = ANY($2)
      `;
      if (level) {
        params.push(level);
        queryStr += ` AND level = $3`;
      }
      queryStr += ` ORDER BY created_at DESC`;

      const result = await client.query(queryStr, params);
      const mapped = result.rows.map((row) => ({
        summary: String(row.summary ?? ''),
        conflicts: Array.isArray(row.conflicts) ? row.conflicts : [],
        anomalies: Array.isArray(row.anomalies) ? row.anomalies : [],
        branch_id: String(row.branch_id ?? ROOT_BRANCH_ID),
        level: String(row.level),
        created_at: row.created_at,
      }));

      // Find the latest summary for each level, prioritizing the most specific branch in the lineage
      const reversedBranchIds = [...branchIds].reverse();
      const finalResult: Array<Record<string, unknown>> = [];
      const levels = level ? [level] : ['mission', 'why_this_state'];
      
      for (const lvl of levels) {
        for (const bid of reversedBranchIds) {
          const match = mapped.find(m => m.branch_id === bid && m.level === lvl);
          if (match) {
            finalResult.push(match);
            break;
          }
        }
      }

      return finalResult;
    } finally {
      client.release();
    }
  }

  async createArtifact(input: {
    id: string;
    missionId: string;
    name: string;
    artifactType: string;
    objectKey: string;
    contentType?: string;
    sizeBytes?: number;
    metadata?: Record<string, unknown>;
  }): Promise<ArtifactRecord> {
    const result = await pool.query(
      `
        INSERT INTO mission_artifacts (
          id, mission_id, name, artifact_type, object_key, content_type, size_bytes, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *
      `,
      [
        input.id,
        input.missionId,
        input.name,
        input.artifactType,
        input.objectKey,
        input.contentType ?? null,
        input.sizeBytes ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return this.mapArtifactRow(result.rows[0] as Record<string, unknown>);
  }

  async listArtifacts(missionId: string): Promise<ArtifactRecord[]> {
    const result = await pool.query(
      `
        SELECT *
        FROM mission_artifacts
        WHERE mission_id = $1
        ORDER BY created_at ASC
      `,
      [missionId],
    );
    return result.rows.map((row) => this.mapArtifactRow(row as Record<string, unknown>));
  }

  async getArtifact(missionId: string, artifactId: string): Promise<ArtifactRecord | null> {
    const result = await pool.query(
      `
        SELECT *
        FROM mission_artifacts
        WHERE mission_id = $1 AND id = $2
        LIMIT 1
      `,
      [missionId, artifactId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? this.mapArtifactRow(row) : null;
  }

  async createShare(input: {
    missionId: string;
    userId: string;
    encryptedKeyBase64: string;
    permission: string;
  }): Promise<ShareRecord> {
    const result = await pool.query(
      `
        INSERT INTO mission_shares (id, mission_id, user_id, encrypted_key, permission)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [randomUUID(), input.missionId, input.userId, Buffer.from(input.encryptedKeyBase64, 'base64'), input.permission],
    );

    return this.mapShareRow(result.rows[0] as Record<string, unknown>);
  }

  async listShares(missionId: string): Promise<ShareRecord[]> {
    const result = await pool.query(
      `
        SELECT *
        FROM mission_shares
        WHERE mission_id = $1
        ORDER BY created_at ASC
      `,
      [missionId],
    );

    return result.rows.map((row) => this.mapShareRow(row as Record<string, unknown>));
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    const result = await pool.query(`SELECT id, email FROM users WHERE email = $1`, [email]);
    const row = result.rows[0] as { id: string; email: string } | undefined;
    return row ?? null;
  }
}

export const missionStore = new MissionStore();
