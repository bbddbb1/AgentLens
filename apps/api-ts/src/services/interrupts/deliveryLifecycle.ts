import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

export type DeliveryExternalState = 'pending' | 'accepted' | 'failed' | 'stale' | 'unknown';
export type RuntimeOutcomeState =
  | 'awaiting_interaction'
  | 'resumed'
  | 'continued_with_input'
  | 'rejected_or_terminated'
  | 'failed'
  | 'unknown';

const DELIVERY_RANK: Record<DeliveryExternalState, number> = {
  pending: 1,
  unknown: 2,
  failed: 3,
  stale: 3,
  accepted: 4,
};

const OUTCOME_RANK: Record<RuntimeOutcomeState, number> = {
  awaiting_interaction: 1,
  unknown: 2,
  resumed: 3,
  continued_with_input: 3,
  rejected_or_terminated: 3,
  failed: 4,
};

/** Terminal or reserved delivery states that must never be automatically retried. */
const NON_RECLAIMABLE: ReadonlySet<DeliveryExternalState> = new Set([
  'accepted',
  'failed',
  'stale',
  'unknown',
]);

export function canAdvanceDelivery(current: DeliveryExternalState, next: DeliveryExternalState): boolean {
  // Never regress a stronger already-recorded state.
  if (current === 'accepted' && (next === 'pending' || next === 'failed' || next === 'unknown')) {
    return false;
  }
  if (current === 'unknown' && next === 'pending') return false;
  if (current === 'failed' && next === 'pending') return false;
  if (current === 'stale' && next === 'pending') return false;
  return DELIVERY_RANK[next] >= DELIVERY_RANK[current];
}

/**
 * Authoritative monotonic runtime-outcome transition.
 * Late/duplicate events must not regress a stronger already-recorded outcome.
 */
export function canAdvanceRuntimeOutcome(current: RuntimeOutcomeState, next: RuntimeOutcomeState): boolean {
  if (current === next) return true;
  if (current === 'failed') return false;
  if (
    (current === 'resumed' || current === 'continued_with_input' || current === 'rejected_or_terminated')
    && next === 'unknown'
  ) {
    return false;
  }
  if (
    (current === 'resumed' || current === 'continued_with_input' || current === 'rejected_or_terminated')
    && next === 'awaiting_interaction'
  ) {
    return false;
  }
  return OUTCOME_RANK[next] >= OUTCOME_RANK[current];
}

export async function ensureDeliveryAttempt(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    decisionId: string;
  },
): Promise<{ id: string; external_state: DeliveryExternalState; claimed_at?: string | null }> {
  const existing = await client.query(
    `
      SELECT id, external_state, claimed_at FROM interrupt_delivery_attempts
      WHERE decision_id = $1
      LIMIT 1
    `,
    [input.decisionId],
  );
  if (existing.rows[0]) {
    return {
      id: String(existing.rows[0].id),
      external_state: String(existing.rows[0].external_state) as DeliveryExternalState,
      claimed_at: existing.rows[0].claimed_at ? String(existing.rows[0].claimed_at) : null,
    };
  }

  const id = randomUUID();
  const inserted = await client.query(
    `
      INSERT INTO interrupt_delivery_attempts (
        id, mission_id, branch_id, interrupt_id, decision_id, external_state
      ) VALUES ($1, $2, $3, $4, $5, 'pending')
      ON CONFLICT (decision_id) DO UPDATE
        SET updated_at = interrupt_delivery_attempts.updated_at
      RETURNING id, external_state, claimed_at
    `,
    [id, input.missionId, input.branchId, input.interruptId, input.decisionId],
  );
  const row = inserted.rows[0] as Record<string, unknown>;
  await client.query(
    `
      UPDATE interrupts
      SET delivery_state = COALESCE(NULLIF(delivery_state, 'not_requested'), 'pending'),
          delivery_id = COALESCE(delivery_id, $4),
          decision_state = 'recorded',
          updated_at = NOW()
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
    `,
    [input.missionId, input.branchId, input.interruptId, String(row.id)],
  );
  return {
    id: String(row.id),
    external_state: String(row.external_state) as DeliveryExternalState,
    claimed_at: row.claimed_at ? String(row.claimed_at) : null,
  };
}

/**
 * Atomic claim: pending → claimed once → never claimable again.
 * Returns application instruction only on the first successful claim.
 * Repeated polls and Core/Bridge restarts must not reissue the instruction.
 */
export async function claimDelivery(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    bindingId: string;
    claimSeconds?: number;
  },
): Promise<{
  deliveryId?: string;
  decisionId?: string;
  decisionType?: string;
  value?: unknown;
  externalState: DeliveryExternalState;
  claimed: boolean;
}> {
  await markTimedOutClaimsUnknown(client);

  const interrupt = await client.query(
    `
      SELECT decision_id, decision_type, decision_payload, delivery_id, delivery_state, decision_value_summary
      FROM interrupts
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      LIMIT 1
      FOR UPDATE
    `,
    [input.missionId, input.branchId, input.interruptId],
  );
  const row = interrupt.rows[0] as Record<string, unknown> | undefined;
  if (!row?.decision_id) {
    return { externalState: 'pending', claimed: false };
  }

  const delivery = await ensureDeliveryAttempt(client, {
    missionId: input.missionId,
    branchId: input.branchId,
    interruptId: input.interruptId,
    decisionId: String(row.decision_id),
  });

  const externalState = delivery.external_state;
  if (NON_RECLAIMABLE.has(externalState) || delivery.claimed_at) {
    // Already claimed or terminal — never reissue application instruction.
    return {
      deliveryId: delivery.id,
      decisionId: String(row.decision_id),
      decisionType: row.decision_type ? String(row.decision_type) : undefined,
      externalState,
      claimed: false,
    };
  }

  const claimSeconds = input.claimSeconds ?? 60;
  const deadline = new Date(Date.now() + claimSeconds * 1000);

  // Atomic: only the first claimer wins. claimed_at IS NULL is the gate.
  const claimed = await client.query(
    `
      UPDATE interrupt_delivery_attempts
      SET claimed_at = NOW(),
          claiming_binding_id = $2,
          claim_deadline = $3,
          updated_at = NOW()
      WHERE id = $1
        AND external_state = 'pending'
        AND claimed_at IS NULL
      RETURNING id, external_state, claimed_at
    `,
    [delivery.id, input.bindingId, deadline.toISOString()],
  );

  if (!claimed.rows[0]) {
    const current = await client.query(
      `SELECT external_state, claimed_at FROM interrupt_delivery_attempts WHERE id = $1`,
      [delivery.id],
    );
    return {
      deliveryId: delivery.id,
      decisionId: String(row.decision_id),
      decisionType: row.decision_type ? String(row.decision_type) : undefined,
      externalState: String(current.rows[0]?.external_state ?? externalState) as DeliveryExternalState,
      claimed: false,
    };
  }

  return {
    deliveryId: delivery.id,
    decisionId: String(row.decision_id),
    decisionType: row.decision_type ? String(row.decision_type) : undefined,
    value: row.decision_payload,
    externalState: 'pending',
    claimed: true,
  };
}

export async function postDeliveryReceipt(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    deliveryId: string;
    receipt: 'accepted' | 'failed' | 'stale' | 'unknown';
    safeErrorClass?: string;
    receiptCorrelation?: string;
  },
): Promise<DeliveryExternalState> {
  const current = await client.query(
    `SELECT external_state FROM interrupt_delivery_attempts WHERE id = $1 FOR UPDATE`,
    [input.deliveryId],
  );
  if (!current.rows[0]) return 'unknown';
  const existing = String(current.rows[0].external_state) as DeliveryExternalState;
  if (!canAdvanceDelivery(existing, input.receipt)) {
    return existing;
  }

  await client.query(
    `
      UPDATE interrupt_delivery_attempts
      SET external_state = $2::varchar,
          receipt_state = $2::varchar,
          safe_error_class = COALESCE($3, safe_error_class),
          receipt_correlation = COALESCE($4, receipt_correlation),
          accepted_at = CASE WHEN $2::varchar = 'accepted' THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
          failed_at = CASE WHEN $2::varchar = 'failed' THEN COALESCE(failed_at, NOW()) ELSE failed_at END,
          updated_at = NOW()
      WHERE id = $1
    `,
    [input.deliveryId, input.receipt, input.safeErrorClass ?? null, input.receiptCorrelation ?? null],
  );
  await client.query(
    `
      UPDATE interrupts
      SET delivery_state = CASE
            WHEN delivery_state = 'accepted' AND $4::varchar IN ('pending', 'failed', 'unknown', 'stale') THEN delivery_state
            WHEN delivery_state = 'unknown' AND $4::varchar = 'pending' THEN delivery_state
            ELSE $4::varchar
          END,
          updated_at = NOW()
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
    `,
    [input.missionId, input.branchId, input.interruptId, input.receipt],
  );
  return input.receipt;
}

/** A receipt may be posted only by the binding that owns the delivery claim. */
export async function isDeliveryReceiptAuthorized(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    deliveryId: string;
    bindingId: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `
      SELECT delivery.claiming_binding_id, interrupt.authorized_binding_id
      FROM interrupt_delivery_attempts AS delivery
      JOIN interrupts AS interrupt
        ON interrupt.mission_id = delivery.mission_id
       AND interrupt.branch_id = delivery.branch_id
       AND interrupt.interrupt_id = delivery.interrupt_id
      WHERE delivery.id = $1
        AND delivery.mission_id = $2
        AND delivery.branch_id = $3
        AND delivery.interrupt_id = $4
      LIMIT 1
    `,
    [input.deliveryId, input.missionId, input.branchId, input.interruptId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return false;
  const authority = row.claiming_binding_id ?? row.authorized_binding_id;
  return authority !== null && authority !== undefined && String(authority) === input.bindingId;
}

export async function markTimedOutClaimsUnknown(client: PoolClient): Promise<number> {
  const result = await client.query(
    `
      UPDATE interrupt_delivery_attempts
      SET external_state = 'unknown',
          receipt_state = 'unknown',
          updated_at = NOW()
      WHERE external_state = 'pending'
        AND claimed_at IS NOT NULL
        AND claim_deadline IS NOT NULL
        AND claim_deadline < NOW()
      RETURNING id, mission_id, branch_id, interrupt_id
    `,
  );
  for (const row of result.rows) {
    await client.query(
      `
        UPDATE interrupts
        SET delivery_state = CASE
              WHEN delivery_state = 'accepted' THEN delivery_state
              ELSE 'unknown'
            END,
            updated_at = NOW()
        WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      `,
      [row.mission_id, row.branch_id, row.interrupt_id],
    );
  }
  return result.rowCount ?? 0;
}

/**
 * Authoritative runtime-outcome ingestion path.
 * Requires explicit interrupt correlation; unrelated same-thread activity must not call this.
 */
export async function applyRuntimeOutcome(
  client: PoolClient,
  input: {
    missionId: string;
    branchId: string;
    interruptId: string;
    outcome: RuntimeOutcomeState;
    deliveryId?: string;
    correlated?: boolean;
    /** Framework adapters can require a durable Core delivery match. */
    requireDeliveryCorrelation?: boolean;
  },
): Promise<RuntimeOutcomeState> {
  if (input.correlated === false) {
    // Wrong interrupt/delivery correlation or unrelated activity — no-op.
    const current = await client.query(
      `
        SELECT runtime_outcome FROM interrupts
        WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      `,
      [input.missionId, input.branchId, input.interruptId],
    );
    return String(current.rows[0]?.runtime_outcome ?? 'unknown') as RuntimeOutcomeState;
  }

  if (input.requireDeliveryCorrelation && !input.deliveryId) {
    const current = await client.query(
      `SELECT runtime_outcome FROM interrupts WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3`,
      [input.missionId, input.branchId, input.interruptId],
    );
    return String(current.rows[0]?.runtime_outcome ?? 'unknown') as RuntimeOutcomeState;
  }

  if (input.deliveryId) {
    const delivery = await client.query(
      `
        SELECT id FROM interrupt_delivery_attempts
        WHERE id = $1 AND mission_id = $2 AND branch_id = $3 AND interrupt_id = $4
      `,
      [input.deliveryId, input.missionId, input.branchId, input.interruptId],
    );
    if (!delivery.rows[0]) {
      // Wrong delivery correlation for this interrupt — ignore.
      const current = await client.query(
        `
          SELECT runtime_outcome FROM interrupts
          WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
        `,
        [input.missionId, input.branchId, input.interruptId],
      );
      return String(current.rows[0]?.runtime_outcome ?? 'unknown') as RuntimeOutcomeState;
    }
  }

  const current = await client.query(
    `
      SELECT runtime_outcome FROM interrupts
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
      FOR UPDATE
    `,
    [input.missionId, input.branchId, input.interruptId],
  );
  if (!current.rows[0]) return input.outcome;
  const existing = String(current.rows[0].runtime_outcome ?? 'unknown') as RuntimeOutcomeState;
  if (!canAdvanceRuntimeOutcome(existing, input.outcome)) {
    return existing;
  }
  await client.query(
    `
      UPDATE interrupts
      SET runtime_outcome = $4::varchar,
          request_lifecycle = CASE
            WHEN $4::varchar IN ('resumed', 'continued_with_input', 'rejected_or_terminated', 'failed') THEN 'resolved'
            ELSE request_lifecycle
          END,
          updated_at = NOW()
      WHERE mission_id = $1 AND branch_id = $2 AND interrupt_id = $3
    `,
    [input.missionId, input.branchId, input.interruptId, input.outcome],
  );
  return input.outcome;
}
