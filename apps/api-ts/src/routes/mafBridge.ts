import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { isMafGovernanceControlAvailable } from '../config/features.js';
import { requireFrameworkGovernanceServiceAuth } from '../middleware/serviceAuth.js';
import { registerBridgeBinding, renewBridgeBinding } from '../services/interrupts/bridgeBindings.js';
import { MAF_IDENTITY_POLICY } from '../services/interrupts/identityMatch.js';
import { reconcileMissionBranchActionability } from '../services/interrupts/reconcileActionability.js';
import { missionStore } from '../services/missionStore.js';

export const mafBridgeRouter = Router();

const registerSchema = z.object({
  control_ref: z.string().min(16),
  lease_seconds: z.number().int().positive().max(3600).optional().default(60),
  interaction_request_id: z.string().min(1),
  native_identity: z.record(z.string(), z.unknown()).default({}),
});
const renewSchema = z.object({ control_ref: z.string().min(16), lease_seconds: z.number().int().positive().max(3600).optional().default(60) });

mafBridgeRouter.use((req, res, next) => requireFrameworkGovernanceServiceAuth('ms_agent_framework', req, res, next));

function unavailable(res: import('express').Response): boolean {
  if (isMafGovernanceControlAvailable()) return false;
  res.status(503).json({ detail: 'MAF governance control plane unavailable (enable flag and configure service auth)' });
  return true;
}

mafBridgeRouter.post('/api/v1/missions/:missionId/branches/:branchId/maf/bridge/register', async (req, res) => {
  try {
    if (unavailable(res)) return;
    if (!await missionStore.getMission(req.params.missionId)) return res.status(404).json({ detail: 'Mission not found' });
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
    const identity = parsed.data.native_identity as Record<string, string>;
    if (!identity.workflow_id || !identity.request_id) return res.status(400).json({ detail: 'MAF workflow_id and request_id are required' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const binding = await registerBridgeBinding(client, {
        missionId: req.params.missionId, branchId: req.params.branchId,
        controlRef: parsed.data.control_ref, leaseSeconds: parsed.data.lease_seconds,
        interactionRequestId: parsed.data.interaction_request_id, framework: 'ms_agent_framework',
        nativeIdentity: { ...identity, mission_id: req.params.missionId, branch_id: req.params.branchId, framework: 'ms_agent_framework' },
      });
      await reconcileMissionBranchActionability(client, req.params.missionId, req.params.branchId, 'ms_agent_framework', MAF_IDENTITY_POLICY);
      await client.query('COMMIT');
      return res.status(201).json({ binding_id: binding.id, generation: binding.generation, lifecycle_state: binding.lifecycle_state, lease_expires_at: binding.lease_expires_at });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) { return res.status(500).json({ detail: error instanceof Error ? error.message : 'MAF bridge registration failed' }); }
});

mafBridgeRouter.post('/api/v1/missions/:missionId/branches/:branchId/maf/bridge/renew', async (req, res) => {
  try {
    if (unavailable(res)) return;
    const parsed = renewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
    const client = await pool.connect();
    try {
      const binding = await renewBridgeBinding(client, { missionId: req.params.missionId, branchId: req.params.branchId, controlRef: parsed.data.control_ref, leaseSeconds: parsed.data.lease_seconds, framework: 'ms_agent_framework' });
      if (!binding) return res.status(404).json({ detail: 'Active MAF binding not found' });
      return res.json({ binding_id: binding.id, generation: binding.generation, lifecycle_state: binding.lifecycle_state, lease_expires_at: binding.lease_expires_at });
    } finally { client.release(); }
  } catch (error) { return res.status(500).json({ detail: error instanceof Error ? error.message : 'MAF bridge renewal failed' }); }
});
