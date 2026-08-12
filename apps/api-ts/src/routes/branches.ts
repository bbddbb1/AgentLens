import { Router, type Response } from 'express';
import { CreateReplayBranchSchema } from '@agentlens/protocol';
import { publishMissionEvent } from '../realtime/events.js';
import { missionStore } from '../services/missionStore.js';
import { pool } from '../db/postgres.js';
import { BranchClassifier } from '../services/runtime/BranchClassifier.js';
import { randomUUID } from 'node:crypto';

export const branchesRouter = Router();

function respondRouteError(res: Response, error: unknown, fallback: string): void {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();
  const status = lower.includes('timeout') || lower.includes('connect') ? 503 : 500;
  res.status(status).json({ detail: message || fallback });
}

branchesRouter.get('/api/v1/missions/:missionId/replay/branches', async (req, res) => {
  try {
    const branches = await missionStore.listReplayBranches(req.params.missionId);
    if (!branches) return res.status(404).json({ detail: 'Mission not found' });
    return res.json({ branches });
  } catch (error) {
    return respondRouteError(res, error, 'Failed to load replay branches');
  }
});

branchesRouter.post('/api/v1/missions/:missionId/replay/branches', async (req, res) => {
  try {
    const parsed = CreateReplayBranchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ detail: parsed.error.flatten() });
    }
    
    const forkedSequenceNum = parsed.data.forked_from_sequence_num;
    if (forkedSequenceNum === undefined) {
      return res.status(400).json({ detail: 'forked_from_sequence_num is required' });
    }

    // Validate active executor
    const executorRes = await pool.query(
      `SELECT id FROM branch_executor_specs WHERE mission_id = $1 AND is_active = true LIMIT 1`,
      [req.params.missionId]
    );
    if (executorRes.rowCount === 0) {
      return res.status(409).json({ detail: 'executor_not_configured' });
    }
    const executorId = executorRes.rows[0].id;

    // Validate fork point is branchable
    const sourceBranchId = parsed.data.source_branch_id ?? 'main';
    const audit = await missionStore.getAuditEvents(req.params.missionId, sourceBranchId, forkedSequenceNum);
    const frameEvents = audit.events.filter((candidate) => candidate.sequence_num === forkedSequenceNum);
    if (frameEvents.length === 0) {
      return res.status(422).json({ detail: 'non_branchable_fork_point' });
    }
    const classification = frameEvents
      .map((event) => BranchClassifier.classify(event))
      .find((candidate) => candidate.capability.is_branchable);

    if (!classification) {
      return res.status(422).json({ detail: 'non_branchable_fork_point' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const branch = await missionStore.createReplayBranch(req.params.missionId, parsed.data);
      if (!branch) {
        await client.query('ROLLBACK');
        return res.status(404).json({ detail: 'Mission not found' });
      }

      const jobId = randomUUID();
      await client.query(
        `INSERT INTO branch_sandbox_jobs (id, branch_id, mission_id, executor_id, status)
         VALUES ($1, $2, $3, $4, 'queued')`,
        [jobId, branch.id, branch.mission_id, executorId]
      );

      const jobResult = await client.query(`SELECT * FROM branch_sandbox_jobs WHERE id = $1`, [jobId]);
      
      await client.query('COMMIT');

      const job = jobResult.rows[0];
      await publishMissionEvent(req.params.missionId, 'replay.branch.created', { branch });
      await publishMissionEvent(req.params.missionId, 'branch.sandbox.queued', { job });

      return res.status(201).json({ branch, job });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    return respondRouteError(res, error, 'Failed to create replay branch');
  }
});

branchesRouter.post('/api/v1/missions/:missionId/branch-executors', async (req, res) => {
  try {
    const { name, docker_image, python_entrypoint, timeout_seconds, resource_limits, env_allowlist, is_active } = req.body;
    const id = randomUUID();
    
    // Ensure the mission exists to satisfy the foreign key constraint
    await pool.query(
      `INSERT INTO missions (id, objective, status, phase)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [req.params.missionId, 'Pending Mission', 'active', 'planning']
    );

    const imageToUse = docker_image === 'python:3.11-slim' ? 'agentlens-demo' : docker_image;

    const result = await pool.query(
      `INSERT INTO branch_executor_specs (id, mission_id, name, docker_image, python_entrypoint, timeout_seconds, resource_limits, env_allowlist, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
       RETURNING *`,
      [id, req.params.missionId, name, imageToUse, python_entrypoint, timeout_seconds || 300, JSON.stringify(resource_limits || {}), JSON.stringify(env_allowlist || []), is_active !== false]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to register branch executor');
  }
});

branchesRouter.get('/api/v1/missions/:missionId/branch-jobs', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM branch_sandbox_jobs WHERE mission_id = $1 ORDER BY created_at DESC`,
      [req.params.missionId]
    );
    return res.json({ jobs: result.rows });
  } catch (error) {
    return respondRouteError(res, error, 'Failed to list branch jobs');
  }
});

branchesRouter.get('/api/v1/missions/:missionId/branch-jobs/:jobId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM branch_sandbox_jobs WHERE id = $1 AND mission_id = $2`,
      [req.params.jobId, req.params.missionId]
    );
    if (result.rowCount === 0) return res.status(404).json({ detail: 'Job not found' });
    
    const logsResult = await pool.query(
      `SELECT * FROM branch_sandbox_logs WHERE job_id = $1 ORDER BY timestamp ASC`,
      [req.params.jobId]
    );
    
    return res.json({ job: result.rows[0], logs: logsResult.rows });
  } catch (error) {
    return respondRouteError(res, error, 'Failed to get branch job');
  }
});

branchesRouter.post('/api/v1/missions/:missionId/branch-jobs/:jobId/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE branch_sandbox_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND mission_id = $2 AND status IN ('queued', 'starting', 'running') RETURNING *`,
      [req.params.jobId, req.params.missionId]
    );
    if (result.rowCount === 0) return res.status(404).json({ detail: 'Job not found or already finished' });
    return res.json(result.rows[0]);
  } catch (error) {
    return respondRouteError(res, error, 'Failed to cancel branch job');
  }
});
