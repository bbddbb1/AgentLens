/**
 * Authoritative LangGraph governance actionability reconciliation.
 * All control paths (ingest, register, renew, list, serialize, decide, claim)
 * must use evaluateActionability / reconcileInterruptActionability.
 */

import type { PoolClient } from 'pg';
import { isLangGraphGovernanceControlAvailable } from '../../config/features.js';
import {
  expireStaleBindings,
  isBindingLive,
  mapBindingRow,
  type BridgeBindingRow,
} from './bridgeBindings.js';
import {
  matchGovernanceIdentity,
  type GovernanceIdentitySide,
} from './identityMatch.js';

export type Actionability =
  | 'actionable'
  | 'observed_only'
  | 'unsupported'
  | 'identity_conflict'
  | 'unavailable';

export interface ActionabilityEvaluation {
  actionability: Actionability;
  governanceAvailable: boolean;
  reason: string;
  binding?: BridgeBindingRow;
  matchStatus?: string;
  diagnostic?: string;
}

export interface InterruptGovernanceRow {
  interrupt_id: string;
  mission_id: string;
  branch_id: string;
  framework?: string | null;
  native_identity?: GovernanceIdentitySide | Record<string, unknown> | null;
  actionability?: string | null;
  decision_state?: string | null;
  identity_ambiguous?: boolean | null;
  source_refs?: unknown;
}

function asIdentity(value: unknown): GovernanceIdentitySide {
  if (!value || typeof value !== 'object') return {};
  return value as GovernanceIdentitySide;
}

/**
 * Pure evaluation of whether an observed interrupt may be actionable given a
 * live binding and ambiguity flag. Does not use names/timing/topology/fuzzy/
 * native_execution_key.
 */
export function evaluateActionability(input: {
  governanceControlAvailable: boolean;
  interrupt?: InterruptGovernanceRow | null;
  binding?: BridgeBindingRow | null;
  identityAmbiguous?: boolean;
  requireThreadId?: boolean;
  now?: Date;
}): ActionabilityEvaluation {
  if (!input.governanceControlAvailable) {
    return {
      actionability: 'unavailable',
      governanceAvailable: false,
      reason: 'governance_control_unavailable',
    };
  }

  if (!input.interrupt) {
    return {
      actionability: 'observed_only',
      governanceAvailable: true,
      reason: 'binding_without_interrupt',
    };
  }

  if (String(input.interrupt.framework ?? '') !== 'langgraph') {
    return {
      actionability: 'unsupported',
      governanceAvailable: true,
      reason: 'non_langgraph_framework',
    };
  }

  if (input.identityAmbiguous || input.interrupt.identity_ambiguous) {
    return {
      actionability: 'identity_conflict',
      governanceAvailable: true,
      reason: 'ambiguous_native_identity',
      diagnostic: 'conflicting_native_identity',
    };
  }

  const binding = input.binding;
  if (!binding || !isBindingLive(binding, input.now ?? new Date())) {
    return {
      actionability: 'observed_only',
      governanceAvailable: true,
      reason: binding ? `binding_${binding.lifecycle_state}` : 'missing_binding',
    };
  }

  const observed: GovernanceIdentitySide = {
    ...asIdentity(input.interrupt.native_identity),
    mission_id: input.interrupt.mission_id,
    branch_id: input.interrupt.branch_id,
    framework: 'langgraph',
    interaction_request_id:
      asIdentity(input.interrupt.native_identity).interaction_request_id
      ?? asIdentity(input.interrupt.native_identity).interrupt_request_id
      ?? input.interrupt.interrupt_id,
    interrupt_request_id: input.interrupt.interrupt_id,
  };

  const bindingIdentity: GovernanceIdentitySide = {
    ...binding.native_identity,
    mission_id: binding.mission_id,
    branch_id: binding.branch_id,
    framework: binding.framework,
    interaction_request_id:
      binding.interaction_request_id
      ?? binding.native_identity.interaction_request_id
      ?? binding.native_identity.interrupt_request_id
      ?? binding.interrupt_id,
    interrupt_request_id: binding.interrupt_id,
  };

  const match = matchGovernanceIdentity(observed, bindingIdentity, {
    requireThreadId: input.requireThreadId,
  });

  if (match.status === 'missing_required') {
    return {
      actionability: 'observed_only',
      governanceAvailable: true,
      reason: `missing_required:${match.field}`,
      binding,
      matchStatus: match.status,
    };
  }

  if (match.status === 'conflict') {
    return {
      actionability: 'identity_conflict',
      governanceAvailable: true,
      reason: match.diagnostic,
      binding,
      matchStatus: match.status,
      diagnostic: match.diagnostic,
    };
  }

  // match or partial (optional fields absent on one side) → actionable
  return {
    actionability: 'actionable',
    governanceAvailable: true,
    reason: match.status === 'partial' ? 'partial_identity_match' : 'exact_identity_match',
    binding,
    matchStatus: match.status,
  };
}

/**
 * Persist authoritative actionability for one interrupt using live bindings.
 */
export async function reconcileInterruptActionability(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    identityAmbiguous?: boolean;
    requireThreadId?: boolean;
  },
): Promise<ActionabilityEvaluation> {
  await expireStaleBindings(client, input.missionId, input.branchId);

  const interruptResult = await client.query(
    `
      SELECT interrupt_id, mission_id, branch_id, framework, native_identity,
             actionability, decision_state, identity_ambiguous
      FROM interrupts
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      LIMIT 1
    `,
    [input.missionId, input.branchId, input.interruptId],
  );
  const interruptRow = interruptResult.rows[0] as InterruptGovernanceRow | undefined;

  const bindingsResult = await client.query(
    `
      SELECT * FROM langgraph_bridge_bindings
      WHERE mission_id = $1
        AND branch_id = $2
        AND lifecycle_state = 'active'
        AND lease_expires_at > NOW()
      ORDER BY generation DESC
    `,
    [input.missionId, input.branchId],
  );

  const controlAvailable = isLangGraphGovernanceControlAvailable();
  let evaluation: ActionabilityEvaluation = evaluateActionability({
    governanceControlAvailable: controlAvailable,
    interrupt: interruptRow ?? null,
    binding: null,
    identityAmbiguous: input.identityAmbiguous ?? Boolean(interruptRow?.identity_ambiguous),
    requireThreadId: input.requireThreadId,
  });

  if (interruptRow && controlAvailable && !evaluation.diagnostic?.includes('ambiguous')) {
    for (const row of bindingsResult.rows) {
      const binding = mapBindingRow(row as Record<string, unknown>);
      const candidate = evaluateActionability({
        governanceControlAvailable: controlAvailable,
        interrupt: interruptRow,
        binding,
        identityAmbiguous: input.identityAmbiguous ?? Boolean(interruptRow.identity_ambiguous),
        requireThreadId: input.requireThreadId,
      });
      evaluation = candidate;
      if (candidate.actionability === 'actionable' || candidate.actionability === 'identity_conflict') {
        break;
      }
    }
  }

  if (interruptRow) {
    await client.query(
      `
        UPDATE interrupts
        SET actionability = $4,
            identity_ambiguous = CASE
              WHEN $5::boolean THEN TRUE
              ELSE identity_ambiguous
            END,
            updated_at = NOW()
        WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      `,
      [
        input.missionId,
        input.branchId,
        input.interruptId,
        evaluation.actionability,
        evaluation.actionability === 'identity_conflict',
      ],
    );
  }

  return evaluation;
}

/**
 * Reconcile all LangGraph interrupts in a mission/branch scope (e.g. after register/renew).
 */
export async function reconcileMissionBranchActionability(
  client: PoolClient,
  missionId: string,
  branchId: string,
): Promise<void> {
  await expireStaleBindings(client, missionId, branchId);
  const interrupts = await client.query(
    `
      SELECT interrupt_id
      FROM interrupts
      WHERE mission_id = $1
        AND branch_id = $2
        AND framework = 'langgraph'
        AND decision_state = 'none'
    `,
    [missionId, branchId],
  );
  for (const row of interrupts.rows) {
    await reconcileInterruptActionability(client, {
      missionId,
      branchId,
      interruptId: String(row.interrupt_id),
    });
  }
}

/**
 * Live check used by decide/claim: returns true only if currently actionable.
 */
export async function assertCurrentlyActionable(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    requireThreadId?: boolean;
  },
): Promise<ActionabilityEvaluation> {
  const evaluation = await reconcileInterruptActionability(client, input);
  return evaluation;
}
