import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/postgres.js';
import { isLangGraphGovernanceControlAvailable } from '../config/features.js';
import { requireGovernanceServiceAuth } from '../middleware/serviceAuth.js';
import {
  authenticateBinding,
  registerBridgeBinding,
  renewBridgeBinding,
} from '../services/interrupts/bridgeBindings.js';
import {
  claimDelivery,
  isDeliveryReceiptAuthorized,
  markTimedOutClaimsUnknown,
  postDeliveryReceipt,
} from '../services/interrupts/deliveryLifecycle.js';
import {
  assertCurrentlyActionable,
  reconcileMissionBranchActionability,
} from '../services/interrupts/reconcileActionability.js';
import { LANGGRAPH_IDENTITY_POLICY } from '../services/interrupts/identityMatch.js';
import { missionStore } from '../services/missionStore.js';
import { publishMissionEvent } from '../realtime/events.js';

export const langGraphBridgeRouter = Router();

const registerSchema = z.object({
  control_ref: z.string().min(16),
  lease_seconds: z.number().int().positive().max(3600).optional().default(60),
  interrupt_id: z.string().min(1).optional(),
  interaction_request_id: z.string().min(1).optional(),
  native_identity: z.record(z.string(), z.unknown()).optional().default({}),
});

const renewSchema = z.object({
  control_ref: z.string().min(16),
  lease_seconds: z.number().int().positive().max(3600).optional().default(60),
});

const claimSchema = z.object({
  control_ref: z.string().min(16),
  interrupt_id: z.string().min(1),
  claim_seconds: z.number().int().positive().max(600).optional().default(60),
});

const receiptSchema = z.object({
  control_ref: z.string().min(16),
  interrupt_id: z.string().min(1),
  delivery_id: z.string().uuid(),
  receipt: z.enum(['accepted', 'failed', 'stale', 'unknown']),
  safe_error_class: z.string().optional(),
  receipt_correlation: z.string().optional(),
});

langGraphBridgeRouter.use(
  '/api/v1/missions/:missionId/branches/:branchId/langgraph/bridge',
  requireGovernanceServiceAuth,
);

function governanceControlUnavailable(res: import('express').Response): boolean {
  if (isLangGraphGovernanceControlAvailable()) return false;
  res.status(503).json({
    detail: 'LangGraph governance control plane unavailable (enable flag and configure service auth)',
  });
  return true;
}

langGraphBridgeRouter.post(
  '/api/v1/missions/:missionId/branches/:branchId/langgraph/bridge/register',
  async (req, res) => {
    try {
      if (governanceControlUnavailable(res)) return;
      const mission = await missionStore.getMission(req.params.missionId);
      if (!mission) return res.status(404).json({ detail: 'Mission not found' });
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const binding = await registerBridgeBinding(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          controlRef: parsed.data.control_ref,
          leaseSeconds: parsed.data.lease_seconds,
          interruptId: parsed.data.interrupt_id,
          interactionRequestId: parsed.data.interaction_request_id,
          framework: 'langgraph',
          nativeIdentity: {
            ...(parsed.data.native_identity as Record<string, string>),
            mission_id: req.params.missionId,
            branch_id: req.params.branchId,
            framework: 'langgraph',
          },
        });
        // Exact identity reconciliation for all interrupts in scope (not interrupt-id alone).
        await reconcileMissionBranchActionability(client, req.params.missionId, req.params.branchId, 'langgraph', LANGGRAPH_IDENTITY_POLICY);
        await client.query('COMMIT');
        return res.status(201).json({
          binding_id: binding.id,
          generation: binding.generation,
          lifecycle_state: binding.lifecycle_state,
          lease_expires_at: binding.lease_expires_at,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        return res.status(409).json({ reason: 'active_control_authority_conflict' });
      }
      const message = error instanceof Error ? error.message : 'Bridge registration failed';
      return res.status(500).json({ detail: message });
    }
  },
);

langGraphBridgeRouter.post(
  '/api/v1/missions/:missionId/branches/:branchId/langgraph/bridge/renew',
  async (req, res) => {
    try {
      if (governanceControlUnavailable(res)) return;
      const parsed = renewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const binding = await renewBridgeBinding(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          controlRef: parsed.data.control_ref,
          leaseSeconds: parsed.data.lease_seconds,
          framework: 'langgraph',
        });
        if (!binding) {
          await client.query('ROLLBACK');
          return res.status(404).json({ detail: 'Active binding not found' });
        }
        await reconcileMissionBranchActionability(client, req.params.missionId, req.params.branchId, 'langgraph', LANGGRAPH_IDENTITY_POLICY);
        await client.query('COMMIT');
        return res.json({
          binding_id: binding.id,
          generation: binding.generation,
          lifecycle_state: binding.lifecycle_state,
          lease_expires_at: binding.lease_expires_at,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bridge renew failed';
      return res.status(500).json({ detail: message });
    }
  },
);

langGraphBridgeRouter.post(
  '/api/v1/missions/:missionId/branches/:branchId/langgraph/bridge/claim',
  async (req, res) => {
    try {
      if (governanceControlUnavailable(res)) return;
      const parsed = claimSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await markTimedOutClaimsUnknown(client);
        const binding = await authenticateBinding(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          controlRef: parsed.data.control_ref,
          framework: 'langgraph',
        });
        if (!binding) {
          await client.query('ROLLBACK');
          return res.status(401).json({ detail: 'Unauthorized binding' });
        }

        const actionable = await assertCurrentlyActionable(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          interruptId: parsed.data.interrupt_id,
          framework: 'langgraph',
          identityPolicy: LANGGRAPH_IDENTITY_POLICY,
        });
        if (actionable.actionability !== 'actionable') {
          await client.query('COMMIT');
          return res.status(409).json({
            detail: 'Interrupt is not actionable',
            actionability: actionable.actionability,
            reason: actionable.reason,
          });
        }
        if (!actionable.binding || actionable.binding.id !== binding.id) {
          await client.query('COMMIT');
          return res.status(409).json({
            detail: 'Authenticated binding does not own this request',
            actionability: 'observed_only',
            reason: 'authenticated_binding_does_not_match_request',
          });
        }

        const claim = await claimDelivery(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          interruptId: parsed.data.interrupt_id,
          bindingId: binding.id,
          claimSeconds: parsed.data.claim_seconds,
        });
        await client.query('COMMIT');

        return res.json({
          claimed: claim.claimed,
          delivery_id: claim.deliveryId,
          delivery_state: claim.externalState,
          interaction_request_id: parsed.data.interrupt_id,
          decision_id: claim.decisionId,
          decision_type: claim.decisionType,
          value: claim.claimed ? claim.value : undefined,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bridge claim failed';
      return res.status(500).json({ detail: message });
    }
  },
);

langGraphBridgeRouter.post(
  '/api/v1/missions/:missionId/branches/:branchId/langgraph/bridge/receipt',
  async (req, res) => {
    try {
      if (governanceControlUnavailable(res)) return;
      const parsed = receiptSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ detail: parsed.error.flatten() });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const binding = await authenticateBinding(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          controlRef: parsed.data.control_ref,
          framework: 'langgraph',
        });
        if (!binding) {
          await client.query('ROLLBACK');
          return res.status(401).json({ detail: 'Unauthorized binding' });
        }

        const authorized = await isDeliveryReceiptAuthorized(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          interruptId: parsed.data.interrupt_id,
          deliveryId: parsed.data.delivery_id,
          bindingId: binding.id,
        });
        if (!authorized) {
          await client.query('ROLLBACK');
          return res.status(409).json({ detail: 'Binding is not authorized to receipt this delivery' });
        }

        const state = await postDeliveryReceipt(client, {
          missionId: req.params.missionId,
          branchId: req.params.branchId,
          interruptId: parsed.data.interrupt_id,
          deliveryId: parsed.data.delivery_id,
          receipt: parsed.data.receipt,
          safeErrorClass: parsed.data.safe_error_class,
          receiptCorrelation: parsed.data.receipt_correlation,
          bindingId: binding.id,
        });
        await client.query('COMMIT');
        await publishMissionEvent(req.params.missionId, 'replay.updated', {
          branch_id: req.params.branchId,
          reason: 'governance_delivery_receipt',
        }).catch(() => {});
        return res.json({ delivery_id: parsed.data.delivery_id, delivery_state: state });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bridge receipt failed';
      return res.status(500).json({ detail: message });
    }
  },
);
