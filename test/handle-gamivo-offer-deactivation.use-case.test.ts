/**
 * Wire-format regression suite for `HandleGamivoOfferDeactivationUseCase`.
 *
 * Locks the behaviour required by the Gamivo Import API spec
 * (public-api-import.pdf §"Offer deactivation notification"):
 *
 *   POST /offer-deactivation
 *     204 -> No Content   (every success path, including missing-listing)
 *     400/401/404 -> { code, message }
 *
 * Internal contract (LOOTCODES-API-33 fix):
 *   - look up the local listing FIRST (its UUID is the seller-event aggregate id;
 *     Gamivo's offerId is a numeric string and would fail the UUID column type)
 *   - pause local listing with the Gamivo-supplied `reason` in error_message
 *   - emit `seller.listing_removed` keyed on the listing UUID
 *   - skip the seller event entirely when no listing matches (no aggregate
 *     to attach to; we do NOT invent a synthetic aggregate id)
 *   - best-effort admin alert always fires (alert failure must NOT 500 the webhook)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleGamivoOfferDeactivationUseCase } from '../src/core/use-cases/seller-webhook/gamivo/handle-gamivo-offer-deactivation.use-case.js';
import { TableStubDatabase, StubEvents } from './helpers/gamivo-test-stubs.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const PROVIDER_ACCOUNT_ID = '8311bf9d-2c98-4ad8-9535-2926dbe728dc';
const OFFER_ID = 75653;
const LISTING_ID = 'eb4e1b68-261a-4b7e-b5eb-968c8213661e';

interface SetupOpts {
  listing?: { id: string } | null;
}

function makeUseCase(opts: SetupOpts = {}) {
  const db = new TableStubDatabase();
  const events = new StubEvents();

  db.setQueryOne('seller_listings', () =>
    opts.listing === undefined ? { id: LISTING_ID } : opts.listing);

  const useCase = new HandleGamivoOfferDeactivationUseCase(db, events);
  return { db, events, useCase };
}

const SPEC_DTO = {
  offerId: OFFER_ID,
  productName: 'Elden Ring EU Steam',
  reason: 'Offer deactivated due a problem with product reservation',
  providerAccountId: PROVIDER_ACCOUNT_ID,
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('HandleGamivoOfferDeactivationUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 204 + emits seller.listing_removed + pauses local listing + creates admin alert', async () => {
    const { useCase, db, events } = makeUseCase();

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({ status: 204 });

    expect(events.sellerEvents).toEqual([
      expect.objectContaining({
        eventType: 'seller.listing_removed',
        // aggregateId must be the listing UUID, NOT the Gamivo numeric offerId
        // (domain_events.aggregate_id is UUID-typed in Postgres).
        aggregateId: LISTING_ID,
        payload: expect.objectContaining({
          providerCode: 'gamivo',
          externalListingId: String(OFFER_ID),
          product_name: SPEC_DTO.productName,
          reason: SPEC_DTO.reason,
        }),
      }),
    ]);

    expect(db.updates).toContainEqual(expect.objectContaining({
      table: 'seller_listings',
      filter: { id: LISTING_ID },
      data: expect.objectContaining({
        status: 'paused',
        error_message: `Deactivated by Gamivo: ${SPEC_DTO.reason}`,
      }),
    }));

    expect(db.inserts).toContainEqual(expect.objectContaining({
      table: 'admin_alerts',
      data: expect.objectContaining({
        alert_type: 'marketplace_listing_deactivated',
        severity: 'medium',
        metadata: expect.objectContaining({
          provider_code: 'gamivo',
          offer_id: OFFER_ID,
        }),
      }),
    }));
  });

  it('still returns 204 when no local listing matches (defensive against drift / partial-publish)', async () => {
    const { useCase, db, events } = makeUseCase({ listing: null });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({ status: 204 });
    // No seller event fires — without a listing there is no UUID aggregate to
    // attach the event to. Inventing one would either fail the UUID column
    // (offerId is numeric) or hide the orphan-deactivation signal.
    expect(events.sellerEvents).toHaveLength(0);
    // No row update happens because there's no row to update.
    expect(db.updates.filter((u) => u.table === 'seller_listings')).toHaveLength(0);
    // Alert still fires — admin should investigate why we don't have the listing.
    expect(db.inserts.filter((i) => i.table === 'admin_alerts')).toHaveLength(1);
  });

  it('falls back to "unknown reason" in error_message when Gamivo omits reason', async () => {
    const { useCase, db } = makeUseCase();

    await useCase.execute({ ...SPEC_DTO, reason: '' });

    expect(db.updates).toContainEqual(expect.objectContaining({
      table: 'seller_listings',
      data: expect.objectContaining({
        error_message: 'Deactivated by Gamivo: unknown reason',
      }),
    }));
  });

  it('returns 204 even when the admin_alerts insert fails (alerting must NOT break the webhook)', async () => {
    const { useCase, db } = makeUseCase();
    const insertSpy = vi.spyOn(db, 'insert');
    insertSpy.mockImplementationOnce(async () => { throw new Error('alerts table down'); });

    const result = await useCase.execute(SPEC_DTO);

    expect(result).toEqual({ status: 204 });
    // The pause update still happened despite the alert failure.
    expect(db.updates).toContainEqual(expect.objectContaining({
      table: 'seller_listings',
      data: expect.objectContaining({ status: 'paused' }),
    }));
  });

  it('persists offer_id as a STRING in seller_listing.error_message + as a number in metadata', async () => {
    // Gamivo sends offer_id as integer; our `external_listing_id` column is text.
    // Verify both representations are used correctly.
    const { useCase, db } = makeUseCase();

    await useCase.execute(SPEC_DTO);

    const insertCall = db.inserts.find((i) => i.table === 'admin_alerts');
    expect(insertCall?.data).toEqual(expect.objectContaining({
      message: expect.stringContaining(String(OFFER_ID)),
      metadata: expect.objectContaining({ offer_id: OFFER_ID }), // stays integer in metadata
    }));
  });
});
