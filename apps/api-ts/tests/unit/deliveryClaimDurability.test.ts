/**
 * In-memory simulation of Core delivery claim durability.
 * Real: claim state machine logic. Mocked: PostgreSQL (replaced by Map).
 */
import { describe, expect, it } from 'vitest';
import { canAdvanceDelivery } from '../../src/services/interrupts/deliveryLifecycle.js';

interface DeliveryRow {
  id: string;
  decisionId: string;
  external_state: 'pending' | 'accepted' | 'failed' | 'stale' | 'unknown';
  claimed_at: string | null;
  claiming_binding_id: string | null;
  claim_deadline: string | null;
  value: unknown;
}

class InMemoryDeliveryCore {
  private rows = new Map<string, DeliveryRow>();

  createPending(decisionId: string, value: unknown): DeliveryRow {
    const existing = [...this.rows.values()].find((row) => row.decisionId === decisionId);
    if (existing) return existing;
    const row: DeliveryRow = {
      id: `del-${this.rows.size + 1}`,
      decisionId,
      external_state: 'pending',
      claimed_at: null,
      claiming_binding_id: null,
      claim_deadline: null,
      value,
    };
    this.rows.set(row.id, row);
    return row;
  }

  /** Atomic claim: pending + claimed_at IS NULL → claim once. */
  claim(deliveryId: string, bindingId: string): { claimed: boolean; value?: unknown; state: string } {
    const row = this.rows.get(deliveryId);
    if (!row) return { claimed: false, state: 'missing' };
    if (row.external_state !== 'pending' || row.claimed_at) {
      return { claimed: false, state: row.external_state };
    }
    row.claimed_at = new Date().toISOString();
    row.claiming_binding_id = bindingId;
    row.claim_deadline = new Date(Date.now() + 60_000).toISOString();
    return { claimed: true, value: row.value, state: 'pending' };
  }

  /** Simulate Core restart: rows persist; claimed work is not reset to unclaimed. */
  restartSnapshot(): InMemoryDeliveryCore {
    const next = new InMemoryDeliveryCore();
    for (const [id, row] of this.rows) {
      next.rows.set(id, { ...row });
    }
    return next;
  }

  expireClaim(deliveryId: string): void {
    const row = this.rows.get(deliveryId);
    if (!row || row.external_state !== 'pending' || !row.claimed_at) return;
    row.external_state = 'unknown';
  }

  receipt(deliveryId: string, receipt: DeliveryRow['external_state']): string {
    const row = this.rows.get(deliveryId);
    if (!row) return 'missing';
    if (!canAdvanceDelivery(row.external_state, receipt)) return row.external_state;
    row.external_state = receipt;
    return row.external_state;
  }
}

describe('Core durable at-most-once claim (in-memory harness)', () => {
  it('issues application instruction to at most one binding', () => {
    const core = new InMemoryDeliveryCore();
    const delivery = core.createPending('dec-1', { decision: 'approve' });
    const first = core.claim(delivery.id, 'binding-a');
    const second = core.claim(delivery.id, 'binding-b');
    expect(first.claimed).toBe(true);
    expect(first.value).toEqual({ decision: 'approve' });
    expect(second.claimed).toBe(false);
    expect(second.value).toBeUndefined();
  });

  it('does not reissue after Core restart once claimed', () => {
    const core = new InMemoryDeliveryCore();
    const delivery = core.createPending('dec-1', { decision: 'approve' });
    expect(core.claim(delivery.id, 'binding-a').claimed).toBe(true);
    const afterRestart = core.restartSnapshot();
    const again = afterRestart.claim(delivery.id, 'binding-fresh');
    expect(again.claimed).toBe(false);
  });

  it('moves timed-out claims to unknown and never retries', () => {
    const core = new InMemoryDeliveryCore();
    const delivery = core.createPending('dec-1', { decision: 'approve' });
    core.claim(delivery.id, 'binding-a');
    core.expireClaim(delivery.id);
    expect(core.claim(delivery.id, 'binding-b').claimed).toBe(false);
    expect(core.receipt(delivery.id, 'pending')).toBe('unknown');
  });
});
