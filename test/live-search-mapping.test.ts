import { describe, expect, it } from 'vitest';
import type { ProductSearchResult } from '../src/core/ports/marketplace-adapter.port.js';
import type { CatalogProductRow } from '../src/core/use-cases/procurement/procurement.types.js';
import {
  catalogProductRowToLiveSearchOffer,
  combineLiveSearchOfferWithCatalog,
  liveSearchOffersToCatalogUpsertRows,
  mergeLiveSearchOffers,
  productSearchResultsToLiveSearchOffers,
} from '../src/infra/procurement/live-search-mapping.js';

describe('live-search-mapping', () => {
  it('maps catalog rows and search API hits to LiveSearchOffer consistently', () => {
    const row: CatalogProductRow = {
      id: 'c1',
      provider_code: 'foo',
      external_product_id: 'ext',
      external_parent_product_id: null,
      product_name: 'Game',
      platform: 'PC',
      region: 'EU',
      min_price_cents: 100,
      currency: 'EUR',
      qty: 2,
      available_to_buy: true,
      thumbnail: null,
      slug: null,
      wholesale_price_cents: null,
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const apiHit: ProductSearchResult = {
      externalProductId: 'ext',
      productName: 'Game',
      platform: 'PC',
      region: 'EU',
      priceCents: 100,
      currency: 'EUR',
      available: true,
    };

    const fromCatalog = catalogProductRowToLiveSearchOffer(row);
    const [fromApi] = productSearchResultsToLiveSearchOffers('foo', [apiHit]);

    expect(fromCatalog.external_product_id).toBe(fromApi.external_product_id);
    expect(fromCatalog.price_cents).toBe(fromApi.price_cents);
    expect(fromApi.provider_code).toBe('foo');
    expect(fromApi.thumbnail).toBeNull();
  });

  it('builds provider_product_catalog upsert payloads', () => {
    const offers = productSearchResultsToLiveSearchOffers('bamboo', [
      {
        externalProductId: 'x',
        productName: 'Y',
        platform: null,
        region: null,
        priceCents: 50,
        currency: 'USD',
        available: true,
      },
    ]);

    const rows = liveSearchOffersToCatalogUpsertRows(offers, 'bamboo', 'acct-1', '2026-05-07T12:00:00.000Z');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider_account_id).toBe('acct-1');
    expect(rows[0]?.external_product_id).toBe('x');
    expect(rows[0]?.qty).toBe(1);
    expect(rows[0]?.updated_at).toBe('2026-05-07T12:00:00.000Z');
  });

  it('mergeLiveSearchOffers replaces zero live prices from catalog for the same external_product_id', () => {
    const live = productSearchResultsToLiveSearchOffers('eneba', [
      {
        externalProductId: 'p1',
        productName: 'API title',
        platform: 'xbox',
        region: 'TR',
        priceCents: 0,
        currency: 'EUR',
        available: true,
      },
    ]);
    const row: CatalogProductRow = {
      id: 'c1',
      provider_code: 'eneba',
      external_product_id: 'p1',
      external_parent_product_id: null,
      product_name: 'Catalog title',
      platform: 'xbox',
      region: 'TR',
      min_price_cents: 612,
      currency: 'EUR',
      qty: 1,
      available_to_buy: true,
      thumbnail: 't.jpg',
      slug: null,
      wholesale_price_cents: null,
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const fromCatalog = catalogProductRowToLiveSearchOffer(row);

    const merged = mergeLiveSearchOffers(live, [fromCatalog], 10);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.product_name).toBe('API title');
    expect(merged[0]?.price_cents).toBe(612);
    expect(merged[0]?.thumbnail).toBe('t.jpg');
  });

  it('combineLiveSearchOfferWithCatalog keeps live price when live already has a positive quote', () => {
    const live = productSearchResultsToLiveSearchOffers('eneba', [
      {
        externalProductId: 'p1',
        productName: 'X',
        platform: null,
        region: null,
        priceCents: 900,
        currency: 'EUR',
        available: true,
      },
    ])[0]!;
    const cat = catalogProductRowToLiveSearchOffer({
      id: 'c',
      provider_code: 'eneba',
      external_product_id: 'p1',
      external_parent_product_id: null,
      product_name: 'Y',
      platform: null,
      region: null,
      min_price_cents: 100,
      currency: 'USD',
      qty: 1,
      available_to_buy: true,
      thumbnail: null,
      slug: null,
      wholesale_price_cents: null,
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const out = combineLiveSearchOfferWithCatalog(live, cat);
    expect(out.price_cents).toBe(900);
    expect(out.currency).toBe('EUR');
  });
});
