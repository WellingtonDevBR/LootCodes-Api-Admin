/**
 * Tests for the Gamivo marketplace adapter's new seller-side capabilities.
 *
 * Covers:
 *   - `getCompetitorPrices` (ISellerCompetitionAdapter)
 *   - `batchUpdatePrices` (ISellerBatchPriceAdapter)
 *   - `pricingModel = 'seller_price'`
 *   - own-offers 30s cache
 *   - tier-aware patchOffer (via `updateListing`)
 *
 * These three capabilities are what makes the auto-pricing cron actually do
 * something for Gamivo listings — without them the orchestrator silently
 * drops decisions. See the deployment note in
 * `src/infra/marketplace/gamivo/adapter.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GamivoMarketplaceAdapter } from '../src/infra/marketplace/gamivo/adapter.js';
import type { MarketplaceHttpClient } from '../src/infra/marketplace/_shared/marketplace-http.js';

type GetFn = ReturnType<typeof vi.fn>;
type PutFn = ReturnType<typeof vi.fn>;
type PostFn = ReturnType<typeof vi.fn>;

interface MockHttp {
  get: GetFn;
  put: PutFn;
  post: PostFn;
}

function makeOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 3413536,
    product_id: 140724,
    product_name: 'Minecraft',
    seller_name: 'LootCodes',
    completed_orders: 12,
    rating: 4.9,
    retail_price: 14.99,
    wholesale_price_tier_one: 14.5,
    wholesale_price_tier_two: 14.0,
    stock_available: 50,
    invoicable: true,
    status: 1,
    wholesale_mode: 1,
    is_preorder: false,
    public_api_prices: { retail_price: 14.99, wholesale_tier_one_price: 14.5, wholesale_tier_two_price: 14.0 },
    seller_price: 13.79,
    wholesale_seller_price_tier_one: 13.4,
    wholesale_seller_price_tier_two: 13.0,
    provider_product_id: '140724',
    ...overrides,
  };
}

function makeAdapter(http: MockHttp): {
  adapter: GamivoMarketplaceAdapter;
  http: MockHttp;
} {
  const adapter = new GamivoMarketplaceAdapter(http as unknown as MarketplaceHttpClient);
  return { adapter, http };
}

describe('GamivoMarketplaceAdapter — pricingModel', () => {
  it('marks Gamivo as a NET-pricing marketplace (seller_price)', () => {
    const { adapter } = makeAdapter({ get: vi.fn(), put: vi.fn(), post: vi.fn() });
    expect(adapter.pricingModel).toBe('seller_price');
  });
});

describe('GamivoMarketplaceAdapter.getCompetitorPrices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a sorted competitor ladder flagging our own offer', async () => {
    const http: MockHttp = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
    };

    const productOffers = [
      makeOffer({ id: 100, seller_name: 'CompetitorA', retail_price: 15.99, stock_available: 5 }),
      makeOffer({ id: 200, seller_name: 'LootCodes', retail_price: 14.99, stock_available: 10 }),
      makeOffer({ id: 300, seller_name: 'CompetitorB', retail_price: 16.49, stock_available: 0 }),
    ];
    const ownOffers = [makeOffer({ id: 200, product_id: 140724, seller_name: 'LootCodes' })];

    http.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/public/v1/products/140724/offers')) return Promise.resolve(productOffers);
      if (path === '/api/public/v1/offers') return Promise.resolve(ownOffers);
      throw new Error(`Unexpected GET ${path}`);
    });

    const { adapter } = makeAdapter(http);
    const competitors = await adapter.getCompetitorPrices('140724');

    expect(competitors).toHaveLength(3);
    // Sorted ascending by price.
    expect(competitors.map((c) => c.priceCents)).toEqual([1499, 1599, 1649]);
    // Own offer marked correctly.
    expect(competitors.find((c) => c.externalListingId === '200')!.isOwnOffer).toBe(true);
    expect(competitors.find((c) => c.externalListingId === '100')!.isOwnOffer).toBe(false);
    // Out-of-stock reflected as inStock=false.
    expect(competitors.find((c) => c.externalListingId === '300')!.inStock).toBe(false);
    // Currency is always EUR for Gamivo.
    expect(competitors.every((c) => c.currency === 'EUR')).toBe(true);
  });

  it('returns an empty list when the product has no offers', async () => {
    const http: MockHttp = {
      get: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      put: vi.fn(),
      post: vi.fn(),
    };
    const { adapter } = makeAdapter(http);
    expect(await adapter.getCompetitorPrices('140724')).toEqual([]);
  });

  it('isOwnOffer is null when we do not have our own offer registered for that product', async () => {
    const http: MockHttp = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
    };
    http.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/public/v1/products/140724/offers')) {
        return Promise.resolve([makeOffer({ id: 100, retail_price: 15.99, seller_name: 'Other' })]);
      }
      if (path === '/api/public/v1/offers') {
        // No own offer for product 140724.
        return Promise.resolve([makeOffer({ id: 500, product_id: 999, seller_name: 'LootCodes' })]);
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    const { adapter } = makeAdapter(http);
    const [c] = await adapter.getCompetitorPrices('140724');
    // `null` (not `false`) signals "ownership unknown" so the auto-pricing
    // intelligence can drop these rows instead of treating them as competitors.
    expect(c.isOwnOffer).toBeNull();
  });

  it('synthesises a hidden own-offer row when our offer is INACTIVE and missing from /products/{id}/offers', async () => {
    // Reproduces LOOTCODES-API-31: when declared_stock=0 we push status=INACTIVE,
    // and Gamivo then excludes our offer from /products/{id}/offers. Without
    // synthesis the NET/GROSS resolver loses its preferred ratio source and
    // logs a high-severity Sentry warning every cron tick.
    const http: MockHttp = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
    };
    http.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/public/v1/products/140724/offers')) {
        return Promise.resolve([
          makeOffer({ id: 100, seller_name: 'CompetitorA', retail_price: 15.99, stock_available: 5 }),
        ]);
      }
      if (path === '/api/public/v1/offers') {
        // Our own offer exists (cached via GET /offers) but is INACTIVE so
        // it doesn't show up in /products/{id}/offers.
        return Promise.resolve([
          makeOffer({ id: 200, product_id: 140724, seller_name: 'LootCodes', retail_price: 14.99, stock_available: 0, status: 0 }),
        ]);
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    const { adapter } = makeAdapter(http);
    const competitors = await adapter.getCompetitorPrices('140724');

    expect(competitors).toHaveLength(2);
    const own = competitors.find((c) => c.isOwnOffer === true);
    expect(own).toBeDefined();
    expect(own!.externalListingId).toBe('200');
    expect(own!.priceCents).toBe(1499);
    expect(own!.inStock).toBe(false);
    expect(own!.merchantName).toBe('LootCodes');
  });

  it('does NOT duplicate the own-offer row when our offer is already in /products/{id}/offers', async () => {
    const http: MockHttp = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
    };
    http.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/public/v1/products/140724/offers')) {
        return Promise.resolve([
          makeOffer({ id: 200, seller_name: 'LootCodes', retail_price: 14.99 }),
        ]);
      }
      if (path === '/api/public/v1/offers') {
        return Promise.resolve([makeOffer({ id: 200, product_id: 140724 })]);
      }
      throw new Error(`Unexpected GET ${path}`);
    });

    const { adapter } = makeAdapter(http);
    const competitors = await adapter.getCompetitorPrices('140724');

    expect(competitors).toHaveLength(1);
    expect(competitors[0].isOwnOffer).toBe(true);
  });

  it('caches own offers across two calls within the 30s TTL', async () => {
    const http: MockHttp = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
    };
    http.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/public/v1/products/140724/offers')) {
        return Promise.resolve([makeOffer({ id: 200, retail_price: 14.99, seller_name: 'LootCodes' })]);
      }
      if (path === '/api/public/v1/offers') return Promise.resolve([makeOffer({ id: 200, product_id: 140724 })]);
      throw new Error(`Unexpected GET ${path}`);
    });

    const { adapter } = makeAdapter(http);
    await adapter.getCompetitorPrices('140724');
    await adapter.getCompetitorPrices('140724');

    const ownOffersCalls = http.get.mock.calls.filter((c) => c[0] === '/api/public/v1/offers').length;
    expect(ownOffersCalls).toBe(1); // hit the cache on the second invocation
  });
});

describe('GamivoMarketplaceAdapter.batchUpdatePrices', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates each offer sequentially via PUT and reports counts', async () => {
    const http: MockHttp = {
      get: vi.fn(),
      put: vi.fn(),
      post: vi.fn(),
    };

    // patchOffer flow: GET offer → calculate-customer-price → calculate-seller-price → PUT
    http.get.mockImplementation((path: string) => {
      if (path.startsWith('/api/public/v1/offers/3000') && !path.includes('calculate-')) {
        return Promise.resolve(makeOffer({ id: 3000, retail_price: 14.99, seller_price: 13.79 }));
      }
      if (path.startsWith('/api/public/v1/offers/4000') && !path.includes('calculate-')) {
        return Promise.resolve(makeOffer({ id: 4000, retail_price: 9.99, seller_price: 8.99 }));
      }
      if (path.startsWith('/api/public/v1/offers/calculate-customer-price/')) {
        return Promise.resolve({
          customer_price: 15.5,
          seller_price: 14.25,
          wholesale_price_tier_one: 15.5,
          wholesale_seller_price_tier_one: 14.25,
          wholesale_price_tier_two: 15.5,
          wholesale_seller_price_tier_two: 14.25,
        });
      }
      if (path.startsWith('/api/public/v1/offers/calculate-seller-price/')) {
        return Promise.resolve({
          customer_price: 15.5,
          seller_price: 14.25,
          wholesale_price_tier_one: 15.5,
          wholesale_seller_price_tier_one: 14.25,
          wholesale_price_tier_two: 15.5,
          wholesale_seller_price_tier_two: 14.25,
        });
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    http.put.mockResolvedValue(undefined);

    const { adapter } = makeAdapter(http);

    const result = await adapter.batchUpdatePrices([
      { externalListingId: '3000', priceCents: 1425, currency: 'EUR' },
      { externalListingId: '4000', priceCents: 899, currency: 'EUR' },
    ]);

    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toBeUndefined();

    const offerPuts = http.put.mock.calls.filter((c) =>
      typeof c[0] === 'string' && /^\/api\/public\/v1\/offers\/\d+$/.test(c[0] as string),
    );
    expect(offerPuts).toHaveLength(2);

    // Tier alignment fed back into the PUT body — the seller nets in the
    // body come from the calculator response, NOT from the raw cents.
    const firstBody = offerPuts[0][1] as Record<string, unknown>;
    expect(firstBody.seller_price).toBe(14.25);
    expect(firstBody.tier_one_seller_price).toBe(14.25);
    expect(firstBody.tier_two_seller_price).toBe(14.25);
    expect(firstBody.keys).toBe(50); // preserved from GET snapshot
    expect(firstBody.wholesale_mode).toBe(1);
  });

  it('records a failure entry when priceCents is non-positive', async () => {
    const http: MockHttp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    const { adapter } = makeAdapter(http);

    const result = await adapter.batchUpdatePrices([
      { externalListingId: '5000', priceCents: 0, currency: 'EUR' },
      { externalListingId: '6000', priceCents: -10, currency: 'EUR' },
    ]);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0].error).toMatch(/positive/);
    expect(http.put).not.toHaveBeenCalled();
  });

  it('continues past a failed offer and reports per-item errors', async () => {
    const http: MockHttp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };

    http.get.mockImplementation((path: string) => {
      if (path === '/api/public/v1/offers/7000') {
        return Promise.reject(new Error('Gamivo 404'));
      }
      if (path === '/api/public/v1/offers/8000') {
        return Promise.resolve(makeOffer({ id: 8000, retail_price: 12.0, seller_price: 11.0 }));
      }
      if (path.includes('/calculate-')) {
        return Promise.resolve({
          customer_price: 12.5,
          seller_price: 11.5,
          wholesale_price_tier_one: 12.5,
          wholesale_seller_price_tier_one: 11.5,
          wholesale_price_tier_two: 12.5,
          wholesale_seller_price_tier_two: 11.5,
        });
      }
      throw new Error(`Unexpected GET ${path}`);
    });
    http.put.mockResolvedValue(undefined);

    const { adapter } = makeAdapter(http);
    const result = await adapter.batchUpdatePrices([
      { externalListingId: '7000', priceCents: 1150, currency: 'EUR' },
      { externalListingId: '8000', priceCents: 1150, currency: 'EUR' },
    ]);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0].externalListingId).toBe('7000');
  });
});

describe('GamivoMarketplaceAdapter.calculateSellerPriceFromCustomerPrice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries /calculate-seller-price with the gross customer price and returns seller_price cents', async () => {
    const http: MockHttp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    http.get.mockResolvedValue({
      customer_price: 15.93,
      seller_price: 14.31,
      wholesale_price_tier_one: 15.93,
      wholesale_seller_price_tier_one: 14.31,
      wholesale_price_tier_two: 15.93,
      wholesale_seller_price_tier_two: 14.31,
    });

    const { adapter } = makeAdapter(http);
    const netCents = await adapter.calculateSellerPriceFromCustomerPrice('3413536', 1593);

    expect(netCents).toBe(1431);
    expect(http.get).toHaveBeenCalledTimes(1);
    const url = http.get.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/public\/v1\/offers\/calculate-seller-price\/3413536\?/);
    expect(url).toContain('price=15.93');
    expect(url).toContain('tier_one_price=15.93');
    expect(url).toContain('tier_two_price=15.93');
  });

  it('throws when externalListingId is empty', async () => {
    const http: MockHttp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    const { adapter } = makeAdapter(http);
    await expect(adapter.calculateSellerPriceFromCustomerPrice('', 1500)).rejects.toThrow(/externalListingId/);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('throws when grossCustomerCents is non-positive', async () => {
    const http: MockHttp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    const { adapter } = makeAdapter(http);
    await expect(adapter.calculateSellerPriceFromCustomerPrice('3413536', 0)).rejects.toThrow(/positive/);
    await expect(adapter.calculateSellerPriceFromCustomerPrice('3413536', -10)).rejects.toThrow(/positive/);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('throws when the calculator returns a non-positive seller_price', async () => {
    const http: MockHttp = { get: vi.fn(), put: vi.fn(), post: vi.fn() };
    http.get.mockResolvedValue({
      customer_price: 15.93,
      seller_price: 0,
      wholesale_price_tier_one: 15.93,
      wholesale_seller_price_tier_one: 0,
      wholesale_price_tier_two: 15.93,
      wholesale_seller_price_tier_two: 0,
    });
    const { adapter } = makeAdapter(http);
    await expect(adapter.calculateSellerPriceFromCustomerPrice('3413536', 1593)).rejects.toThrow(/non-positive/);
  });
});
