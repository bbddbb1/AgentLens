import { createHash, randomUUID } from 'node:crypto';
import {
  AgentAttributes,
  MissionAttributes,
  type AttributeMap,
  type CreateInterruptInput,
  type CurrentGraphResponse,
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
  type RuntimeActivity,
  type RuntimeExplanationProjection,
  type RuntimeSummary,
  type RuntimeNodeProjection,
  SPAN_PROJECTION_VERSION,
} from '@agentlens/protocol';
import { eventsThroughCursor, projectRuntimeExplanation } from '@agentlens/protocol/internal';
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
import { frameworkGovernanceFor } from './interrupts/frameworkGovernance.js';
import { mapInterruptRowToRecord, serializeInterruptPublic } from './interrupts/publicSerializer.js';
import { allocateEvidenceAdmission } from './evidenceAdmission.js';
import { appendGovernanceStateHistory, governanceTransition } from './interrupts/governanceState.js';
import { validateStructuredDecisionValue } from './interrupts/structuredDecisionBounds.js';
import {
  GovernanceControlError,
  controlModeFromRow,
  effectiveFrameworkDecisionTypes,
  isExplicitLegacyControl,
} from './interrupts/controlAuthority.js';
import { applyRuntimeOutcome, ensureDeliveryAttempt } from './interrupts/deliveryLifecycle.js';
import { stripExecutableCredentials } from './interrupts/credentialIsolation.js';
import { sourceSpanKey } from './runtime/sourceIdentity.js';
import { mafInteractionFact, mafOutcomeFact, mafTraceWorkflowIds } from './runtime/normalization/mafIngestion.js';
import { langGraphInteractionFact, langGraphOutcomeFact } from './runtime/normalization/langgraphGovernance.js';
import {
  assertCurrentlyActionable,
  reconcileInterruptActionability,
} from './interrupts/reconcileActionability.js';
import {
  interruptIdsWithAmbiguousNativeIdentity,
  resolveInterruptIdentityAmbiguity,
  type StoredNativeIdentity,
} from './interrupts/nativeIdentityAmbiguity.js';
import { SEMANTIC_PRESENTATION_AUTHORITY_VERSION, generateMissionSummary, generateWhyThisState, type WhyThisStateContext } from './semantic.js';
import { buildRuntimeSummaryWithOptionalLlm, buildNodeProjection, enhanceNodeProjectionWithLlm } from './runtimeSummary.js';
import {
  ROOT_BRANCH_ID,
  buildBranchLineage,
  createDefaultBranch,
  selectEventsForBranch,
  selectInterruptsForBranch,
  selectSpanRevisionsForBranch,
  projectTraceSnapshot,
  projectReplayEvidence,
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

type StoredOtlpSpan = OtlpSpan & {
  branch_id: string;
  admission_seq: number;
  revision_num: number;
  admitted_at: string;
};

function spanEvidenceRepresentation(span: OtlpSpan): string {
  return deterministicStringify({
    trace_id: span.trace_id,
    span_id: span.span_id,
    parent_span_id: span.parent_span_id ?? null,
    operation_name: span.operation_name,
    start_time_unix_nano: String(span.start_time_unix_nano),
    end_time_unix_nano: String(span.end_time_unix_nano ?? '0'),
    status_code: span.status_code,
    attributes: span.attributes ?? {},
    events: span.events ?? [],
  });
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

function sequenceNumThroughSnapshot(
  snapshots: readonly GraphSnapshot[],
  events: readonly EventEnvelope[],
  frameIndex: number,
): number | undefined {
  void events;
  if (snapshots.length === 0) return undefined;
  const frame = Math.max(0, Math.min(frameIndex, snapshots.length - 1));
  return snapshots[frame]?.sequence_num;
}

function toCompatibilityActivity(
  activity: RuntimeExplanationProjection['activities'][number],
): RuntimeActivity {
  return {
    id: activity.id,
    kind: activity.kind,
    label: activity.title,
    title: activity.title,
    subtitle: activity.subtitle,
    action: activity.action,
    outcome:
      activity.outcome
      ?? (activity.status === 'failed' ? 'Failed'
        : activity.status === 'waiting' ? 'Waiting'
          : activity.status === 'completed' ? 'Completed'
            : activity.status === 'unknown' ? 'Unknown'
            : 'Active'),
    status: activity.status,
    sequence_num: activity.sequence_num,
    timestamp: activity.started_at ?? activity.ended_at,
    duration_ms: activity.duration_ms,
    actor: activity.actor,
    source_span_id: activity.source_span_id,
    parent_span_id: activity.parent_span_id,
    invocation_id: activity.invocation_id,
    semantic_provenance: activity.semantic_provenance,
    operator_facing_record: activity.operator_facing_record,
    provenance: 'projection',
  };
}

export function attachExplanationToNodes(
  nodes: GraphSnapshot['nodes'],
  explanation: RuntimeExplanationProjection,
): GraphSnapshot['nodes'] {
  const activitiesBySpanId = new Map<string, RuntimeExplanationProjection['activities']>();
  for (const activity of explanation.activities) {
    if (!activity.source_span_id) continue;
    const current = activitiesBySpanId.get(activity.source_span_id) ?? [];
    current.push(activity);
    activitiesBySpanId.set(activity.source_span_id, current);
  }

  return nodes.map((node) => {
    const spanId = node.source_span_id ?? node.span_id;
    const activities = spanId ? activitiesBySpanId.get(spanId) ?? [] : [];
    if (activities.length === 0) {
      return {
        ...node,
        activity: undefined,
      };
    }
    if (activities.length > 1) {
      return {
        ...node,
        status: 'unknown',
        activity: undefined,
        metadata: {
          ...(node.metadata ?? {}),
          runtime_activity_representation: 'multiple_activities_not_representable',
          runtime_activity_count: activities.length,
          runtime_activity_ids: activities.map((activity) => activity.id),
        },
      };
    }
    return {
      ...node,
      status: activities[0].status,
      activity: toCompatibilityActivity(activities[0]),
    };
  });
}

function annotateReplayWithExplanation(
  replay: ReplayStateResponse,
): ReplayStateResponse {
  const events = replay.events as EventEnvelope[];
  const frameExplanations: RuntimeExplanationProjection[] = [];
  const snapshots = replay.snapshots.map((snapshot, index) => {
    const cutoff = sequenceNumThroughSnapshot(replay.snapshots, events, index);
    const explanation = projectRuntimeExplanation({
      mission_id: replay.mission_id,
      branch_id: replay.branch_id,
      events,
      as_of_sequence_num: cutoff,
    });
    frameExplanations.push(explanation);
    return {
      ...snapshot,
      nodes: attachExplanationToNodes(snapshot.nodes, explanation),
    };
  });

  const lastSnapshot = snapshots[snapshots.length - 1] ?? null;
  const lastExplanation = frameExplanations[frameExplanations.length - 1];
  return {
    ...replay,
    snapshots,
    current_state: replay.current_state
      ? {
          ...replay.current_state,
          nodes: lastSnapshot?.nodes ?? replay.current_state.nodes,
          edges: lastSnapshot?.edges ?? replay.current_state.edges,
          sequence_num: lastSnapshot?.sequence_num ?? replay.current_state.sequence_num,
          status: lastExplanation?.run_outcome ?? 'unknown',
          status_provenance: lastExplanation?.run_outcome_provenance,
          phase: lastExplanation?.runtime_phase?.label ?? 'Unknown',
          runtime_phase: lastExplanation?.runtime_phase,
        }
      : null,
  };
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
  mission_id: string;
  branch_id: string;
  evidence_changed: boolean;
}

export interface IntegrityReport {
  is_valid: boolean | null;
  verification_status: 'verified' | 'unsupported';
  verification_reason: string;
  branch_reports: Array<{
    branch_id: string;
    is_valid: boolean | null;
    verification_status: 'verified' | 'unsupported';
    verification_reason: string;
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

  private mapSpanRow(row: Record<string, any>): StoredOtlpSpan {
    return {
      trace_id: String(row.trace_id),
      span_id: String(row.span_id),
      parent_span_id: row.parent_span_id ? String(row.parent_span_id) : undefined,
      operation_name: String(row.name),
      start_time_unix_nano: String(row.start_time_unix_nano),
      end_time_unix_nano: row.end_time_unix_nano ? String(row.end_time_unix_nano) : '0',
      status_code: String(row.status_code),
      attributes: (row.attributes as any) ?? {},
      events: (row.events as any) ?? [],
      branch_id: String(row.branch_id ?? ROOT_BRANCH_ID),
      admission_seq: Number(row.admission_seq ?? 0),
      revision_num: Number(row.revision_num ?? 1),
      admitted_at: new Date(String(row.created_at ?? '1970-01-01T00:00:00.000Z')).toISOString(),
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
    return mapInterruptRowToRecord(row);
  }

  /** Public interrupt serializer used by routes and websocket fan-out. */
  serializeInterrupt(interrupt: InterruptRecord & { branch_id?: string }): InterruptRecord & { branch_id?: string } {
    return serializeInterruptPublic(interrupt);
  }

  private async recordInterruptsFromSpans(client: PoolClient, missionId: string, spans: StoredOtlpSpan[], branchId: string = ROOT_BRANCH_ID): Promise<boolean> {
    let interruptRequested = false;
    // Re-evaluating an older trace after newly admitted correlation evidence
    // must never add a Governance fact to an already-published earlier frame.
    const translationAdmissionFloor = spans.reduce(
      (maximum, span) => Math.max(maximum, span.admission_seq),
      0,
    );
    const translationRecordedAt = [...spans]
      .sort((left, right) => right.admission_seq - left.admission_seq)[0]?.admitted_at;
    const requestAdmissionByInterrupt = new Map<string, { admissionSeq: number; recordedAt: string }>();
    const pendingOutcomes: Array<{
      admissionSeq: number;
      interruptId: string;
      outcome: Parameters<typeof applyRuntimeOutcome>[1]['outcome'];
      deliveryId?: string;
      correlated?: boolean;
      requireDeliveryCorrelation?: boolean;
    }> = [];
    // A framework may emit native identity and request evidence in separate
    // OTLP batches. Re-evaluate the trace's persisted observation facts after
    // each ingest, so normalization never depends on exporter batch shape.
    const traceIds = [...new Set(spans.map((span) => span.trace_id).filter(Boolean))];
    const traceRows = traceIds.length === 0
      ? []
      : (await client.query(
          `SELECT DISTINCT ON (trace_id, span_id) *
           FROM spans
           WHERE mission_id = $1 AND branch_id = $2 AND trace_id = ANY($3)
           ORDER BY trace_id, span_id, revision_num DESC`,
          [missionId, branchId, traceIds],
        )).rows;
    const traceSpans = traceRows.map((row) => this.mapSpanRow(row as Record<string, unknown>));
    // Propagate normalization identity conflicts into interrupt governance state.
    const ambiguousInterruptIds = interruptIdsWithAmbiguousNativeIdentity(traceSpans);
    const mafWorkflowIds = mafTraceWorkflowIds(traceSpans);
    for (const span of traceSpans) {
      for (const event of span.events ?? []) {
        const mafOutcome = mafOutcomeFact(event);
        if (mafOutcome) {
          pendingOutcomes.push({
            admissionSeq: span.admission_seq,
            interruptId: mafOutcome.interruptId,
            outcome: mafOutcome.outcome,
            deliveryId: mafOutcome.deliveryId,
            correlated: true,
            requireDeliveryCorrelation: true,
          });
          continue;
        }
        const langGraphOutcome = langGraphOutcomeFact(event);
        if (langGraphOutcome) {
          pendingOutcomes.push({
            admissionSeq: span.admission_seq,
            interruptId: langGraphOutcome.interruptId,
            outcome: langGraphOutcome.outcome,
            deliveryId: langGraphOutcome.deliveryId,
            correlated: langGraphOutcome.explicitlyCorrelated,
          });
          continue;
        }
        const normalizedInteraction = mafInteractionFact(span, event, mafWorkflowIds);
        const langGraphInteraction = langGraphInteractionFact(span, event, missionId, branchId);
        if (!normalizedInteraction && !langGraphInteraction) continue;
        interruptRequested = true;
        const framework = langGraphInteraction?.framework ?? normalizedInteraction?.framework;
        const interruptId = langGraphInteraction?.interruptId ?? normalizedInteraction?.interruptId ?? `${span.span_id}:interrupt`;
        const resumeToken = langGraphInteraction?.resumeToken;
        const nativeIdentity = langGraphInteraction?.nativeIdentity
          ?? (normalizedInteraction ? { ...normalizedInteraction.nativeIdentity, mission_id: missionId, branch_id: branchId } : null);
        const agentId = langGraphInteraction?.agentId ?? attributeValue(span.attributes, AgentAttributes.ID);
        const safePrompt = langGraphInteraction?.safePrompt ?? attributeValue(event.attributes, AgentAttributes.INTERRUPT_REASON);
        const requestType = langGraphInteraction?.requestType ?? normalizedInteraction?.requestType ?? 'interrupt';
        const supportedDecisionTypes = effectiveFrameworkDecisionTypes({
          supported_decision_types: langGraphInteraction?.supportedDecisionTypes
            ?? normalizedInteraction?.supportedDecisionTypes
            ?? [],
        });
        const scrubbedAttrs = langGraphInteraction?.publicAttributes ?? normalizedInteraction?.publicAttributes ?? { ...(event.attributes ?? {}) } as Record<string, unknown>;
        const reason = langGraphInteraction?.reason ?? 'Human input required';
        const resumeUrl = langGraphInteraction?.resumeUrl;
        const timeoutAt = langGraphInteraction?.timeoutAt;
        const requestLifecycle = 'pending';
        const governance = frameworkGovernanceFor(framework);
        const initialActionability = governance ? (governance.controlAvailable ? 'observed_only' : 'unavailable') : 'observed_only';

        delete scrubbedAttrs[AgentAttributes.RESUME_TOKEN];
        delete scrubbedAttrs['gen_ai.agent.resume.token'];

        const existingResult = await client.query(
          `
            SELECT native_identity, identity_ambiguous
            FROM interrupts
            WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
            LIMIT 1
          `,
          [missionId, branchId, interruptId],
        );
        const existingRow = existingResult.rows[0] as
          | { native_identity?: StoredNativeIdentity | null; identity_ambiguous?: boolean | null }
          | undefined;
        const ambiguity = resolveInterruptIdentityAmbiguity({
          interruptId,
          ambiguousInterruptIds,
          previousIdentity: existingRow?.native_identity ?? null,
          previouslyAmbiguous: existingRow?.identity_ambiguous,
          nextIdentity: nativeIdentity,
        });

        const persisted = await client.query(
          `
            INSERT INTO interrupts (
              id, mission_id, branch_id, interrupt_id, agent_id, span_id, status, reason, resume_url, resume_token_hash, payload, expires_at,
              framework, native_identity, source_refs, request_type, safe_prompt, supported_decision_types, actionability, request_lifecycle,
              runtime_outcome, identity_ambiguous, requested_admission_seq, requested_evidence, control_mode
            ) VALUES (
              $1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10::jsonb, $11,
              $12, $13::jsonb, $14::jsonb, $15, $16, $17::jsonb, $18, $19, 'awaiting_interaction', $20, $21, $22::jsonb, 'framework_binding'
            )
            ON CONFLICT (mission_id, branch_id, interrupt_id) DO UPDATE
            SET status = CASE
                  WHEN interrupts.status IN ('approved', 'rejected', 'resumed') THEN interrupts.status
                  ELSE 'pending'
                END,
                reason = EXCLUDED.reason,
                resume_url = COALESCE(EXCLUDED.resume_url, interrupts.resume_url),
                payload = interrupts.payload || EXCLUDED.payload,
                framework = COALESCE(EXCLUDED.framework, interrupts.framework),
                native_identity = COALESCE(EXCLUDED.native_identity, interrupts.native_identity),
                source_refs = COALESCE(EXCLUDED.source_refs, interrupts.source_refs),
                request_type = COALESCE(EXCLUDED.request_type, interrupts.request_type),
                safe_prompt = COALESCE(EXCLUDED.safe_prompt, interrupts.safe_prompt),
                supported_decision_types = CASE
                  WHEN EXCLUDED.supported_decision_types = '[]'::jsonb THEN interrupts.supported_decision_types
                  ELSE EXCLUDED.supported_decision_types
                END,
                control_mode = 'framework_binding',
                request_lifecycle = COALESCE(interrupts.request_lifecycle, EXCLUDED.request_lifecycle),
                requested_admission_seq = COALESCE(interrupts.requested_admission_seq, EXCLUDED.requested_admission_seq),
                identity_ambiguous = interrupts.identity_ambiguous OR EXCLUDED.identity_ambiguous,
                updated_at = NOW()
            RETURNING requested_admission_seq, created_at
          `,
          [
            randomUUID(),
            missionId,
            branchId,
            interruptId,
            agentId ?? attributeValue(span.attributes, AgentAttributes.ID) ?? null,
            span.span_id,
            reason,
            resumeUrl ?? null,
            resumeToken ? hashToken(resumeToken) : null,
            JSON.stringify({ event: event.name, attributes: scrubbedAttrs }),
            timeoutAt ?? null,
            framework ?? null,
            nativeIdentity ? JSON.stringify(nativeIdentity) : null,
            JSON.stringify([{ trace_id: span.trace_id, span_id: span.span_id, event_name: event.name }]),
            requestType,
            safePrompt ?? null,
            JSON.stringify(supportedDecisionTypes),
            initialActionability,
            requestLifecycle,
            ambiguity.identityAmbiguous,
            Math.max(span.admission_seq, translationAdmissionFloor),
            JSON.stringify({
              agent_id: agentId ?? attributeValue(span.attributes, AgentAttributes.ID) ?? null,
              interrupt_id: interruptId,
              reason,
              resume_url: resumeUrl ?? null,
              payload: { event: event.name, attributes: scrubbedAttrs },
            }),
          ],
        );

        const requestAdmission = Number(
          persisted.rows[0]?.requested_admission_seq
          ?? Math.max(span.admission_seq, translationAdmissionFloor),
        );
        const requestRecordedAt = new Date(String(persisted.rows[0]?.created_at ?? span.admitted_at)).toISOString();
        requestAdmissionByInterrupt.set(interruptId, {
          admissionSeq: requestAdmission,
          recordedAt: requestRecordedAt,
        });
        await appendGovernanceStateHistory(client, {
          missionId,
          branchId,
          interruptId,
          transitions: [
            governanceTransition({
              admission_seq: requestAdmission,
              axis: 'request',
              state: 'pending',
              recorded_at: requestRecordedAt,
              source: 'interrupt_request',
              evidence_ref: `${span.span_id}:${event.name ?? 'interrupt.requested'}`,
            }),
            governanceTransition({
              admission_seq: requestAdmission,
              axis: 'runtime',
              state: 'awaiting_interaction',
              recorded_at: requestRecordedAt,
              source: 'interrupt_request',
              evidence_ref: `${span.span_id}:${event.name ?? 'interrupt.requested'}`,
            }),
          ],
        });

        if (governance) {
          await reconcileInterruptActionability(client, {
            missionId,
            branchId,
            interruptId,
            identityAmbiguous: ambiguity.identityAmbiguous,
            framework: governance.framework,
            identityPolicy: governance.identityPolicy,
          });
        }
      }
    }
    // Apply terminal facts only after every request in the trace has been
    // admitted, so exporter span order cannot decide whether correlation finds
    // its interrupt aggregate.
    for (const outcome of pendingOutcomes.sort((left, right) => left.admissionSeq - right.admissionSeq)) {
      const requestAdmission = requestAdmissionByInterrupt.get(outcome.interruptId);
      const outcomeAdmission = Math.max(
        outcome.admissionSeq,
        requestAdmission?.admissionSeq ?? 0,
        translationAdmissionFloor,
      );
      await applyRuntimeOutcome(client, {
        missionId,
        branchId,
        interruptId: outcome.interruptId,
        outcome: outcome.outcome,
        deliveryId: outcome.deliveryId,
        correlated: outcome.correlated,
        requireDeliveryCorrelation: outcome.requireDeliveryCorrelation,
        admissionSeq: outcomeAdmission,
        recordedAt: outcomeAdmission === requestAdmission?.admissionSeq
          ? requestAdmission.recordedAt
          : spans.find((span) => span.admission_seq === outcomeAdmission)?.admitted_at
            ?? translationRecordedAt,
      });
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

  private async listSpansInternal(client: PoolClient, missionId: string, branchId = ROOT_BRANCH_ID): Promise<StoredOtlpSpan[]> {
    const result = await client.query(
      `
        SELECT *
        FROM spans
        WHERE mission_id = $1 AND branch_id = $2
        ORDER BY admission_seq ASC
      `,
      [missionId, branchId],
    );
    return result.rows.map((row) => this.mapSpanRow(row as Record<string, unknown>));
  }

  private async listSpansForBranchesInternal(
    client: PoolClient,
    missionId: string,
    branchIds: string[],
  ): Promise<StoredOtlpSpan[]> {
    const result = await client.query(
      `
        SELECT *
        FROM spans
        WHERE mission_id = $1 AND branch_id = ANY($2)
        ORDER BY admission_seq ASC
      `,
      [missionId, branchIds],
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
    const replay = await this.getReplayEvidenceFromTelemetry(missionId, branchId);
    if (!replay) {
      return {
        events: [],
        integrity: {
          is_valid: null,
          verification_status: 'unsupported',
          verification_reason: 'Cryptographic hash verification is not implemented for span-backed runtime evidence.',
          hash_chain_status: 'not_verified',
          branch_id: branchId,
          total_events: 0,
        },
      };
    }
    const selectedEvents = selectEventsForBranch(replay.events, replay.branches, branchId);
    const events = eventsThroughCursor(selectedEvents, sequenceNum);
    return {
      events,
      integrity: {
        is_valid: null,
        verification_status: 'unsupported',
        verification_reason: 'Cryptographic hash verification is not implemented for span-backed runtime evidence.',
        hash_chain_status: 'not_verified',
        branch_id: branchId,
        total_events: events.length,
      },
    };
  }

  async verifyMissionIntegrity(missionId: string): Promise<IntegrityReport> {
    return {
      is_valid: null,
      verification_status: 'unsupported',
      verification_reason: 'Cryptographic hash verification is not implemented for span-backed runtime evidence.',
      branch_reports: [
        {
          branch_id: 'main',
          is_valid: null,
          verification_status: 'unsupported',
          verification_reason: 'Cryptographic hash verification is not implemented for span-backed runtime evidence.',
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
    // Control credentials are API/control-plane inputs, never L0 telemetry.
    // Compatibility exporters may still send them; discard before hashing,
    // comparison, persistence, normalization, or projection.
    spans = stripExecutableCredentials(spans);
    resourceAttributes = stripExecutableCredentials(resourceAttributes);

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
        [missionId, objective, phase, JSON.stringify({
          source: 'otel',
          resource_attributes: resourceAttributes,
        })],
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
          return { accepted: true, mission_id: missionId, branch_id: branchId, evidence_changed: false };
        }
      }

      const sourceIdentities = [...new Map(spans.map((span) => [sourceSpanKey({
        branch_id: branchId,
        trace_id: span.trace_id,
        span_id: span.span_id,
      }), { traceId: span.trace_id, spanId: span.span_id }])).values()];
      const latestRows = sourceIdentities.length === 0
        ? []
        : (await client.query(
            `SELECT DISTINCT ON (trace_id, span_id) *
             FROM spans
             WHERE mission_id = $1 AND branch_id = $2
               AND (trace_id, span_id) IN (
                 SELECT source->>'trace_id', source->>'span_id'
                 FROM jsonb_array_elements($3::jsonb) AS source
               )
             ORDER BY trace_id, span_id, revision_num DESC`,
            [missionId, branchId, JSON.stringify(sourceIdentities.map((source) => ({
              trace_id: source.traceId,
              span_id: source.spanId,
            })))],
          )).rows;
      const latestBySpanId = new Map<string, StoredOtlpSpan>(
        latestRows.map((row) => {
          const stored = this.mapSpanRow(row as Record<string, unknown>);
          return [sourceSpanKey(stored), stored];
        }),
      );
      const changedSpans: StoredOtlpSpan[] = [];

      for (const span of spans) {
        const evidenceKey = sourceSpanKey({ branch_id: branchId, trace_id: span.trace_id, span_id: span.span_id });
        const previous = latestBySpanId.get(evidenceKey);
        if (previous && spanEvidenceRepresentation(previous) === spanEvidenceRepresentation(span)) {
          continue;
        }
        const admissionSeq = await allocateEvidenceAdmission(client, missionId);
        const revisionNum = (previous?.revision_num ?? 0) + 1;
        const inserted = await client.query(
          `
            INSERT INTO spans (
              id, mission_id, branch_id, trace_id, span_id, parent_span_id, name,
              start_time_unix_nano, end_time_unix_nano, status_code, attributes, events,
              admission_seq, revision_num
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)
            RETURNING *
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
            admissionSeq,
            revisionNum,
          ]
        );
        const stored = this.mapSpanRow(inserted.rows[0] as Record<string, unknown>);
        latestBySpanId.set(evidenceKey, stored);
        changedSpans.push(stored);
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

      await this.recordInterruptsFromSpans(client, missionId, changedSpans, branchId);
      await client.query('COMMIT');
      return { accepted: true, mission_id: missionId, branch_id: branchId, evidence_changed: changedSpans.length > 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async getReplayEvidenceFromTelemetry(missionId: string, branchId = ROOT_BRANCH_ID, useCheckpoint = false): Promise<ReplayStateResponse | null> {
    const client = await pool.connect();
    try {
      // A frame is reconstructed from one database snapshot. Admission cutoffs
      // define membership; REPEATABLE READ prevents a commit between the
      // branch/span/Governance reads from producing a state that never existed.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const mission = await client.query('SELECT id FROM missions WHERE id = $1', [missionId]);
      if (mission.rowCount === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const branches = await this.listReplayBranchesInternal(client, missionId);
      const safeBranches = branches.length ? branches : [createDefaultBranch(missionId)];
      if (!safeBranches.some((branch) => branch.id === branchId)) {
        await client.query('ROLLBACK');
        return null;
      }
      const lineage = buildBranchLineage(safeBranches, branchId);
      const branchIds = lineage.length > 0 ? lineage.map((branch) => branch.id) : [branchId];

      // 1. Fetch raw spans from database
      const spans = await this.listSpansForBranchesInternal(client, missionId, branchIds);

      // 2. Fetch interrupts from database
      const interruptsRes = await client.query(
        `SELECT * FROM interrupts WHERE mission_id = $1 AND branch_id = ANY($2)`,
        [missionId, branchIds]
      );
      const interrupts = interruptsRes.rows;

      // 3. Freeze ancestor membership at each persisted fork admission cutoff.
      const selectedSpans = selectSpanRevisionsForBranch(spans, safeBranches, branchId);
      const selectedInterrupts = selectInterruptsForBranch(interrupts, safeBranches, branchId).map((row) => ({
        ...row,
        ...mapInterruptRowToRecord(row as Record<string, unknown>),
        governance_state_history: row.governance_state_history,
        requested_evidence: row.requested_evidence,
        requested_admission_seq: row.requested_admission_seq,
        decided_admission_seq: row.decided_admission_seq,
        resumed_admission_seq: row.resumed_admission_seq,
      }));
      const replay = projectReplayEvidence(missionId, branchId, selectedSpans, selectedInterrupts);
      await client.query('COMMIT');
      return {
        ...replay,
        branches: safeBranches,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getReplayFromTelemetry(missionId: string, branchId = ROOT_BRANCH_ID, useCheckpoint = false): Promise<ReplayStateResponse | null> {
    const replay = await this.getReplayEvidenceFromTelemetry(missionId, branchId, useCheckpoint);
    return replay ? annotateReplayWithExplanation(replay) : null;
  }

  async getCurrentGraph(
    missionId: string,
    branchId = ROOT_BRANCH_ID,
  ): Promise<CurrentGraphResponse | null> {
    const replay = await this.getReplayFromTelemetry(missionId, branchId);
    if (!replay) return null;
    return {
      mission_id: missionId,
      projection_version: SPAN_PROJECTION_VERSION,
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
    const replay = await this.getReplayEvidenceFromTelemetry(missionId, branchId);
    if (!replay) return null;
    const selected = selectEventsForBranch(replay.events, replay.branches, branchId);
    return eventsThroughCursor(selected);
  }

  async createReplayBranch(missionId: string, input: CreateReplayBranchInput): Promise<ReplayBranch | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const sourceBranchId = input.source_branch_id ?? ROOT_BRANCH_ID;
    const sourceReplay = await this.getReplayEvidenceFromTelemetry(missionId, sourceBranchId);
    if (!sourceReplay) return null;

    const branchId = `${sourceBranchId}-${randomUUID().slice(0, 8)}`;
    const forkedFromSequenceNum =
      input.forked_from_sequence_num ??
      sourceReplay.snapshots.at(-1)?.sequence_num ??
      0;
    if (!sourceReplay.snapshots.some((snapshot) => snapshot.sequence_num === forkedFromSequenceNum)) {
      throw new Error(`Unknown evidence frame ${forkedFromSequenceNum} on branch ${sourceBranchId}`);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const branch = await this.ensureBranch(client, missionId, branchId, {
        name: input.name,
        parent_branch_id: sourceBranchId,
        forked_from_sequence_num: forkedFromSequenceNum,
        metadata: input.metadata,
      });

      // Do not materialize a lossy child interrupt aggregate. Branch replay
      // inherits the authoritative parent row and truncates its append-only
      // Governance history at this persisted fork cursor. A child-local request
      // is stored on the child branch and therefore cannot mutate the parent.

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

    const replay = await this.getReplayEvidenceFromTelemetry(missionId, branchId);
    if (!replay) return null;
    const selectedEvents = selectEventsForBranch(replay.events, replay.branches, branchId) as EventEnvelope[];
    const explanation = projectRuntimeExplanation({
      mission_id: missionId,
      branch_id: branchId,
      events: selectedEvents,
      as_of_sequence_num: upToSequenceNum,
    });

    const input = {
      mission_id: missionId,
      branch_id: branchId,
      objective: mission.objective,
      status: explanation.run_outcome,
      phase: explanation.runtime_phase?.label ?? 'Unknown',
      events: selectedEvents,
      up_to_sequence_num: upToSequenceNum,
    };

    return buildRuntimeSummaryWithOptionalLlm(input, useLlm);
  }

  async getRuntimeExplanation(
    missionId: string,
    branchId = ROOT_BRANCH_ID,
    upToSequenceNum?: number,
  ): Promise<RuntimeExplanationProjection | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const replay = await this.getReplayEvidenceFromTelemetry(missionId, branchId);
    if (!replay) return null;

    const selectedEvents = selectEventsForBranch(replay.events, replay.branches, branchId) as EventEnvelope[];
    return projectRuntimeExplanation({
      mission_id: missionId,
      branch_id: branchId,
      events: selectedEvents,
      as_of_sequence_num: upToSequenceNum,
    });
  }

  async getNodeProjection(
    missionId: string,
    agentId: string,
    branchId = ROOT_BRANCH_ID,
    upToSequenceNum?: number,
  ): Promise<RuntimeNodeProjection | null> {
    const mission = await this.getMission(missionId);
    if (!mission) return null;

    const replay = await this.getReplayEvidenceFromTelemetry(missionId, branchId);
    if (!replay) return null;
    const selectedEvents = selectEventsForBranch(replay.events, replay.branches, branchId);

    return buildNodeProjection({
      mission_id: missionId,
      branch_id: branchId,
      agent_id: agentId,
      events: selectedEvents,
      up_to_sequence_num: upToSequenceNum,
    });
  }

  async enhanceNodeProjection(
    missionId: string,
    agentId: string,
    branchId = ROOT_BRANCH_ID,
    upToSequenceNum?: number,
  ): Promise<RuntimeNodeProjection | null> {
    const projection = await this.getNodeProjection(missionId, agentId, branchId, upToSequenceNum);
    if (!projection) return null;
    return enhanceNodeProjectionWithLlm(projection);
  }

  async scheduleNodeProjectionEnhancements(
    missionId: string,
    branchId = ROOT_BRANCH_ID,
  ): Promise<void> {
    void missionId;
    void branchId;
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
        INSERT INTO semantic_summaries (id, mission_id, branch_id, level, summary, conflicts, anomalies, authority_version)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      `,
      [
        randomUUID(),
        missionId,
        branchId,
        'mission',
        summary.summary,
        JSON.stringify(summary.conflicts ?? []),
        JSON.stringify(summary.anomalies ?? []),
        SEMANTIC_PRESENTATION_AUTHORITY_VERSION,
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

    const snapshot = replay.snapshots.find((s) => s.sequence_num === sequenceNum);
    if (!snapshot) return null;
    const ctx: WhyThisStateContext = {
      explanation: projectRuntimeExplanation({
        mission_id: missionId,
        branch_id: branchId,
        events: replay.events as EventEnvelope[],
        as_of_sequence_num: snapshot.sequence_num,
      }),
    };

    const result = await generateWhyThisState(ctx);

    await pool.query(
      `
        INSERT INTO semantic_summaries (id, mission_id, branch_id, span_id, level, summary, conflicts, anomalies, authority_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
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
        SEMANTIC_PRESENTATION_AUTHORITY_VERSION,
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
      const requestedAdmission = await allocateEvidenceAdmission(client, input.mission_id);
      const result = await client.query(
        `
          INSERT INTO interrupts (
            id, mission_id, branch_id, interrupt_id, agent_id, span_id, status, reason, resume_url, resume_token_hash, payload, expires_at,
            requested_admission_seq, requested_evidence, control_mode
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, 'legacy_token')
          ON CONFLICT (mission_id, branch_id, interrupt_id) DO UPDATE
          SET status = CASE
                WHEN interrupts.status IN ('approved', 'rejected', 'resumed') THEN interrupts.status
                ELSE 'pending'
              END,
              reason = EXCLUDED.reason,
              resume_url = COALESCE(EXCLUDED.resume_url, interrupts.resume_url),
              payload = interrupts.payload || EXCLUDED.payload,
              control_mode = CASE
                WHEN interrupts.control_mode = 'legacy_token' THEN interrupts.control_mode
                ELSE 'unavailable'
              END,
              requested_admission_seq = COALESCE(interrupts.requested_admission_seq, EXCLUDED.requested_admission_seq),
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
          JSON.stringify(stripExecutableCredentials(input.payload ?? {})),
          input.expires_at ?? null,
          requestedAdmission,
          JSON.stringify({
            agent_id: input.agent_id ?? null,
            interrupt_id: interruptId,
            reason: input.reason,
            resume_url: input.resume_url ?? null,
            payload: stripExecutableCredentials(input.payload ?? {}),
          }),
        ],
      );
      const persistedAdmission = Number(result.rows[0]?.requested_admission_seq ?? requestedAdmission);
      const recordedAt = new Date(String(result.rows[0]?.created_at ?? new Date().toISOString())).toISOString();
      const governanceHistory = await appendGovernanceStateHistory(client, {
        missionId: input.mission_id,
        branchId,
        interruptId,
        transitions: [
          governanceTransition({
            admission_seq: persistedAdmission,
            axis: 'request',
            state: 'pending',
            recorded_at: recordedAt,
            source: 'interrupt_request',
            evidence_ref: `interrupt:${interruptId}:requested`,
          }),
          governanceTransition({
            admission_seq: persistedAdmission,
            axis: 'runtime',
            state: 'awaiting_interaction',
            recorded_at: recordedAt,
            source: 'interrupt_request',
            evidence_ref: `interrupt:${interruptId}:requested`,
          }),
        ],
      });
      if (result.rows[0]) result.rows[0].governance_state_history = governanceHistory;
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

    // Re-evaluate only the governance frameworks actually observed in this
    // branch; feature availability remains independent per framework.
    if (branchId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { reconcileMissionBranchActionability } = await import('./interrupts/reconcileActionability.js');
        const observed = await client.query(
          `SELECT DISTINCT framework FROM interrupts WHERE mission_id = $1 AND branch_id = $2`,
          [missionId, branchId],
        );
        for (const row of observed.rows) {
          const governance = frameworkGovernanceFor(row.framework);
          if (!governance?.controlAvailable) continue;
          await reconcileMissionBranchActionability(
            client,
            missionId,
            branchId,
            governance.framework,
            governance.identityPolicy,
          );
        }
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK').catch(() => {});
      } finally {
        client.release();
      }
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

      const existingResult = await client.query(
        `
          SELECT * FROM interrupts
          WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
          LIMIT 1
        `,
        [missionId, branchId, interruptId],
      );
      const existing = existingResult.rows[0] as Record<string, unknown> | undefined;
      if (!existing) {
        await client.query('ROLLBACK');
        return null;
      }

      // Idempotent same-key/same-content replay.
      if (existing.idempotency_key && String(existing.idempotency_key) === input.idempotency_key) {
        const priorDecision = String(existing.decision ?? existing.decision_type ?? '');
        const sameContent = priorDecision === input.decision
          && String(existing.decision_comment ?? '') === String(input.comment ?? '')
          && deterministicStringify(existing.decision_payload ?? {}) === deterministicStringify(input.payload ?? {});
        if (!sameContent) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('idempotency_conflict', 'Idempotency key conflict with different decision content');
        }
        await client.query('COMMIT');
        return this.mapInterruptRow(existing);
      }

      if (existing.decision_state === 'recorded' || existing.decision || ['expired', 'cancelled', 'resumed'].includes(String(existing.status))) {
        await client.query('ROLLBACK');
        throw new GovernanceControlError('request_finalized', 'Interrupt decision is already finalized');
      }

      const controlMode = controlModeFromRow(existing);
      const framework = String(existing.framework ?? '');
      const governance = frameworkGovernanceFor(framework);
      let isGovernance = false;
      if (controlMode === 'framework_binding') {
        if (!governance) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('control_unsupported', `Framework control is unsupported (${framework || 'missing framework'})`);
        }
        if (!governance.controlAvailable) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('control_unavailable', `Governance control is unavailable for ${framework}`);
        }
        const live = await assertCurrentlyActionable(client, {
          missionId,
          branchId,
          interruptId,
          framework: governance.framework,
          identityPolicy: governance.identityPolicy,
        });
        if (live.actionability === 'identity_conflict' || live.diagnostic === 'conflicting_native_identity') {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('identity_conflict', 'Native identity is ambiguous or conflicting; decision rejected');
        }
        if (live.actionability !== 'actionable' || !live.binding) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('not_actionable', `Request is not actionable (${live.reason})`);
        }
        isGovernance = true;
      } else if (!isExplicitLegacyControl(existing)) {
        await client.query('ROLLBACK');
        throw new GovernanceControlError(
          framework ? 'control_unsupported' : 'control_unavailable',
          framework
            ? `Framework control is unsupported (${framework})`
            : 'Interrupt has no explicit mutation authority',
        );
      }

      const expired = existing.expires_at
        ? new Date(String(existing.expires_at)).getTime() <= Date.now()
        : false;
      if (existing.request_lifecycle !== 'pending' || expired) {
        await client.query('ROLLBACK');
        throw new GovernanceControlError('not_actionable', expired ? 'Interrupt request is expired' : 'Interrupt request is not pending');
      }

      if (isGovernance) {
        const supported = effectiveFrameworkDecisionTypes(existing);
        const decisionType = input.decision === 'revise' ? 'structured_response' : input.decision;
        if (!supported.includes(decisionType as (typeof supported)[number])) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('invalid_decision', `Decision type ${input.decision} is not supported by this request`);
        }
        if (decisionType === 'structured_response' && (!input.payload || Object.keys(input.payload).length === 0)) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('invalid_decision', 'Structured decision requires a non-empty typed value');
        }

        const validation = decisionType === 'structured_response'
          ? validateStructuredDecisionValue(
              input.payload,
              (existing.safe_input_schema as Record<string, unknown>) ?? undefined,
            )
          : input.payload === undefined
            ? { ok: true as const, value: {}, summary: { kind: 'empty' } }
            : validateStructuredDecisionValue(input.payload);
        if (!validation.ok) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('invalid_decision', validation.reason);
        }

        const decisionAdmission = await allocateEvidenceAdmission(client, missionId);
        const decisionId = randomUUID();
        const result = await client.query(
          `
            UPDATE interrupts
            SET status = CASE
                  WHEN $4 = 'approve' THEN 'approved'
                  WHEN $4 = 'reject' THEN 'rejected'
                  ELSE status
                END,
                decision = $4,
                decision_comment = $5,
                decision_payload = $6::jsonb,
                decision_value_summary = $7::jsonb,
                decision_audit = $8::jsonb,
                decision_state = 'recorded',
                decision_id = $9,
                decision_actor = $10,
                decision_type = $11,
                delivery_state = 'pending',
                idempotency_key = $12,
                decided_at = COALESCE(decided_at, NOW()),
                decided_admission_seq = COALESCE(decided_admission_seq, $13),
                updated_at = NOW()
            WHERE mission_id = $1
              AND branch_id = $2
              AND interrupt_id = $3
              AND control_mode = 'framework_binding'
              AND request_lifecycle = 'pending'
              AND (expires_at IS NULL OR expires_at > NOW())
              AND decision_state = 'none'
              AND actionability = 'actionable'
              AND authorized_binding_id IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM framework_bridge_bindings AS binding
                WHERE binding.id = interrupts.authorized_binding_id
                  AND binding.mission_id = interrupts.mission_id
                  AND binding.branch_id = interrupts.branch_id
                  AND binding.framework = interrupts.framework
                  AND binding.lifecycle_state = 'active'
                  AND binding.lease_expires_at > NOW()
              )
            RETURNING *
          `,
          [
            missionId,
            branchId,
            interruptId,
            input.decision,
            input.comment ?? null,
            JSON.stringify(validation.value ?? {}),
            JSON.stringify(validation.summary),
            JSON.stringify({
              channel: 'api',
              actor: 'local-operator',
              decision_type: decisionType,
              summary: validation.summary,
            }),
            decisionId,
            'local-operator',
            decisionType,
            input.idempotency_key,
            decisionAdmission,
          ],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          await client.query('ROLLBACK');
          throw new GovernanceControlError('not_actionable', 'Interrupt control authority changed before the decision could be recorded');
        }
        await appendGovernanceStateHistory(client, {
          missionId,
          branchId,
          interruptId,
          transitions: [governanceTransition({
            admission_seq: decisionAdmission,
            axis: 'decision',
            state: 'recorded',
            recorded_at: new Date(String(row.decided_at ?? new Date().toISOString())).toISOString(),
            source: 'operator_decision',
            evidence_ref: decisionId,
          })],
        });
        await ensureDeliveryAttempt(client, {
          missionId,
          branchId,
          interruptId,
          decisionId,
          admissionSeq: decisionAdmission,
          recordedAt: new Date(String(row.decided_at ?? new Date().toISOString())).toISOString(),
        });
        const authoritative = await client.query(
          `SELECT * FROM interrupts
           WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
           LIMIT 1`,
          [missionId, branchId, interruptId],
        );
        await this.ensureBranch(client, missionId, branchId);
        await client.query('COMMIT');
        // Do not auto-resume or imply runtime outcome for a governance bridge path.
        return this.mapInterruptRow(authoritative.rows[0] as Record<string, unknown>);
      }

      const decisionAdmission = await allocateEvidenceAdmission(client, missionId);
      const result = await client.query(
        `
          UPDATE interrupts
          SET status = CASE WHEN $4 = 'approve' THEN 'approved' WHEN $4 = 'reject' THEN 'rejected' ELSE status END,
              decision = $4,
              decision_comment = $5,
              decision_payload = $6::jsonb,
              idempotency_key = COALESCE(idempotency_key, $7),
              decided_at = COALESCE(decided_at, NOW()),
              decided_admission_seq = COALESCE(decided_admission_seq, $8),
              decision_state = 'recorded',
              updated_at = NOW()
          WHERE mission_id = $1
            AND branch_id = $2
            AND interrupt_id = $3
            AND control_mode = 'legacy_token'
            AND framework IS NULL
            AND native_identity IS NULL
            AND request_lifecycle = 'pending'
            AND (expires_at IS NULL OR expires_at > NOW())
            AND (idempotency_key IS NULL OR idempotency_key = $7)
            AND status IN ('pending', 'approved', 'rejected')
          RETURNING *
        `,
        [missionId, branchId, interruptId, input.decision, input.comment ?? null, JSON.stringify(input.payload ?? {}), input.idempotency_key, decisionAdmission],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      let interrupt: (InterruptRecord & { branch_id?: string }) | null = null;

      if (row) {
        const recordedAt = new Date(String(row?.decided_at ?? new Date().toISOString())).toISOString();
        const governanceHistory = await appendGovernanceStateHistory(client, {
          missionId,
          branchId,
          interruptId,
          transitions: [
            governanceTransition({
              admission_seq: decisionAdmission,
              axis: 'decision',
              state: 'recorded',
              recorded_at: recordedAt,
              source: 'operator_decision',
              evidence_ref: `legacy-decision:${input.idempotency_key}`,
            }),
          ],
        });
        row.governance_state_history = governanceHistory;
        interrupt = this.mapInterruptRow(row);
        await this.ensureBranch(client, missionId, branchId);
      }
      await client.query('COMMIT');

      if (interrupt) {
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
      const existingResult = await client.query(
        `SELECT * FROM interrupts
         WHERE resume_token_hash = $1
           AND control_mode = 'legacy_token'
           AND framework IS NULL
           AND native_identity IS NULL
           AND request_lifecycle = 'pending'
           AND (expires_at IS NULL OR expires_at > NOW())
           AND status IN ('pending', 'approved')
         FOR UPDATE`,
        [hashToken(resumeToken)],
      );
      if (existingResult.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      const existing = existingResult.rows[0] as Record<string, unknown>;
      const resumedAdmission = await allocateEvidenceAdmission(client, String(existing.mission_id));
      const result = await client.query(
        `
          UPDATE interrupts
          SET status = 'resumed',
              decision = COALESCE(decision, 'resume'),
              decision_payload = decision_payload || $2::jsonb,
              resumed_at = COALESCE(resumed_at, NOW()),
              resumed_admission_seq = COALESCE(resumed_admission_seq, $3),
              decision_state = CASE WHEN decision IS NULL THEN 'recorded' ELSE decision_state END,
              runtime_outcome = 'resumed',
              request_lifecycle = 'resolved',
              updated_at = NOW()
          WHERE id = $1
            AND control_mode = 'legacy_token'
            AND framework IS NULL
            AND native_identity IS NULL
            AND request_lifecycle = 'pending'
            AND (expires_at IS NULL OR expires_at > NOW())
            AND status IN ('pending', 'approved')
          RETURNING *
        `,
        [String(existing.id), JSON.stringify(payload), resumedAdmission],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      let interrupt: (InterruptRecord & { branch_id?: string }) | null = null;
      if (row) {
        const recordedAt = new Date(String(row?.resumed_at ?? new Date().toISOString())).toISOString();
        const governanceHistory = await appendGovernanceStateHistory(client, {
          missionId: String(row.mission_id),
          branchId: String(row.branch_id ?? ROOT_BRANCH_ID),
          interruptId: String(row.interrupt_id),
          transitions: [
            governanceTransition({
              admission_seq: resumedAdmission,
              axis: 'runtime',
              state: 'resumed',
              recorded_at: recordedAt,
              source: 'legacy_resume',
              evidence_ref: `resume-token:${String(row.interrupt_id)}`,
            }),
            governanceTransition({
              admission_seq: resumedAdmission,
              axis: 'request',
              state: 'resolved',
              recorded_at: recordedAt,
              source: 'legacy_resume',
              evidence_ref: `resume-token:${String(row.interrupt_id)}`,
            }),
          ],
        });
        row.governance_state_history = governanceHistory;
        interrupt = this.mapInterruptRow(row);
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
      const params: Array<unknown> = [missionId, branchId, SEMANTIC_PRESENTATION_AUTHORITY_VERSION];
      let queryStr = `
        SELECT *
        FROM semantic_summaries
        WHERE mission_id = $1 AND branch_id = $2 AND authority_version = $3
      `;
      if (level) {
        params.push(level);
        queryStr += ` AND level = $4`;
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

      // Presentation caches are branch-local. Inheriting an ancestor's latest
      // row could expose evidence admitted after the immutable fork prefix.
      const finalResult: Array<Record<string, unknown>> = [];
      const levels = level ? [level] : ['mission', 'why_this_state'];

      for (const lvl of levels) {
        const match = mapped.find(m => m.branch_id === branchId && m.level === lvl);
        if (match) finalResult.push(match);
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
