import type { ProductSearchResult } from '../../core/ports/marketplace-adapter.port.js';
import type { CatalogProductRow, LiveSearchOffer } from '../../core/use-cases/procurement/procurement.types.js';

export function catalogProductRowToLiveSearchOffer(row: CatalogProductRow): LiveSearchOffer {
  return {
    provider_code: row.provider_code,
    external_product_id: row.external_product_id,
    product_name: row.product_name,
    platform: row.platform ?? null,
    region: row.region ?? null,
    price_cents: row.min_price_cents ?? 0,
    currency: row.currency ?? 'EUR',
    available: row.available_to_buy ?? true,
    thumbnail: row.thumbnail ?? null,
  };
}

export function productSearchResultsToLiveSearchOffers(
  providerCode: string,
  results: readonly ProductSearchResult[],
): LiveSearchOffer[] {
  return results.map((r) => ({
    provider_code: providerCode,
    external_product_id: r.externalProductId,
    product_name: r.productName,
    platform: r.platform,
    region: r.region,
    price_cents: r.priceCents,
    currency: r.currency,
    available: r.available,
    thumbnail: null,
  }));
}

export function liveSearchOffersToCatalogUpsertRows(
  offers: readonly LiveSearchOffer[],
  providerCode: string,
  providerAccountId: string,
  updatedAtIso: string,
): Record<string, unknown>[] {
  return offers.map((o) => ({
    provider_account_id: providerAccountId,
    provider_code: providerCode,
    external_product_id: o.external_product_id,
    product_name: o.product_name,
    platform: o.platform ?? null,
    region: o.region ?? null,
    min_price_cents: o.price_cents,
    currency: o.currency,
    qty: 1,
    available_to_buy: o.available,
    thumbnail: o.thumbnail ?? null,
    slug: null,
    developer: null,
    publisher: null,
    release_date: null,
    wholesale_price_cents: null,
    updated_at: updatedAtIso,
  }));
}
