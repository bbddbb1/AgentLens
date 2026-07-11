import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  matchGovernanceIdentity,
  type GovernanceIdentitySide,
} from './identityMatch.js';

export type BridgeBindingLifecycle = 'active' | 'expired' | 'revoked' | 'consumed';

export interface BridgeBindingRow {
  id: string;
  mission_id: string;
  branch_id: string;
  framework: string;
  interrupt_id?: string;
  interaction_request_id?: string;
  control_ref_hash: string;
  generation: number;
  supersedes_binding_id?: string;
  lifecycle_state: BridgeBindingLifecycle;
  registered_at: string;
  lease_expires_at: string;
  last_heartbeat_at: string;
  native_identity: GovernanceIdentitySide;
}

export function hashControlRef(controlRef: string): string {
  return createHash('sha256').update(controlRef).digest('hex');
}

export function isBindingLive(binding: Pick<BridgeBindingRow, 'lifecycle_state' | 'lease_expires_at'>, now = new Date()): boolean {
  if (binding.lifecycle_state !== 'active') return false;
  return new Date(binding.lease_expires_at).getTime() > now.getTime();
}

export async function registerBridgeBinding(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    controlRef: string;
    leaseSeconds: number;
    nativeIdentity: GovernanceIdentitySide;
    interruptId?: string;
    interactionRequestId?: string;
  },
): Promise<BridgeBindingRow> {
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + Math.max(5, input.leaseSeconds) * 1000);
  const controlRefHash = hashControlRef(input.controlRef);
  const interactionRequestId =
    input.interactionRequestId
    ?? input.nativeIdentity.interaction_request_id
    ?? input.nativeIdentity.interrupt_request_id
    ?? input.interruptId;

  // Supersede prior active bindings for the same scope.
  await client.query(
    `
      UPDATE langgraph_bridge_bindings
      SET lifecycle_state = 'revoked',
          revoked_at = NOW(),
          updated_at = NOW()
      WHERE mission_id = $1
        AND branch_id = $2
        AND lifecycle_state = 'active'
        AND (
          ($3::text IS NOT NULL AND interaction_request_id = $3)
          OR ($4::text IS NOT NULL AND interrupt_id = $4)
        )
    `,
    [input.missionId, input.branchId, interactionRequestId ?? null, input.interruptId ?? null],
  );

  const generationResult = await client.query(
    `
      SELECT COALESCE(MAX(generation), 0) + 1 AS next_generation
      FROM langgraph_bridge_bindings
      WHERE mission_id = $1 AND branch_id = $2
    `,
    [input.missionId, input.branchId],
  );
  const generation = Number(generationResult.rows[0]?.next_generation ?? 1);
  const id = randomUUID();
  const identity = {
    ...input.nativeIdentity,
    mission_id: input.missionId,
    branch_id: input.branchId,
    framework: 'langgraph',
    interaction_request_id: interactionRequestId,
  };

  const result = await client.query(
    `
      INSERT INTO langgraph_bridge_bindings (
        id, mission_id, branch_id, framework, interrupt_id, interaction_request_id,
        control_ref_hash, generation, lifecycle_state, registered_at, lease_expires_at,
        last_heartbeat_at, native_identity
      ) VALUES (
        $1, $2, $3, 'langgraph', $4, $5, $6, $7, 'active', $8, $9, $8, $10::jsonb
      )
      RETURNING *
    `,
    [
      id,
      input.missionId,
      input.branchId,
      input.interruptId ?? null,
      interactionRequestId ?? null,
      controlRefHash,
      generation,
      now.toISOString(),
      leaseExpires.toISOString(),
      JSON.stringify(identity),
    ],
  );

  return mapBindingRow(result.rows[0] as Record<string, unknown>);
}

export async function renewBridgeBinding(
  client: PoolClient,
  input: { missionId: string; branchId: string; controlRef: string; leaseSeconds: number },
): Promise<BridgeBindingRow | null> {
  const hash = hashControlRef(input.controlRef);
  const now = new Date();
  const leaseExpires = new Date(now.getTime() + Math.max(5, input.leaseSeconds) * 1000);
  const result = await client.query(
    `
      UPDATE langgraph_bridge_bindings
      SET lease_expires_at = $4,
          last_heartbeat_at = $5,
          updated_at = NOW()
      WHERE mission_id = $1
        AND branch_id = $2
        AND control_ref_hash = $3
        AND lifecycle_state = 'active'
        AND lease_expires_at > NOW()
      RETURNING *
    `,
    [input.missionId, input.branchId, hash, leaseExpires.toISOString(), now.toISOString()],
  );
  return result.rows[0] ? mapBindingRow(result.rows[0] as Record<string, unknown>) : null;
}

export async function expireStaleBindings(client: PoolClient, missionId: string, branchId: string): Promise<number> {
  const result = await client.query(
    `
      UPDATE langgraph_bridge_bindings
      SET lifecycle_state = 'expired', updated_at = NOW()
      WHERE mission_id = $1
        AND branch_id = $2
        AND lifecycle_state = 'active'
        AND lease_expires_at <= NOW()
    `,
    [missionId, branchId],
  );
  return result.rowCount ?? 0;
}

export async function findLiveBindingForInterrupt(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    observed: GovernanceIdentitySide;
    requireThreadId?: boolean;
  },
): Promise<{ binding?: BridgeBindingRow; matchStatus: string; diagnostic?: string }> {
  await expireStaleBindings(client, input.missionId, input.branchId);
  const result = await client.query(
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

  for (const row of result.rows) {
    const binding = mapBindingRow(row as Record<string, unknown>);
    const match = matchGovernanceIdentity(input.observed, {
      ...binding.native_identity,
      mission_id: binding.mission_id,
      branch_id: binding.branch_id,
      framework: binding.framework,
      interaction_request_id: binding.interaction_request_id,
      interrupt_request_id: binding.interrupt_id,
    }, { requireThreadId: input.requireThreadId });

    if (match.status === 'match' || match.status === 'partial') {
      return { binding, matchStatus: match.status };
    }
    if (match.status === 'conflict') {
      return { matchStatus: 'conflict', diagnostic: match.diagnostic };
    }
  }

  return { matchStatus: 'missing_binding' };
}

export function mapBindingRow(row: Record<string, unknown>): BridgeBindingRow {
  return {
    id: String(row.id),
    mission_id: String(row.mission_id),
    branch_id: String(row.branch_id),
    framework: String(row.framework ?? 'langgraph'),
    interrupt_id: row.interrupt_id ? String(row.interrupt_id) : undefined,
    interaction_request_id: row.interaction_request_id ? String(row.interaction_request_id) : undefined,
    control_ref_hash: String(row.control_ref_hash),
    generation: Number(row.generation ?? 1),
    supersedes_binding_id: row.supersedes_binding_id ? String(row.supersedes_binding_id) : undefined,
    lifecycle_state: String(row.lifecycle_state) as BridgeBindingLifecycle,
    registered_at: new Date(String(row.registered_at)).toISOString(),
    lease_expires_at: new Date(String(row.lease_expires_at)).toISOString(),
    last_heartbeat_at: new Date(String(row.last_heartbeat_at)).toISOString(),
    native_identity: (row.native_identity as GovernanceIdentitySide) ?? {},
  };
}

export async function authenticateBinding(
  client: PoolClient,
  input: { missionId: string; branchId: string; controlRef: string },
): Promise<BridgeBindingRow | null> {
  await expireStaleBindings(client, input.missionId, input.branchId);
  const hash = hashControlRef(input.controlRef);
  const result = await client.query(
    `
      SELECT * FROM langgraph_bridge_bindings
      WHERE mission_id = $1
        AND branch_id = $2
        AND control_ref_hash = $3
        AND lifecycle_state = 'active'
        AND lease_expires_at > NOW()
      ORDER BY generation DESC
      LIMIT 1
    `,
    [input.missionId, input.branchId, hash],
  );
  return result.rows[0] ? mapBindingRow(result.rows[0] as Record<string, unknown>) : null;
}
