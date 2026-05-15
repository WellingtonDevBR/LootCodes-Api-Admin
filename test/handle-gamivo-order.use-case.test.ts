/**
 * Wire-format regression suite for `HandleGamivoOrderUseCase`.
 *
 * Locks the behaviour required by the Gamivo Import API spec
 * (public-api-import.pdf §"Create order"):
 *
 *   POST /order
 *     200 -> { provider_order_id, keys: [{id, value, type}], available_stock? }
 *     400 -> { code, message }
 *     404 -> { code, message }   (reservation not found)
 *     410 -> { code, message }   (reservation expired)
 *     409 -> { code, message }   (order already exists for reservation)
 *
 * Plus our internal contract:
 *   - timestamp-expired reservations release their keys before 410
 *   - successful provision triggers `completeProvisionOrchestration`
 *   - idempotent replay returns the same keys (200) — only 409s when decrypt fails
 *   - provision failure releases keys + bumps health counters
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleGamivoOrderUseCase } from '../src/core/use-cases/seller-webhook/gamivo/handle-gamivo-order.use-case.js';
import {
  TableStubDatabase,
  StubKeyOps,
  StubHealth,
} from './helpers/gamivo-test-stubs.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const VARIANT_ID = '9b9d95e9-292c-4854-8edb-813e69c406cf';
const LISTING_ID = 'eb4e1b68-261a-4b7e-b5eb-968c8213661e';
const EXTERNAL_LISTING_ID = '12345';
const RESERVATION_ID = '00000000-1be0-11e9-aaaa-0123456789ab';
const GAMIVO_ORDER_ID = '0000acfa-1be0-11e9-aaaa-0xxxxxxxxxx5';
const PROVIDER_ACCOUNT_ID = '8311bf9d-2c98-4ad8-9535-2926dbe728dc';
const PRODUCT_ID = 'product-1';

interface ReservationOpts {
  status?: 'pending' | 'expired' | 'provisioned' | 'cancelled' | 'failed';
  expiresAt?: string | null;
}

function makeReservation(overrides: ReservationOpts = {}) {
  return {
    id: RESERVATION_ID,
    seller_listing_id: LISTING_ID,
    status: overrides.status ?? 'pending',
    quantity: 2,
    expires_at: overrides.expiresAt === undefined
      ? new Date(Date.now() + 60_000).toISOString()
      : overrides.expiresAt,
    external_reservation_id: RESERVATION_ID,
  };
}

function makeListing() {
  return {
    external_listing_id: EXTERNAL_LISTING_ID,
    variant_id: VARIANT_ID,
    provider_account_id: PROVIDER_ACCOUNT_ID,
  };
}

function makeUseCase(opts: {
  reservation?: ReturnType<typeof makeReservation> | null;
  listing?: ReturnType<typeof makeListing> | null;
  provisions?: Array<{ product_key_id: string }>;
} = {}) {
  const db = new TableStubDatabase();
  const keyOps = new StubKeyOps();
  const health = new StubHealth();

  const reservation = opts.reservation === undefined ? makeReservation() : opts.reservation;
  const listing = opts.listing === undefined ? makeListing() : opts.listing;
  db.setQueryOne('seller_stock_reservations', () => reservation);
  db.setQueryOne('seller_listings', () => listing);
  db.setQueryOne('product_variants', () => ({ product_id: PRODUCT_ID }));
  db.setQuery('seller_key_provisions', () => opts.provisions ?? []);
  db.setQuery('product_keys', () => Array.from({ length: 5 }, (_, i) => ({ id: `k-${i}` })));

  const useCase = new HandleGamivoOrderUseCase(db, keyOps, health);
  return { db, keyOps, health, useCase };
}

const SPEC_DTO = {
  reservationId: RESERVATION_ID,
  gamivoOrderId: GAMIVO_ORDER_ID,
  createdTime: '2021-07-20 13:33:22',
  providerAccountId: PROVIDER_ACCOUNT_ID,
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('HandleGamivoOrderUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with keys + available_stock on a fresh confirmation', async () => {
    const { useCase, keyOps, db } = makeUseCase();
    keyOps.provisionFromPendingKeys.mockResolvedValue({
      keyIds: ['k1', 'k2'],
      decryptedKeys: [
        { keyId: 'k1', plaintext: 'AAAA-BBBB-CCCC' },
        { keyId: 'k2', plaintext: 'DDDD-EEEE-FFFF' },
      ],
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: true,
      providerOrderId: RESERVATION_ID,
      keys: [
        { id: 'k1', value: 'AAAA-BBBB-CCCC', type: 'text' },
        { id: 'k2', value: 'DDDD-EEEE-FFFF', type: 'text' },
      ],
      availableStock: 5,
    });
    // We persist gamivo_order_id on the reservation for traceability.
    expect(db.updates).toContainEqual(expect.objectContaining({
      table: 'seller_stock_reservations',
      data: { external_order_id: GAMIVO_ORDER_ID },
    }));
    expect(keyOps.completeProvisionOrchestration).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: RESERVATION_ID,
      providerCode: 'gamivo',
      externalOrderId: GAMIVO_ORDER_ID,
    }));
  });

  it('returns 404 not_found when no reservation matches', async () => {
    const { useCase, keyOps } = makeUseCase({ reservation: null });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'not_found',
      message: 'Reservation not found',
      status: 404,
    });
    expect(keyOps.provisionFromPendingKeys).not.toHaveBeenCalled();
  });

  it('returns 410 reservation_expired when reservation status === "expired"', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'expired' }),
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'reservation_expired',
      message: 'Reservation has expired',
      status: 410,
    });
    expect(keyOps.releaseReservationKeys).not.toHaveBeenCalled(); // already released
    expect(keyOps.provisionFromPendingKeys).not.toHaveBeenCalled();
  });

  it('returns 410 + releases keys when reservation is pending but expires_at is in the past', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result.ok).toBe(false);
    expect((result as { status: number }).status).toBe(410);
    expect(keyOps.releaseReservationKeys).toHaveBeenCalledWith(RESERVATION_ID, 'expired');
  });

  it('returns 200 + same keys on idempotent replay (already-provisioned reservation)', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned' }),
      provisions: [{ product_key_id: 'k1' }, { product_key_id: 'k2' }],
    });
    keyOps.decryptDeliveredProvisionKeys.mockResolvedValue({
      decryptedKeys: [
        { keyId: 'k1', plaintext: 'AAAA-BBBB' },
        { keyId: 'k2', plaintext: 'CCCC-DDDD' },
      ],
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: true,
      providerOrderId: RESERVATION_ID,
      keys: [
        { id: 'k1', value: 'AAAA-BBBB', type: 'text' },
        { id: 'k2', value: 'CCCC-DDDD', type: 'text' },
      ],
    });
    // Importantly, no NEW provision is created on replay.
    expect(keyOps.provisionFromPendingKeys).not.toHaveBeenCalled();
    expect(keyOps.completeProvisionOrchestration).not.toHaveBeenCalled();
  });

  it('returns 409 already_fulfilled when the replay has provisions but decrypt fails', async () => {
    const { useCase, keyOps } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned' }),
      provisions: [{ product_key_id: 'k1' }],
    });
    keyOps.decryptDeliveredProvisionKeys.mockRejectedValue(new Error('crypto down'));

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'already_fulfilled',
      message: 'Order already exists for reservation',
      status: 409,
    });
  });

  it('returns 409 already_fulfilled when the replay has no surviving provisions', async () => {
    const { useCase } = makeUseCase({
      reservation: makeReservation({ status: 'provisioned' }),
      provisions: [],
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'already_fulfilled',
      message: 'Order already exists for reservation',
      status: 409,
    });
  });

  it('returns 500 provision_failed + releases keys + bumps health when provision throws', async () => {
    const { useCase, keyOps, health } = makeUseCase();
    keyOps.provisionFromPendingKeys.mockRejectedValue(new Error('decrypt boom'));

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'provision_failed',
      message: 'Failed to deliver keys',
      status: 500,
    });
    expect(health.calls).toContainEqual({
      id: EXTERNAL_LISTING_ID, type: 'provision', success: false, reason: undefined,
    });
    expect(keyOps.releaseReservationKeys).toHaveBeenCalledWith(RESERVATION_ID, 'failed');
    // Critically, we MUST NOT call completeProvisionOrchestration on failure.
    expect(keyOps.completeProvisionOrchestration).not.toHaveBeenCalled();
  });

  it('marks every key as type:"text" (Gamivo spec allows text|image; we never deliver images)', async () => {
    const { useCase, keyOps } = makeUseCase();
    keyOps.provisionFromPendingKeys.mockResolvedValue({
      keyIds: ['only'],
      decryptedKeys: [{ keyId: 'only', plaintext: 'XXXX' }],
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keys.every((k) => k.type === 'text')).toBe(true);
    }
  });

  it('omits available_stock when the listing row cannot be loaded (cannot count keys)', async () => {
    const { useCase, keyOps } = makeUseCase({ listing: null });
    keyOps.provisionFromPendingKeys.mockResolvedValue({
      keyIds: ['k1'],
      decryptedKeys: [{ keyId: 'k1', plaintext: 'XXXX' }],
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.availableStock).toBeUndefined();
    }
  });

  it('bumps health counters with provision=success on a clean fulfilment', async () => {
    const { useCase, keyOps, health } = makeUseCase();
    keyOps.provisionFromPendingKeys.mockResolvedValue({
      keyIds: ['k1'], decryptedKeys: [{ keyId: 'k1', plaintext: 'V' }],
    });

    await useCase.execute(SPEC_DTO);

    expect(health.calls).toContainEqual({
      id: EXTERNAL_LISTING_ID, type: 'provision', success: true, reason: undefined,
    });
  });
});
