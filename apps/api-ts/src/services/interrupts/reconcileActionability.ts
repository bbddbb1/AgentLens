/**
 * Authoritative LangGraph governance actionability reconciliation.
 * All control paths (ingest, register, renew, list, serialize, decide, claim)
 * must use evaluateActionability / reconcileInterruptActionability.
 */

import type { PoolClient } from 'pg';
import { isLangGraphGovernanceControlAvailable, isMafGovernanceControlAvailable } from '../../config/features.js';
import {
  expireStaleBindings,
  isBindingLive,
  mapBindingRow,
  type BridgeBindingRow,
} from './bridgeBindings.js';
import {
  matchGovernanceIdentity,
  LANGGRAPH_IDENTITY_POLICY,
  MAF_IDENTITY_POLICY,
  type GovernanceIdentityPolicy,
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
  authorized_binding_id?: string | null;
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
  framework?: 'langgraph' | 'ms_agent_framework';
  identityPolicy?: GovernanceIdentityPolicy;
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

  const framework = input.framework ?? 'langgraph';
  const policy = input.identityPolicy ?? (framework === 'langgraph' ? LANGGRAPH_IDENTITY_POLICY : MAF_IDENTITY_POLICY);
  if (String(input.interrupt.framework ?? '') !== framework) {
    return {
      actionability: 'unsupported',
      governanceAvailable: true,
      reason: `unexpected_framework:${String(input.interrupt.framework ?? '')}`,
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
    framework,
    interaction_request_id:
      asIdentity(input.interrupt.native_identity).interaction_request_id
      ?? asIdentity(input.interrupt.native_identity).interrupt_request_id
      ?? input.interrupt.interrupt_id,
    request_id: asIdentity(input.interrupt.native_identity).request_id ?? input.interrupt.interrupt_id,
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

  const match = matchGovernanceIdentity(observed, bindingIdentity, { policy });

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
    framework?: 'langgraph' | 'ms_agent_framework';
    identityPolicy?: GovernanceIdentityPolicy;
  },
): Promise<ActionabilityEvaluation> {
  const framework = input.framework ?? 'langgraph';
  const policy = input.identityPolicy ?? (framework === 'langgraph' ? LANGGRAPH_IDENTITY_POLICY : MAF_IDENTITY_POLICY);
  await expireStaleBindings(client, input.missionId, input.branchId, framework);

  const interruptResult = await client.query(
    `
      SELECT interrupt_id, mission_id, branch_id, framework, native_identity,
             actionability, decision_state, identity_ambiguous, authorized_binding_id
      FROM interrupts
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      LIMIT 1
    `,
    [input.missionId, input.branchId, input.interruptId],
  );
  const interruptRow = interruptResult.rows[0] as InterruptGovernanceRow | undefined;

  const bindingsResult = await client.query(
    `
      SELECT * FROM framework_bridge_bindings
      WHERE mission_id = $1
        AND branch_id = $2
        AND framework = $3
        AND lifecycle_state = 'active'
        AND lease_expires_at > NOW()
      ORDER BY generation DESC
    `,
    [input.missionId, input.branchId, framework],
  );

  const controlAvailable = framework === 'langgraph'
    ? isLangGraphGovernanceControlAvailable()
    : isMafGovernanceControlAvailable();
  let evaluation: ActionabilityEvaluation = evaluateActionability({
    governanceControlAvailable: controlAvailable,
    interrupt: interruptRow ?? null,
    binding: null,
    identityAmbiguous: input.identityAmbiguous ?? Boolean(interruptRow?.identity_ambiguous),
    framework,
    identityPolicy: policy,
  });

  const bindings = bindingsResult.rows.map((row) => mapBindingRow(row as Record<string, unknown>));
  if (interruptRow && controlAvailable && !evaluation.diagnostic?.includes('ambiguous')) {
    // Keep claim authority with the exact live binding selected for observed
    // native identity. A later matching control ref may not take it over.
    const selected = interruptRow.authorized_binding_id
      ? bindings.find((binding) => binding.id === interruptRow.authorized_binding_id)
      : undefined;
    const candidates = selected && isBindingLive(selected) ? [selected] : bindings;
    for (const binding of candidates) {
      const candidate = evaluateActionability({
        governanceControlAvailable: controlAvailable,
        interrupt: interruptRow,
        binding,
        identityAmbiguous: input.identityAmbiguous ?? Boolean(interruptRow.identity_ambiguous),
        framework,
        identityPolicy: policy,
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
            authorized_binding_id = $6::uuid,
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
        evaluation.actionability === 'actionable' ? evaluation.binding?.id ?? null : null,
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
  framework: 'langgraph' | 'ms_agent_framework' = 'langgraph',
  identityPolicy?: GovernanceIdentityPolicy,
): Promise<void> {
  await expireStaleBindings(client, missionId, branchId, framework);
  const interrupts = await client.query(
    `
      SELECT interrupt_id
      FROM interrupts
      WHERE mission_id = $1
        AND branch_id = $2
        AND framework = $3
        AND decision_state = 'none'
    `,
    [missionId, branchId, framework],
  );
  for (const row of interrupts.rows) {
    await reconcileInterruptActionability(client, {
      missionId,
      branchId,
      interruptId: String(row.interrupt_id),
      framework,
      identityPolicy,
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
    framework?: 'langgraph' | 'ms_agent_framework';
    identityPolicy?: GovernanceIdentityPolicy;
  },
): Promise<ActionabilityEvaluation> {
  const evaluation = await reconcileInterruptActionability(client, input);
  return evaluation;
}
