import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { isMafGovernanceControlAvailable } from '../config/features.js';
import { requireFrameworkGovernanceServiceAuth } from '../middleware/serviceAuth.js';
import { authenticateBinding, registerBridgeBinding, renewBridgeBinding } from '../services/interrupts/bridgeBindings.js';
import { MAF_IDENTITY_POLICY } from '../services/interrupts/identityMatch.js';
import { assertCurrentlyActionable, reconcileMissionBranchActionability } from '../services/interrupts/reconcileActionability.js';
import { claimDelivery, postDeliveryReceipt } from '../services/interrupts/deliveryLifecycle.js';
import { missionStore } from '../services/missionStore.js';

export const mafBridgeRouter = Router();

const registerSchema = z.object({
  control_ref: z.string().min(16),
  lease_seconds: z.number().int().positive().max(3600).optional().default(60),
  interaction_request_id: z.string().min(1),
  native_identity: z.record(z.string(), z.unknown()).default({}),
});
const renewSchema = z.object({ control_ref: z.string().min(16), lease_seconds: z.number().int().positive().max(3600).optional().default(60) });
const claimSchema = z.object({ control_ref: z.string().min(16), interrupt_id: z.string().min(1), claim_seconds: z.number().int().positive().max(600).optional().default(60) });
const receiptSchema = z.object({ control_ref: z.string().min(16), interrupt_id: z.string().min(1), delivery_id: z.string().uuid(), receipt: z.enum(['accepted', 'failed', 'stale', 'unknown']), safe_error_class: z.string().optional() });

mafBridgeRouter.use(
  '/api/v1/missions/:missionId/branches/:branchId/maf/bridge',
  (req, res, next) => requireFrameworkGovernanceServiceAuth('ms_agent_framework', req, res, next),
);

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

mafBridgeRouter.post('/api/v1/missions/:missionId/branches/:branchId/maf/bridge/claim', async (req, res) => {
  try {
    if (unavailable(res)) return;
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const binding = await authenticateBinding(client, { missionId: req.params.missionId, branchId: req.params.branchId, controlRef: parsed.data.control_ref, framework: 'ms_agent_framework' });
      if (!binding) { await client.query('ROLLBACK'); return res.status(401).json({ detail: 'Unauthorized MAF binding' }); }
      const actionable = await assertCurrentlyActionable(client, { missionId: req.params.missionId, branchId: req.params.branchId, interruptId: parsed.data.interrupt_id, framework: 'ms_agent_framework', identityPolicy: MAF_IDENTITY_POLICY });
      if (actionable.actionability !== 'actionable') { await client.query('COMMIT'); return res.status(409).json({ actionability: actionable.actionability, reason: actionable.reason }); }
      if (!actionable.binding || actionable.binding.id !== binding.id) {
        await client.query('COMMIT');
        return res.status(409).json({ actionability: 'observed_only', reason: 'authenticated_binding_does_not_match_request' });
      }
      const claim = await claimDelivery(client, { missionId: req.params.missionId, branchId: req.params.branchId, interruptId: parsed.data.interrupt_id, bindingId: binding.id, claimSeconds: parsed.data.claim_seconds });
      await client.query('COMMIT');
      return res.json({ claimed: claim.claimed, delivery_id: claim.deliveryId, delivery_state: claim.externalState, decision_id: claim.decisionId, decision_type: claim.decisionType, value: claim.claimed ? claim.value : undefined });
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  } catch (error) { return res.status(500).json({ detail: error instanceof Error ? error.message : 'MAF bridge claim failed' }); }
});

mafBridgeRouter.post('/api/v1/missions/:missionId/branches/:branchId/maf/bridge/receipt', async (req, res) => {
  try {
    if (unavailable(res)) return;
    const parsed = receiptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
    const client = await pool.connect();
    try {
      const binding = await authenticateBinding(client, { missionId: req.params.missionId, branchId: req.params.branchId, controlRef: parsed.data.control_ref, framework: 'ms_agent_framework' });
      if (!binding) return res.status(401).json({ detail: 'Unauthorized MAF binding' });
      const state = await postDeliveryReceipt(client, { missionId: req.params.missionId, branchId: req.params.branchId, interruptId: parsed.data.interrupt_id, deliveryId: parsed.data.delivery_id, receipt: parsed.data.receipt, safeErrorClass: parsed.data.safe_error_class });
      return res.json({ delivery_id: parsed.data.delivery_id, delivery_state: state });
    } finally { client.release(); }
  } catch (error) { return res.status(500).json({ detail: error instanceof Error ? error.message : 'MAF bridge receipt failed' }); }
});
