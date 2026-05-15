/**
 * Tests for the Kinguin marketplace adapter's `ISellerCompetitionAdapter`
 * implementation. The adapter exposes a dual buyer/seller lookup path so the
 * auto-pricing cron can build `seller_competitor_snapshots` rows for Kinguin
 * listings regardless of whether the buyer ESA key is configured.
 *
 *   - Buyer ESA (`/v2/products/{id}`) returns ALL merchants' live offers and
 *     is the preferred path.
 *   - Sales Manager API (`/api/v1/offers?filter.productId=...`) is the
 *     fallback; Kinguin only returns OUR offers via this endpoint, so every
 *     row is tagged `isOwnOffer: true`.
 *
 * These cover the same shape that the storefront Edge Function adapter
 * returns so the cron and the storefront stay in lockstep.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KinguinMarketplaceAdapter } from '../src/infra/marketplace/kinguin/adapter.js';
import type { MarketplaceHttpClient } from '../src/infra/marketplace/_shared/marketplace-http.js';

type GetFn = ReturnType<typeof vi.fn>;
type PostFn = ReturnType<typeof vi.fn>;
type PatchFn = ReturnType<typeof vi.fn>;

interface MockHttp {
  get: GetFn;
  post: PostFn;
  patch: PatchFn;
}

function mockHttp(): MockHttp {
  return { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
}

function makeAdapter(opts: { withBuyerKey: boolean } = { withBuyerKey: true }): {
  adapter: KinguinMarketplaceAdapter;
  http: MockHttp;
  buyer: MockHttp | undefined;
} {
  const http = mockHttp();
  const buyer = opts.withBuyerKey ? mockHttp() : undefined;
  const adapter = new KinguinMarketplaceAdapter(
    http as unknown as MarketplaceHttpClient,
    undefined,
    buyer ? (buyer as unknown as MarketplaceHttpClient) : undefined,
  );
  return { adapter, http, buyer };
}

describe('KinguinMarketplaceAdapter.getCompetitorPrices — buyer ESA path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns one row per merchant from /v2/products/{id} and tags own offer', async () => {
    const { adapter, http, buyer } = makeAdapter();

    buyer!.get.mockResolvedValueOnce({
      kinguinId: 1,
      productId: 'p-1',
      name: 'Minecraft',
      platform: 'PC',
      price: 5.79,
      qty: 15,
      isPreorder: false,
      regionId: null,
      offers: [
        { offerId: 'self-1', merchantName: 'Kinguin', price: 6.49, qty: 4, name: 'self', isPreorder: false },
        { offerId: 'rival-2', merchantName: 'Cheap Keys', price: 5.79, qty: 10, name: 'rival', isPreorder: false },
        { offerId: 'rival-3', merchantName: 'OOS Co.', price: 5.49, qty: 0, name: 'oos', isPreorder: false },
      ],
    });

    http.get.mockResolvedValueOnce({ content: [{ id: 'self-1' }] });

    const result = await adapter.getCompetitorPrices('p-1');

    expect(buyer!.get).toHaveBeenCalledWith('/v2/products/p-1');
    expect(http.get).toHaveBeenCalledWith('/api/v1/offers?filter.productId=p-1&size=1');

    expect(result).toHaveLength(2);
    const own = result.find((r) => r.externalListingId === 'self-1');
    const rival = result.find((r) => r.externalListingId === 'rival-2');
    expect(own).toMatchObject({
      merchantName: 'Kinguin',
      priceCents: 649,
      currency: 'EUR',
      inStock: true,
      isOwnOffer: true,
    });
    expect(rival).toMatchObject({
      merchantName: 'Cheap Keys',
      priceCents: 579,
      currency: 'EUR',
      inStock: true,
      isOwnOffer: false,
    });
  });

  it('sets isOwnOffer to null when own offer cannot be resolved', async () => {
    const { adapter, http, buyer } = makeAdapter();

    buyer!.get.mockResolvedValueOnce({
      kinguinId: 1,
      productId: 'p-1',
      name: 'Game',
      platform: 'PC',
      price: 10,
      qty: 5,
      isPreorder: false,
      regionId: null,
      offers: [
        { offerId: 'rival-2', merchantName: 'Other', price: 10, qty: 5, name: 'rival', isPreorder: false },
      ],
    });

    http.get.mockRejectedValueOnce(new Error('seller API down'));

    const result = await adapter.getCompetitorPrices('p-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      merchantName: 'Other',
      priceCents: 1000,
      isOwnOffer: null,
    });
  });

  it('falls back to product.price when /v2/products has no offers[] array', async () => {
    const { adapter, buyer, http } = makeAdapter();

    buyer!.get.mockResolvedValueOnce({
      kinguinId: 1,
      productId: 'p-1',
      name: 'Game',
      platform: 'PC',
      price: 7.99,
      qty: 3,
      isPreorder: false,
      regionId: null,
    });
    http.get.mockResolvedValueOnce({ content: [] });

    const result = await adapter.getCompetitorPrices('p-1');

    expect(result).toEqual([
      {
        merchantName: 'unknown',
        priceCents: 799,
        currency: 'EUR',
        inStock: true,
        isOwnOffer: null,
      },
    ]);
  });

  it('returns [] when offers[] is empty AND product.price is 0', async () => {
    const { adapter, buyer, http } = makeAdapter();

    buyer!.get.mockResolvedValueOnce({
      kinguinId: 1,
      productId: 'p-1',
      name: 'Game',
      platform: 'PC',
      price: 0,
      qty: 0,
      isPreorder: false,
      regionId: null,
    });
    http.get.mockResolvedValueOnce({ content: [] });

    const result = await adapter.getCompetitorPrices('p-1');

    expect(result).toEqual([]);
  });
});

describe('KinguinMarketplaceAdapter.getCompetitorPrices — seller API fallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to seller API when no buyer http client is configured', async () => {
    const { adapter, http } = makeAdapter({ withBuyerKey: false });

    http.get.mockResolvedValueOnce({
      content: [
        {
          id: 'own-1',
          productId: 'p-1',
          name: 'Minecraft',
          sellerId: 42,
          status: 'ACTIVE',
          block: null,
          priceIWTR: { amount: 500, currency: 'EUR' },
          price: { amount: 649, currency: 'EUR' },
          commissionRule: null,
          declaredStock: 10,
          declaredTextStock: 0,
          reservedStock: 0,
          availableStock: 10,
          buyableStock: 10,
          updatedAt: '',
          createdAt: '',
          sold: 0,
          preOrder: null,
        },
      ],
    });

    const result = await adapter.getCompetitorPrices('p-1');

    expect(http.get).toHaveBeenCalledWith('/api/v1/offers?filter.productId=p-1&size=20');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      merchantName: 'self',
      priceCents: 649,
      currency: 'EUR',
      inStock: true,
      isOwnOffer: true,
      externalListingId: 'own-1',
    });
  });

  it('falls back to seller API when buyer ESA fetch throws', async () => {
    const { adapter, http, buyer } = makeAdapter();

    buyer!.get.mockRejectedValueOnce(new Error('ESA 503'));
    http.get.mockResolvedValueOnce({
      content: [
        {
          id: 'own-1',
          productId: 'p-1',
          name: 'Minecraft',
          sellerId: 42,
          status: 'ACTIVE',
          block: null,
          priceIWTR: { amount: 500, currency: 'EUR' },
          price: { amount: 700, currency: 'EUR' },
          commissionRule: null,
          declaredStock: 5,
          declaredTextStock: 0,
          reservedStock: 0,
          availableStock: 5,
          buyableStock: 5,
          updatedAt: '',
          createdAt: '',
          sold: 0,
          preOrder: null,
        },
      ],
    });

    const result = await adapter.getCompetitorPrices('p-1');

    expect(buyer!.get).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenCalledWith('/api/v1/offers?filter.productId=p-1&size=20');
    expect(result).toHaveLength(1);
    expect(result[0].isOwnOffer).toBe(true);
    expect(result[0].priceCents).toBe(700);
  });

  it('filters out INACTIVE and blocked offers', async () => {
    const { adapter, http } = makeAdapter({ withBuyerKey: false });

    http.get.mockResolvedValueOnce({
      content: [
        {
          id: 'a',
          productId: 'p-1',
          name: 'a',
          sellerId: 1,
          status: 'INACTIVE',
          block: null,
          priceIWTR: { amount: 0, currency: 'EUR' },
          price: { amount: 100, currency: 'EUR' },
          commissionRule: null,
          declaredStock: 1,
          declaredTextStock: 0,
          reservedStock: 0,
          availableStock: 1,
          buyableStock: 1,
          updatedAt: '',
          createdAt: '',
          sold: 0,
          preOrder: null,
        },
        {
          id: 'b',
          productId: 'p-1',
          name: 'b',
          sellerId: 1,
          status: 'ACTIVE',
          block: 'POLICY',
          priceIWTR: { amount: 0, currency: 'EUR' },
          price: { amount: 200, currency: 'EUR' },
          commissionRule: null,
          declaredStock: 1,
          declaredTextStock: 0,
          reservedStock: 0,
          availableStock: 1,
          buyableStock: 1,
          updatedAt: '',
          createdAt: '',
          sold: 0,
          preOrder: null,
        },
        {
          id: 'c',
          productId: 'p-1',
          name: 'c',
          sellerId: 1,
          status: 'ACTIVE',
          block: null,
          priceIWTR: { amount: 0, currency: 'EUR' },
          price: { amount: 300, currency: 'EUR' },
          commissionRule: null,
          declaredStock: 1,
          declaredTextStock: 0,
          reservedStock: 0,
          availableStock: 1,
          buyableStock: 1,
          updatedAt: '',
          createdAt: '',
          sold: 0,
          preOrder: null,
        },
      ],
    });

    const result = await adapter.getCompetitorPrices('p-1');

    expect(result).toHaveLength(1);
    expect(result[0].externalListingId).toBe('c');
  });

  it('returns [] when seller API throws', async () => {
    const { adapter, http } = makeAdapter({ withBuyerKey: false });
    http.get.mockRejectedValueOnce(new Error('boom'));
    const result = await adapter.getCompetitorPrices('p-1');
    expect(result).toEqual([]);
  });
});
