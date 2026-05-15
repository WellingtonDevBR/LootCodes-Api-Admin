/**
 * Wire-format regression suite for `HandleGamivoGetKeysUseCase`.
 *
 * Locks the behaviour required by the Gamivo Import API spec
 * (public-api-import.pdf §"Get keys"):
 *
 *   GET /order/{provider_order_id}/keys
 *     200 -> { keys: [{id, value, type}], available_stock? }
 *     400 -> { code, message }
 *     404 -> { code, message }   (no provisions for that order)
 *
 * Plus our internal contract:
 *   - decrypt failures surface as 500 decrypt_failed (not silently 200/empty)
 *   - available_stock is best-effort: missing it must NOT 500 the response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandleGamivoGetKeysUseCase } from '../src/core/use-cases/seller-webhook/gamivo/handle-gamivo-get-keys.use-case.js';
import { TableStubDatabase, StubKeyOps } from './helpers/gamivo-test-stubs.js';

// ─── Fixtures ────────────────────────────────────────────────────────

const PROVIDER_ORDER_ID = '00000000-1be0-11e9-aaaa-0123456789ab';
const RESERVATION_ID = PROVIDER_ORDER_ID;
const VARIANT_ID = '9b9d95e9-292c-4854-8edb-813e69c406cf';
const LISTING_ID = 'eb4e1b68-261a-4b7e-b5eb-968c8213661e';
const PROVIDER_ACCOUNT_ID = '8311bf9d-2c98-4ad8-9535-2926dbe728dc';

interface SetupOpts {
  provisions?: Array<{ product_key_id: string; reservation_id: string }>;
  reservation?: { seller_listing_id: string } | null;
  listing?: { variant_id: string; provider_account_id: string } | null;
  availableKeyCount?: number;
}

function makeUseCase(opts: SetupOpts = {}) {
  const db = new TableStubDatabase();
  const keyOps = new StubKeyOps();

  db.setQuery('seller_key_provisions', () => opts.provisions ?? [
    { product_key_id: 'k1', reservation_id: RESERVATION_ID },
    { product_key_id: 'k2', reservation_id: RESERVATION_ID },
  ]);
  db.setQueryOne('seller_stock_reservations', () =>
    opts.reservation === undefined ? { seller_listing_id: LISTING_ID } : opts.reservation);
  db.setQueryOne('seller_listings', () =>
    opts.listing === undefined
      ? { variant_id: VARIANT_ID, provider_account_id: PROVIDER_ACCOUNT_ID }
      : opts.listing);
  db.setQuery('product_keys', () =>
    Array.from({ length: opts.availableKeyCount ?? 7 }, (_, i) => ({ id: `key-${i}` })));

  const useCase = new HandleGamivoGetKeysUseCase(db, keyOps);
  return { db, keyOps, useCase };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('HandleGamivoGetKeysUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 + keys + available_stock when provisions exist and decrypt succeeds', async () => {
    const { useCase, keyOps } = makeUseCase({ availableKeyCount: 7 });
    keyOps.decryptDeliveredProvisionKeys.mockResolvedValue({
      decryptedKeys: [
        { keyId: 'k1', plaintext: 'AAAA-BBBB' },
        { keyId: 'k2', plaintext: 'CCCC-DDDD' },
      ],
    });

    const result = await useCase.execute({ providerOrderId: PROVIDER_ORDER_ID });

    expect(result).toEqual({
      ok: true,
      keys: [
        { id: 'k1', value: 'AAAA-BBBB', type: 'text' },
        { id: 'k2', value: 'CCCC-DDDD', type: 'text' },
      ],
      availableStock: 7,
    });
    expect(keyOps.decryptDeliveredProvisionKeys).toHaveBeenCalledWith(RESERVATION_ID);
  });

  it('returns 404 not_found when no delivered provisions exist for the order', async () => {
    const { useCase, keyOps } = makeUseCase({ provisions: [] });

    const result = await useCase.execute({ providerOrderId: PROVIDER_ORDER_ID });

    expect(result).toEqual({
      ok: false,
      code: 'not_found',
      message: 'No keys found for this order',
      status: 404,
    });
    expect(keyOps.decryptDeliveredProvisionKeys).not.toHaveBeenCalled();
  });

  it('returns 500 decrypt_failed when decrypt throws (do NOT silently 200/empty)', async () => {
    const { useCase, keyOps } = makeUseCase();
    keyOps.decryptDeliveredProvisionKeys.mockRejectedValue(new Error('crypto down'));

    const result = await useCase.execute({ providerOrderId: PROVIDER_ORDER_ID });

    expect(result).toEqual({
      ok: false,
      code: 'decrypt_failed',
      message: 'Failed to retrieve keys',
      status: 500,
    });
  });

  it('returns 200 without available_stock when reservation row is missing (best-effort)', async () => {
    const { useCase, keyOps } = makeUseCase({ reservation: null });
    keyOps.decryptDeliveredProvisionKeys.mockResolvedValue({
      decryptedKeys: [{ keyId: 'k1', plaintext: 'XXXX' }],
    });

    const result = await useCase.execute({ providerOrderId: PROVIDER_ORDER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keys).toHaveLength(1);
      expect(result.availableStock).toBeUndefined();
    }
  });

  it('returns 200 without available_stock when listing lookup fails', async () => {
    const { useCase, keyOps } = makeUseCase({ listing: null });
    keyOps.decryptDeliveredProvisionKeys.mockResolvedValue({
      decryptedKeys: [{ keyId: 'k1', plaintext: 'XXXX' }],
    });

    const result = await useCase.execute({ providerOrderId: PROVIDER_ORDER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.availableStock).toBeUndefined();
    }
  });

  it('marks every key as type:"text"', async () => {
    const { useCase, keyOps } = makeUseCase();
    keyOps.decryptDeliveredProvisionKeys.mockResolvedValue({
      decryptedKeys: [
        { keyId: 'k1', plaintext: 'AAAA' },
        { keyId: 'k2', plaintext: 'BBBB' },
        { keyId: 'k3', plaintext: 'CCCC' },
      ],
    });

    const result = await useCase.execute({ providerOrderId: PROVIDER_ORDER_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keys.every((k) => k.type === 'text')).toBe(true);
    }
  });
});
