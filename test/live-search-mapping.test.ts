import { describe, expect, it } from 'vitest';
import type { ProductSearchResult } from '../src/core/ports/marketplace-adapter.port.js';
import type { CatalogProductRow } from '../src/core/use-cases/procurement/procurement.types.js';
import {
  catalogProductRowToLiveSearchOffer,
  liveSearchOffersToCatalogUpsertRows,
  productSearchResultsToLiveSearchOffers,
} from '../src/infra/procurement/live-search-mapping.js';

describe('live-search-mapping', () => {
  it('maps catalog rows and search API hits to LiveSearchOffer consistently', () => {
    const row: CatalogProductRow = {
      id: 'c1',
      provider_code: 'foo',
      external_product_id: 'ext',
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
});
