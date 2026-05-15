/**
 * Wire-format regression suite for `HandleGamivoReservationUseCase`.
 *
 * Locks the behaviour required by the Gamivo Import API spec
 * (public-api-import.pdf §"Order reservation"):
 *
 *   POST /reservation
 *     200 -> { reservation_id }
 *     400 -> { code, message }   (we use 400 for insufficient_stock too)
 *     404 -> { code, message }   (no active listing for product_id)
 *
 * Plus our internal contract:
 *   - claim path tries source-variant pool / JIT before failing
 *   - successful reserve fires `seller.stock_reserved` + `inventory.stock_changed`
 *     in setImmediate (must NOT delay the webhook response)
 *   - failed claim hits health counters + propagates variant unavailability
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleGamivoReservationUseCase } from '../src/core/use-cases/seller-webhook/gamivo/handle-gamivo-reservation.use-case.js';
import {
  TableStubDatabase,
  StubKeyOps,
  StubEvents,
  StubHealth,
  StubUnavailability,
  flushSetImmediate,
} from './helpers/gamivo-test-stubs.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const PROVIDER_ACCOUNT_ID = '8311bf9d-2c98-4ad8-9535-2926dbe728dc';
const VARIANT_ID = '9b9d95e9-292c-4854-8edb-813e69c406cf';
const LISTING_ID = 'eb4e1b68-261a-4b7e-b5eb-968c8213661e';
const EXTERNAL_LISTING_ID = '12345';
const PRODUCT_ID_INTERNAL = 'product-1';

function makeListing(overrides: Record<string, unknown> = {}) {
  return {
    id: LISTING_ID,
    variant_id: VARIANT_ID,
    price_cents: 544,
    currency: 'EUR',
    external_listing_id: EXTERNAL_LISTING_ID,
    min_jit_margin_cents: null,
    provider_account_id: PROVIDER_ACCOUNT_ID,
    ...overrides,
  };
}

function makeUseCase(overrides: {
  listing?: Record<string, unknown> | null;
} = {}) {
  const db = new TableStubDatabase();
  const keyOps = new StubKeyOps();
  const events = new StubEvents();
  const health = new StubHealth();
  const unavailability = new StubUnavailability();

  const listing = overrides.listing === undefined ? makeListing() : overrides.listing;
  db.setQueryOne('seller_listings', () => listing);
  db.setQueryOne('product_variants', () => ({ product_id: PRODUCT_ID_INTERNAL }));

  const useCase = new HandleGamivoReservationUseCase(
    db, keyOps, events, health, unavailability,
  );

  return { db, keyOps, events, health, unavailability, useCase };
}

const SPEC_DTO = {
  productId: 56546,
  quantity: 2,
  unitPrice: 5.44,
  providerAccountId: PROVIDER_ACCOUNT_ID,
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('HandleGamivoReservationUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 + reservation_id when keys are claimed locally', async () => {
    const { useCase, keyOps, events, health } = makeUseCase();
    keyOps.claimKeysForReservation.mockResolvedValue({
      reservationId: 'res-uuid-1',
      keyIds: ['key-1', 'key-2'],
      viaJit: false,
    });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({ ok: true, reservationId: 'res-uuid-1' });

    // Background work must run after the response shape is finalised.
    await flushSetImmediate();
    expect(health.calls).toContainEqual({
      id: EXTERNAL_LISTING_ID, type: 'reservation', success: true, reason: undefined,
    });
    expect(events.sellerEvents).toContainEqual(expect.objectContaining({
      eventType: 'seller.stock_reserved',
      aggregateId: LISTING_ID,
      payload: expect.objectContaining({
        listingId: LISTING_ID,
        variantId: VARIANT_ID,
        quantity: 2,
        providerCode: 'gamivo',
        viaJit: false,
      }),
    }));
    expect(events.stockChanged).toContainEqual(expect.objectContaining({
      productIds: [PRODUCT_ID_INTERNAL],
      variantIds: [VARIANT_ID],
      reason: 'seller_reserved',
    }));
  });

  it('passes unit_price as cents into provider metadata + salePriceCents', async () => {
    const { useCase, keyOps } = makeUseCase();
    keyOps.claimKeysForReservation.mockResolvedValue({
      reservationId: 'res-1', keyIds: ['k1'], viaJit: false,
    });

    await useCase.execute(SPEC_DTO);

    const claimCall = keyOps.claimKeysForReservation.mock.calls[0][0];
    expect(claimCall.salePriceCents).toBe(544);
    expect(claimCall.providerMetadata).toEqual(expect.objectContaining({
      provider: 'gamivo',
      gamivo_product_id: 56546,
      unit_price: 5.44,
      unit_price_cents: 544,
      currency: 'EUR',
    }));
  });

  it('forwards listing min_jit_margin_cents to claim params', async () => {
    const { useCase, keyOps } = makeUseCase({
      listing: makeListing({ min_jit_margin_cents: 75 }),
    });
    keyOps.claimKeysForReservation.mockResolvedValue({
      reservationId: 'res-1', keyIds: ['k1'], viaJit: false,
    });

    await useCase.execute(SPEC_DTO);

    expect(keyOps.claimKeysForReservation.mock.calls[0][0].minMarginCents).toBe(75);
  });

  it('returns 404 not_found when no active listing exists for the product', async () => {
    const { useCase, keyOps, events, health } = makeUseCase({ listing: null });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'not_found',
      message: 'Product not found or not available',
      status: 404,
    });
    expect(keyOps.claimKeysForReservation).not.toHaveBeenCalled();
    expect(events.sellerEvents).toHaveLength(0);
    expect(health.calls).toHaveLength(0);
  });

  it('returns 400 insufficient_stock when claim throws (after JIT exhausted), bumps health, propagates unavailability', async () => {
    const { useCase, keyOps, health, unavailability } = makeUseCase();
    keyOps.claimKeysForReservation.mockRejectedValue(
      new Error('claim_and_reserve_atomic failed: INSUFFICIENT_STOCK: need 2, got 0'),
    );

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({
      ok: false,
      code: 'insufficient_stock',
      message: 'Not enough stock available',
      status: 400,
    });
    // Failure path is awaited inline (no setImmediate) for health.
    expect(health.calls).toEqual([
      { id: EXTERNAL_LISTING_ID, type: 'reservation', success: false, reason: undefined },
    ]);

    // Variant unavailability propagation runs in setImmediate.
    await flushSetImmediate();
    expect(unavailability.calls).toEqual([
      { variantId: VARIANT_ID, reason: 'jit_failed' },
    ]);
  });

  it('does NOT touch health counters when listing has no external_listing_id (yet to be published)', async () => {
    const { useCase, keyOps, health } = makeUseCase({
      listing: makeListing({ external_listing_id: null }),
    });
    keyOps.claimKeysForReservation.mockRejectedValue(new Error('INSUFFICIENT_STOCK'));

    await useCase.execute(SPEC_DTO);

    expect(health.calls).toHaveLength(0);
  });

  it('still returns 200 if background work throws after a successful claim (do not break the response)', async () => {
    const { useCase, keyOps, events } = makeUseCase();
    keyOps.claimKeysForReservation.mockResolvedValue({
      reservationId: 'res-2', keyIds: ['k1'], viaJit: true,
    });
    // Tank the background event emit. The webhook response must still be 200.
    vi.spyOn(events, 'emitSellerEvent').mockRejectedValue(new Error('events down'));

    const result = await useCase.execute(SPEC_DTO);
    expect(result).toEqual({ ok: true, reservationId: 'res-2' });

    await flushSetImmediate();
    // No throw escaped the use case. Done.
  });

  it('records viaJit=true in the stock_reserved event when claim came from JIT', async () => {
    const { useCase, keyOps, events } = makeUseCase();
    keyOps.claimKeysForReservation.mockResolvedValue({
      reservationId: 'res-3', keyIds: ['k1'], viaJit: true,
    });

    await useCase.execute(SPEC_DTO);
    await flushSetImmediate();

    expect(events.sellerEvents[0].payload).toEqual(expect.objectContaining({ viaJit: true }));
  });
});
