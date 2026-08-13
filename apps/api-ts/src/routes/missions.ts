import { Router } from 'express';
import { CreateMissionSchema, OtlpIngestRequestSchema, SPAN_PROJECTION_VERSION, UpdateMissionSchema, type GraphSnapshotsResponse, type ReplayUpdatedMissionRealtimeMessage } from '@agentlens/protocol';
import { publishMissionEvent, publishRuntimeExplanationEvent } from '../realtime/events.js';
import { missionStore } from '../services/missionStore.js';

const createMissionSchema = CreateMissionSchema;
const updateMissionSchema = UpdateMissionSchema;
const ingestSchema = OtlpIngestRequestSchema;


type OtlpJsonAttribute = { key?: string; value?: Record<string, unknown> };

function otlpValueToScalar(value: Record<string, unknown> | undefined): string | number | boolean | string[] | number[] | boolean[] | undefined {
  if (!value) return undefined;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.intValue === 'string' || typeof value.intValue === 'number') return Number(value.intValue);
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  if (typeof value.boolValue === 'boolean') return value.boolValue;
  const arrayValues = (value.arrayValue as { values?: Array<Record<string, unknown>> } | undefined)?.values;
  if (Array.isArray(arrayValues)) {
    return arrayValues.map((entry) => String(otlpValueToScalar(entry) ?? ''));
  }
  return undefined;
}

function attributesToRecord(attributes: OtlpJsonAttribute[] | undefined): Record<string, string | number | boolean | string[] | number[] | boolean[]> {
  const result: Record<string, string | number | boolean | string[] | number[] | boolean[]> = {};
  for (const attribute of attributes ?? []) {
    if (!attribute.key) continue;
    const value = otlpValueToScalar(attribute.value);
    if (value !== undefined) result[attribute.key] = value;
  }
  return result;
}

export function normalizeOtlpJson(body: any): { resource_attributes: Record<string, string | number | boolean | string[] | number[] | boolean[]>; spans: any[]; batch_id?: string } {
  const spans: any[] = [];
  let resourceAttributes: Record<string, string | number | boolean | string[] | number[] | boolean[]> = {};

  for (const resourceSpan of body?.resourceSpans ?? []) {
    const resourceAttrs = attributesToRecord(resourceSpan.resource?.attributes);
    resourceAttributes = { ...resourceAttributes, ...resourceAttrs };
    for (const scopeSpan of resourceSpan.scopeSpans ?? resourceSpan.instrumentationLibrarySpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        spans.push({
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_span_id: span.parentSpanId || undefined,
          operation_name: span.name ?? 'span',
          start_time_unix_nano: String(span.startTimeUnixNano ?? 0),
          end_time_unix_nano: String(span.endTimeUnixNano ?? 0),
          status_code: span.status?.code === 2 ? 'ERROR' : span.status?.code === 1 ? 'OK' : 'UNSET',
          attributes: attributesToRecord(span.attributes),
          events: (span.events ?? []).map((event: any) => ({
            name: event.name,
            timestamp: event.timeUnixNano,
            attributes: attributesToRecord(event.attributes),
          })),
        });
      }
    }
  }

  return { resource_attributes: resourceAttributes, spans, batch_id: body?.batchId };
}
export const missionsRouter = Router();

missionsRouter.post('/api/v1/missions', async (req, res) => {
  const parsed = createMissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const mission = await missionStore.createMission(parsed.data);
  await publishMissionEvent(mission.id, 'mission.created', { mission });
  return res.status(201).json(mission);
});

missionsRouter.get('/api/v1/missions', async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const perPage = Number(req.query.per_page ?? 20);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  const result = await missionStore.listMissions(page, perPage, status);
  return res.json(result);
});

missionsRouter.get('/api/v1/missions/:missionId', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });
  return res.json(mission);
});

missionsRouter.patch('/api/v1/missions/:missionId', async (req, res) => {
  const parsed = updateMissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const mission = await missionStore.updateMission(req.params.missionId, parsed.data);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });
  await publishMissionEvent(mission.id, 'mission.updated', { mission });
  return res.json(mission);
});

missionsRouter.delete('/api/v1/missions/:missionId', async (req, res) => {
  const deleted = await missionStore.deleteMission(req.params.missionId);
  if (!deleted) return res.status(404).json({ detail: 'Mission not found' });
  await publishMissionEvent(req.params.missionId, 'mission.deleted', { mission_id: req.params.missionId });
  return res.status(204).send();
});

missionsRouter.get('/api/v1/missions/:missionId/audit/events', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : 'main';
  const sequenceNum = req.query.sequence_num !== undefined ? Number(req.query.sequence_num) : undefined;

  const result = await missionStore.getAuditEvents(req.params.missionId, branchId, sequenceNum);
  return res.json(result);
});

missionsRouter.get('/api/v1/missions/:missionId/audit/verify', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });
  
  const report = await missionStore.verifyMissionIntegrity(req.params.missionId);
  return res.json(report);
});

missionsRouter.post('/api/v1/ingest/otlp', async (req, res) => {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const ingestResult = await missionStore.ingestSpans(
    parsed.data.mission_id,
    parsed.data.spans,
    parsed.data.resource_attributes,
    parsed.data.branch_id,
    parsed.data.batch_id,
  );
  if (!ingestResult) return res.status(400).json({ detail: 'No spans accepted' });

  const branchId = ingestResult.branch_id;
  const missionId = ingestResult.mission_id;
  if (ingestResult.evidence_changed) {
    const replayUpdated: ReplayUpdatedMissionRealtimeMessage = { type: 'replay.updated', mission_id: missionId, branch_id: branchId };
    void publishMissionEvent(replayUpdated.mission_id, replayUpdated.type, { branch_id: replayUpdated.branch_id }).catch(() => undefined);
  }
  if (missionId) {
    void missionStore.getRuntimeSummary(missionId, branchId).then((runtimeSummary) => {
      if (runtimeSummary) {
        void publishMissionEvent(missionId, 'runtime.summary.updated', { runtime_summary: runtimeSummary });
      }
    }).catch(() => undefined);
    void missionStore.getRuntimeExplanation(missionId, branchId).then((runtimeExplanation) => {
      if (runtimeExplanation) {
        void publishRuntimeExplanationEvent(missionId, runtimeExplanation);
      }
    }).catch(() => undefined);
    void missionStore.scheduleNodeProjectionEnhancements(missionId, branchId).catch(() => undefined);
  }

  return res.status(202).json({ accepted: parsed.data.spans.length, mission_id: missionId });
});


missionsRouter.post('/v1/traces', async (req, res) => {
  const normalized = normalizeOtlpJson(req.body);
  const parsed = ingestSchema.safeParse(normalized);
  if (!parsed.success) {
    return res.status(400).json({ partialSuccess: { rejectedSpans: normalized.spans.length, errorMessage: JSON.stringify(parsed.error.flatten()) } });
  }

  const ingestResult = await missionStore.ingestSpans(
    parsed.data.mission_id,
    parsed.data.spans,
    parsed.data.resource_attributes,
    parsed.data.branch_id,
    parsed.data.batch_id,
  );
  if (!ingestResult) return res.status(400).json({ partialSuccess: { rejectedSpans: parsed.data.spans.length, errorMessage: 'No spans accepted' } });

  const branchId = ingestResult.branch_id;
  const missionId = ingestResult.mission_id;
  if (ingestResult.evidence_changed) {
    const replayUpdated: ReplayUpdatedMissionRealtimeMessage = { type: 'replay.updated', mission_id: missionId, branch_id: branchId };
    void publishMissionEvent(replayUpdated.mission_id, replayUpdated.type, { branch_id: replayUpdated.branch_id }).catch(() => undefined);
  }
  if (missionId) {
    void missionStore.getRuntimeSummary(missionId, branchId).then((runtimeSummary) => {
      if (runtimeSummary) {
        void publishMissionEvent(missionId, 'runtime.summary.updated', { runtime_summary: runtimeSummary });
      }
    }).catch(() => undefined);
    void missionStore.getRuntimeExplanation(missionId, branchId).then((runtimeExplanation) => {
      if (runtimeExplanation) {
        void publishRuntimeExplanationEvent(missionId, runtimeExplanation);
      }
    }).catch(() => undefined);
    void missionStore.scheduleNodeProjectionEnhancements(missionId, branchId).catch(() => undefined);
  }

  return res.status(202).json({ partialSuccess: { rejectedSpans: 0 } });
});
missionsRouter.get('/api/v1/missions/:missionId/graph', async (req, res) => {
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
  const graph = await missionStore.getCurrentGraph(req.params.missionId, branchId);
  if (!graph) return res.status(404).json({ detail: 'Mission not found' });
  return res.json(graph);
});

missionsRouter.get('/api/v1/missions/:missionId/graph/snapshots', async (req, res) => {
  const offset = Number(req.query.offset ?? 0);
  const limit = Number(req.query.limit ?? 50);
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
  const snapshots = await missionStore.getSnapshots(req.params.missionId, offset, limit, branchId);
  if (!snapshots) return res.status(404).json({ detail: 'Mission not found' });
  const response: GraphSnapshotsResponse = { projection_version: SPAN_PROJECTION_VERSION, snapshots, offset, limit, count: snapshots.length };
  return res.json(response);
});
