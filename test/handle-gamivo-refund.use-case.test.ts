/**
 * Wire-format regression suite for `HandleGamivoRefundUseCase`.
 *
 * Locks the behaviour required by the Gamivo Import API spec
 * (public-api-import.pdf §"Order refund notification"):
 *
 *   POST /refund
 *     204 -> No Content   (every success path)
 *     400/401/404 -> { code, message }
 *
 * Critical contract: `refunded_keys_count` is CUMULATIVE per the spec —
 * not the delta. Repeat notifications must be idempotent.
 *
 * Internal flows by reservation status:
 *   - pending     -> release claimed (not-yet-provisioned) keys back to available
 *   - provisioned -> FIFO partial restock for the newly-refunded delta
 *   - other (cancelled/expired/failed) -> no-op terminal write
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleGamivoRefundUseCase } from '../src/core/use-cases/seller-webhook/gamivo/handle-gamivo-refund.use-case.js';
import { TableStubDatabase, StubKeyOps, StubEvents } from './helpers/gamivo-test-stubs.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const RESERVATION_ID = '00000000-1be0-11e9-aaaa-0123456789ab';
const ORDER_ID = '0000acfa-1be0-11e9-aaaa-0xxxxxxxxxx5';
const REFUNDED_AT = '2021-07-20 13:33:22';
const LISTING_ID = 'eb4e1b68-261a-4b7e-b5eb-968c8213661e';

interface ReservationOverrides {
  status?: 'pending' | 'expired' | 'provisioned' | 'cancelled' | 'failed';
  quantity?: number;
}

function makeReservation(o: ReservationOverrides = {}) {
  return {
    id: RESERVATION_ID,
    seller_listing_id: LISTING_ID,
    status: o.status ?? 'provisioned',
    quantity: o.quantity ?? 4,
  };
}

interface SetupOpts {
  reservation?: ReturnType<typeof makeReservation> | null;
  provisions?: Array<{ id: string; status: 'delivered' | 'refunded' | 'failed' }>;
}

function makeUseCase(opts: SetupOpts = {}) {
  const db = new TableStubDatabase();
  const keyOps = new StubKeyOps();
  const events = new StubEvents();

  db.setQueryOne('seller_stock_reservations', () =>
    opts.reservation === undefined ? makeReservation() : opts.reservation);
  db.setQuery('seller_key_provisions', () => opts.provisions ?? []);

  const useCase = new HandleGamivoRefundUseCase(db, keyOps, events);
  return { db, keyOps, events, useCase };
}

function buildDto(overrides: Partial<{ refundedKeysCount: number }> = {}) {
  return {
    orderId: ORDER_ID,
    reservationId: RESERVATION_ID,
    refundedAt: REFUNDED_AT,
    refundedKeysCount: 4,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('HandleGamivoRefundUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 when reservation is missing (idempotent — Gamivo retries are normal)', async () => {
    const { useCase, keyOps, events } = makeUseCase({ reservation: null });

    const result = await useCase.execute(buildDto());

    expect(result).toEqual({ status: 204 });
    expect(keyOps.releaseReservationKeys).not.toHaveBeenCalled();
    expect(keyOps.handlePostProvisionReturn).not.toHaveBeenCalled();
    expect(events.sellerEvents).toHaveLength(0);
  });

  it('emits seller.sale_refunded BEFORE inspecting reservation status (audit even on no-ops)', async () => {
    const { useCase, events } = makeUseCase({
      reservation: makeReservation({ status: 'cancelled' }),
    });

    await useCase.execute(buildDto());

    expect(events.sellerEvents).toEqual([
      expect.objectContaining({
        eventType: 'seller.sale_refunded',
        aggregateId: RESERVATION_ID,
        payload: expect.objectContaining({
          providerCode: 'gamivo',
          externalOrderId: ORDER_ID,
          reservationId: RESERVATION_ID,
          refunded_at: REFUNDED_AT,
          refunded_keys_count: 4,
        }),
      }),
    ]);
  });

  it('pending reservation: releases claimed keys back to available with reason=cancelled', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'pending' }),
    });

    const result = await useCase.execute(buildDto());

    expect(result).toEqual({ status: 204 });
    expect(keyOps.releaseReservationKeys).toHaveBeenCalledWith(RESERVATION_ID, 'cancelled');
    expect(keyOps.handlePostProvisionReturn).not.toHaveBeenCalled();
  });

  it('provisioned reservation: refunds the FULL delta on first notification', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned' }),
      provisions: [
        { id: 'p1', status: 'delivered' },
        { id: 'p2', status: 'delivered' },
        { id: 'p3', status: 'delivered' },
        { id: 'p4', status: 'delivered' },
      ],
    });

    const result = await useCase.execute(buildDto({ refundedKeysCount: 4 }));

    expect(result).toEqual({ status: 204 });
    expect(keyOps.handlePostProvisionReturn).toHaveBeenCalledWith(expect.objectContaining({
      providerCode: 'gamivo',
      externalOrderId: ORDER_ID,
      reason: 'gamivo_refund',
      maxKeysToRestock: 4,
      // Cumulative event id ensures repeat notifications dedupe in the ledger.
      refundEventId: `gamivo:${RESERVATION_ID}:4`,
    }));
  });

  it('provisioned reservation: cumulative semantics — second notification refunds only the delta', async () => {
    // Spec: refunded_keys_count is the TOTAL refunded, not per-event delta.
    // 2 already locally marked refunded, second notification says total 4 → refund 2 more.
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned' }),
      provisions: [
        { id: 'p1', status: 'refunded' },
        { id: 'p2', status: 'refunded' },
        { id: 'p3', status: 'delivered' },
        { id: 'p4', status: 'delivered' },
      ],
    });

    await useCase.execute(buildDto({ refundedKeysCount: 4 }));

    expect(keyOps.handlePostProvisionReturn).toHaveBeenCalledWith(expect.objectContaining({
      maxKeysToRestock: 2, // 4 cumulative - 2 already refunded = 2 new.
      refundEventId: `gamivo:${RESERVATION_ID}:4`,
    }));
  });

  it('provisioned reservation: replay with same cumulative count is a no-op (idempotent)', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned' }),
      provisions: [
        { id: 'p1', status: 'refunded' },
        { id: 'p2', status: 'refunded' },
        { id: 'p3', status: 'delivered' },
      ],
    });

    const result = await useCase.execute(buildDto({ refundedKeysCount: 2 }));

    expect(result).toEqual({ status: 204 });
    expect(keyOps.handlePostProvisionReturn).not.toHaveBeenCalled();
  });

  it('provisioned reservation: caps maxKeysToRestock at totalProvisioned (defends against bad cumulative count)', async () => {
    // Gamivo sends refunded_keys_count=10 but we only ever provisioned 3 keys.
    // Restock capped at 3 — never report a refund larger than what was sold.
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned', quantity: 3 }),
      provisions: [
        { id: 'p1', status: 'delivered' },
        { id: 'p2', status: 'delivered' },
        { id: 'p3', status: 'delivered' },
      ],
    });

    await useCase.execute(buildDto({ refundedKeysCount: 10 }));

    expect(keyOps.handlePostProvisionReturn).toHaveBeenCalledWith(expect.objectContaining({
      maxKeysToRestock: 3,
      refundEventId: `gamivo:${RESERVATION_ID}:3`,
    }));
  });

  it('terminal-state reservation (cancelled): no key ops, just sets status=cancelled defensively', async () => {
    const { useCase, db, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'failed' }),
    });

    const result = await useCase.execute(buildDto());

    expect(result).toEqual({ status: 204 });
    expect(keyOps.releaseReservationKeys).not.toHaveBeenCalled();
    expect(keyOps.handlePostProvisionReturn).not.toHaveBeenCalled();
    // Defensive cleanup write so a stale 'failed' row becomes 'cancelled' for analytics.
    expect(db.updates).toContainEqual(expect.objectContaining({
      table: 'seller_stock_reservations',
      data: { status: 'cancelled' },
    }));
  });
});
