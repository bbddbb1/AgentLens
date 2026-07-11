import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CreateInterruptSchema, CreateReplayBranchSchema, DecideInterruptSchema, ResumeInterruptSchema } from '@agentlens/protocol';
import { publishMissionEvent } from '../realtime/events.js';
import { missionStore } from '../services/missionStore.js';
import { artifactBucket, presignArtifactDownload, presignArtifactUpload } from '../services/artifacts.js';

const reviewSchema = z.object({
  status: z.string().optional().default('pending'),
  body: z.string().optional(),
});

const commentSchema = z.object({
  body: z.string().min(1),
  review_id: z.string().uuid().optional(),
  parent_id: z.string().uuid().optional(),
  target_type: z.string().optional(),
  target_id: z.string().optional(),
  target_context: z.record(z.unknown()).optional(),
});

const shareSchema = z.object({
  user_email: z.string().email(),
  permission: z.string().optional().default('viewer'),
  encrypted_key: z.string().min(1),
});

const whyThisStateSchema = z.object({
  sequence_num: z.number().int().min(0),
  branch_id: z.string().optional(),
});

const artifactCreateSchema = z.object({
  name: z.string().min(1),
  artifact_type: z.string().optional().default('document'),
  content_type: z.string().optional(),
  size_bytes: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const extrasRouter = Router();

function respondRouteError(res: Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();
  const status = lower.includes('timeout') || lower.includes('connect') ? 503 : 500;
  res.status(status).json({ detail: message || fallback });
}

extrasRouter.get('/api/v1/missions/:missionId/nodes/:agentId/projection', async (req, res) => {
  try {
    const mission = await missionStore.getMission(req.params.missionId);
    if (!mission) return res.status(404).json({ detail: 'Mission not found' });

    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const sequenceNum = req.query.sequence_num !== undefined ? Number(req.query.sequence_num) : undefined;

    const projection = await missionStore.getNodeProjection(
      req.params.missionId,
      req.params.agentId,
      branchId,
      Number.isFinite(sequenceNum) ? sequenceNum : undefined,
    );
    if (!projection) return res.status(404).json({ detail: 'Node projection not found' });

    return res.json(projection);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load node projection');
  }
});

extrasRouter.post('/api/v1/missions/:missionId/nodes/:agentId/projection/enhance', async (req, res) => {
  try {
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const sequenceNum = req.query.sequence_num !== undefined ? Number(req.query.sequence_num) : undefined;

    const projection = await missionStore.enhanceNodeProjection(
      req.params.missionId,
      req.params.agentId,
      branchId,
      Number.isFinite(sequenceNum) ? sequenceNum : undefined,
    );
    if (!projection) return res.status(404).json({ detail: 'Node projection not found' });

    await publishMissionEvent(req.params.missionId, 'node.projection.updated', {
      agent_id: req.params.agentId,
      node_projection: projection,
    });
    return res.status(201).json(projection);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to enhance node projection');
  }
});

extrasRouter.get('/api/v1/missions/:missionId/runtime-summary', async (req, res) => {
  try {
    const mission = await missionStore.getMission(req.params.missionId);
    if (!mission) return res.status(404).json({ detail: 'Mission not found' });

    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const sequenceNum = req.query.sequence_num !== undefined ? Number(req.query.sequence_num) : undefined;
    const useLlm = req.query.enhance === 'true' || req.query.enhance === '1';

    const summary = await missionStore.getRuntimeSummary(
      req.params.missionId,
      branchId,
      Number.isFinite(sequenceNum) ? sequenceNum : undefined,
      useLlm,
    );
    if (!summary) return res.status(404).json({ detail: 'Mission not found' });

    return res.json(summary);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load runtime summary');
  }
});

extrasRouter.get('/api/v1/missions/:missionId/explanation', async (req, res) => {
  try {
    const mission = await missionStore.getMission(req.params.missionId);
    if (!mission) return res.status(404).json({ detail: 'Mission not found' });

    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const sequenceNum = req.query.sequence_num !== undefined ? Number(req.query.sequence_num) : undefined;
    const explanation = await missionStore.getRuntimeExplanation(
      req.params.missionId,
      branchId,
      Number.isFinite(sequenceNum) ? sequenceNum : undefined,
    );
    if (!explanation) return res.status(404).json({ detail: 'Mission not found' });

    return res.json(explanation);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load runtime explanation');
  }
});

extrasRouter.post('/api/v1/missions/:missionId/runtime-summary/enhance', async (req, res) => {
  try {
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const summary = await missionStore.getRuntimeSummary(req.params.missionId, branchId, undefined, true);
    if (!summary) return res.status(404).json({ detail: 'Mission not found' });
    const explanation = await missionStore.getRuntimeExplanation(req.params.missionId, branchId);

    await publishMissionEvent(req.params.missionId, 'runtime.summary.updated', { runtime_summary: summary });
    if (explanation) {
      await publishMissionEvent(req.params.missionId, 'runtime.explanation.updated', { runtime_explanation: explanation });
    }
    return res.status(201).json(summary);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to enhance runtime summary');
  }
});

extrasRouter.get('/api/v1/missions/:missionId/replay', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });
  const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
  const replay = await missionStore.getReplayFromTelemetry(req.params.missionId, branchId);
  if (!replay) return res.status(404).json({ detail: 'Mission not found' });
  return res.json(replay);
});



extrasRouter.get('/api/v1/missions/:missionId/events', async (req, res) => {
  try {
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const events = await missionStore.listMissionEvents(req.params.missionId, branchId);
    if (!events) return res.status(404).json({ detail: 'Mission not found' });
    return res.json({ events });
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load mission events');
  }
});

extrasRouter.get('/api/v1/missions/:missionId/summary', async (req, res) => {
  try {
    const mission = await missionStore.getMission(req.params.missionId);
    if (!mission) return res.status(404).json({ detail: 'Mission not found' });

    const level = typeof req.query.level === 'string' ? req.query.level : undefined;
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const summaries = await missionStore.listSummaries(req.params.missionId, level, branchId);
    return res.json(summaries);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load mission summary');
  }
});

extrasRouter.post('/api/v1/missions/:missionId/summary/generate', async (req, res) => {
  try {
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const summary = await missionStore.generateSummary(req.params.missionId, branchId);
    if (!summary) return res.status(404).json({ detail: 'Mission not found' });

    await publishMissionEvent(req.params.missionId, 'summary.generated', { summary });
    const latest = await missionStore.listSummaries(req.params.missionId, undefined, branchId);
    return res.status(201).json(latest[0] ?? summary);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to generate mission summary');
  }
});

extrasRouter.post('/api/v1/missions/:missionId/why-this-state', async (req, res) => {
  try {
    const parsed = whyThisStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ detail: parsed.error.flatten() });
    }

    const result = await missionStore.generateWhyThisState(
      req.params.missionId,
      parsed.data.sequence_num,
      parsed.data.branch_id,
    );
    if (!result) return res.status(404).json({ detail: 'Mission not found' });

    return res.status(201).json(result);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to generate why-this-state explanation');
  }
});

extrasRouter.post('/api/v1/missions/:missionId/reviews', async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const review = await missionStore.createReview(req.params.missionId, parsed.data.status, parsed.data.body);
  await publishMissionEvent(req.params.missionId, 'review.created', { review });
  return res.status(201).json(review);
});

extrasRouter.get('/api/v1/missions/:missionId/reviews', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const reviews = await missionStore.listReviews(req.params.missionId);
  return res.json(reviews);
});

extrasRouter.post('/api/v1/missions/:missionId/comments', async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const comment = await missionStore.createComment({
    missionId: req.params.missionId,
    body: parsed.data.body,
    reviewId: parsed.data.review_id,
    parentId: parsed.data.parent_id,
    targetType: parsed.data.target_type,
    targetId: parsed.data.target_id,
    targetContext: parsed.data.target_context,
  });
  await publishMissionEvent(req.params.missionId, 'comment.created', { comment });
  return res.status(201).json(comment);
});

extrasRouter.post('/api/v1/missions/:missionId/artifacts/presign', async (req, res) => {
  const parsed = artifactCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const artifactId = randomUUID();
  const safeName = parsed.data.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `${req.params.missionId}/${artifactId}/${safeName}`;

  const artifact = await missionStore.createArtifact({
    id: artifactId,
    missionId: req.params.missionId,
    name: parsed.data.name,
    artifactType: parsed.data.artifact_type,
    objectKey,
    contentType: parsed.data.content_type,
    sizeBytes: parsed.data.size_bytes,
    metadata: parsed.data.metadata,
  });

  const uploadUrl = await presignArtifactUpload({
    bucket: artifactBucket(),
    key: objectKey,
    contentType: parsed.data.content_type,
  });

  await publishMissionEvent(req.params.missionId, 'artifact.presigned', { artifact });
  return res.status(201).json({ artifact, upload_url: uploadUrl, bucket: artifactBucket() });
});

extrasRouter.get('/api/v1/missions/:missionId/artifacts', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const artifacts = await missionStore.listArtifacts(req.params.missionId);
  return res.json({ artifacts });
});

extrasRouter.get('/api/v1/missions/:missionId/artifacts/:artifactId/download', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const artifact = await missionStore.getArtifact(req.params.missionId, req.params.artifactId);
  if (!artifact) return res.status(404).json({ detail: 'Artifact not found' });

  const downloadUrl = await presignArtifactDownload({
    bucket: artifactBucket(),
    key: artifact.object_key,
  });

  return res.json({ artifact, download_url: downloadUrl, bucket: artifactBucket() });
});

extrasRouter.get('/api/v1/missions/:missionId/comments', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const targetType = typeof req.query.target_type === 'string' ? req.query.target_type : undefined;
  const targetId = typeof req.query.target_id === 'string' ? req.query.target_id : undefined;
  const comments = await missionStore.listComments(req.params.missionId, targetType, targetId);
  return res.json(comments);
});

extrasRouter.patch('/api/v1/missions/:missionId/comments/:commentId/resolve', async (req, res) => {
  const resolved = await missionStore.resolveComment(req.params.missionId, req.params.commentId);
  if (!resolved) return res.status(404).json({ detail: 'Comment not found' });
  await publishMissionEvent(req.params.missionId, 'comment.resolved', { comment_id: req.params.commentId });
  return res.json({ status: 'resolved' });
});

extrasRouter.post('/api/v1/missions/:missionId/share', async (req, res) => {
  const parsed = shareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const user = await missionStore.findUserByEmail(parsed.data.user_email);
  if (!user) return res.status(404).json({ detail: 'User not found' });

  const share = await missionStore.createShare({
    missionId: req.params.missionId,
    userId: user.id,
    encryptedKeyBase64: parsed.data.encrypted_key,
    permission: parsed.data.permission,
  });

  await publishMissionEvent(req.params.missionId, 'mission.shared', { share });

  return res.status(201).json(share);
});

extrasRouter.get('/api/v1/missions/:missionId/shares', async (req, res) => {
  const mission = await missionStore.getMission(req.params.missionId);
  if (!mission) return res.status(404).json({ detail: 'Mission not found' });

  const shares = await missionStore.listShares(req.params.missionId);
  return res.json(shares);
});

extrasRouter.post('/api/v1/interrupts', async (req, res) => {
  try {
    const parsed = CreateInterruptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ detail: parsed.error.flatten() });
    }

    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const input = { ...parsed.data, branch_id: branchId };
    const interrupt = await missionStore.createInterrupt(input);
    if (!interrupt) return res.status(404).json({ detail: 'Mission not found' });
    const summary = await missionStore.generateSummaryForHumanReview(interrupt.mission_id);
    if (summary) {
      await publishMissionEvent(interrupt.mission_id, 'summary.generated', { summary });
    }
    await publishMissionEvent(interrupt.mission_id, 'interrupt.created', { interrupt });
    return res.status(201).json(interrupt);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to create interrupt');
  }
});

extrasRouter.get('/api/v1/missions/:missionId/interrupts', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const interrupts = await missionStore.listInterrupts(req.params.missionId, status, branchId);
    if (!interrupts) return res.status(404).json({ detail: 'Mission not found' });
    return res.json({ interrupts: interrupts.map((item) => missionStore.serializeInterrupt(item)) });
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load interrupts');
  }
});

extrasRouter.post('/api/v1/missions/:missionId/interrupts/:interruptId/decision', async (req, res) => {
  try {
    const parsed = DecideInterruptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ detail: parsed.error.flatten() });
    }

    const branchId = typeof req.query.branch_id === 'string' ? req.query.branch_id : undefined;
    const input = { ...parsed.data, branch_id: branchId };
    const interrupt = await missionStore.decideInterrupt(req.params.missionId, req.params.interruptId, input);
    if (!interrupt) return res.status(404).json({ detail: 'Interrupt not found or already finalized' });
    const publicInterrupt = missionStore.serializeInterrupt(interrupt);
    await publishMissionEvent(req.params.missionId, 'interrupt.decided', { interrupt: publicInterrupt });
    return res.json(publicInterrupt);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit interrupt decision';
    if (message.toLowerCase().includes('idempotency key conflict')) {
      return res.status(409).json({ detail: message });
    }
    if (
      message.toLowerCase().includes('not supported')
      || message.toLowerCase().includes('stale')
      || message.toLowerCase().includes('structured decision')
      || message.toLowerCase().includes('schema')
    ) {
      return res.status(400).json({ detail: message });
    }
    return respondRouteError(res, error, 'Failed to submit interrupt decision');
  }
});

extrasRouter.post('/api/v1/interrupts/resume', async (req, res) => {
  const parsed = ResumeInterruptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: parsed.error.flatten() });
  }

  const interrupt = await missionStore.resumeInterruptByToken(parsed.data.resume_token, parsed.data.payload ?? {});
  if (!interrupt) return res.status(404).json({ detail: 'Interrupt not found or already finalized' });
  await publishMissionEvent(interrupt.mission_id, 'interrupt.resumed', { interrupt });
  return res.json(interrupt);
});
