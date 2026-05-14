/**
 * Maps WGCards `/api/getAllItem` response items into `provider_product_catalog` upsert rows.
 *
 * One catalog row per SKU (not per item/SPU), because:
 *   - Each SKU has its own unique `skuId` used as `external_product_id`
 *   - SKUs differ in face value and purchase price — they are distinct purchasable products
 *   - The parent `itemId` is stored in `external_parent_product_id` for grouping
 *
 * The PDF documents the SKU array as `skuList`; the live API returns `skuInfos`
 * (same shape as `getItemAndStock`). The mapper handles both.
 * When `skuInfos` is present, price and stock fields are populated immediately.
 */
import type { WgcardsAllItemRecord, WgcardsSkuInfo } from '../../procurement/wgcards/wgcards-http-client.js';

/** Infer platform from product/SKU name. Mirrors the logic in `WgcardsMarketplaceAdapter`. */
function detectPlatform(name: string): string | null {
  const n = name.toLowerCase();
  if (/\bxbox\b/.test(n)) return 'Xbox';
  if (/\bplaystation\b|\bps[45]\b|\bpsn\b/.test(n)) return 'PlayStation';
  if (/\bsteam\b/.test(n)) return 'Steam';
  if (/\bnintendo\b|\bswitch\b|\beshop\b/.test(n)) return 'Nintendo';
  if (/\bea\s?(play|access|origin)\b|\borigin\b/.test(n)) return 'EA';
  if (/\bepic\s?games?\b/.test(n)) return 'Epic Games';
  if (/\bbattle\.?net\b|\bblizzard\b/.test(n)) return 'Battle.net';
  if (/\bubisoft\b|\buplay\b/.test(n)) return 'Ubisoft';
  if (/\bgog\b/.test(n)) return 'GOG';
  if (/\bgoogle\s?play\b/.test(n)) return 'Google Play';
  if (/\bitunes\b|\bapp\s?store\b|\bapple\b/.test(n)) return 'Apple';
  return null;
}

/** Map item-level `currencyCode` (face-value currency) to a human-readable region label. */
function regionFromCurrencyCode(code: string): string | null {
  const map: Record<string, string> = {
    USD: 'Global', EUR: 'Europe', GBP: 'UK', JPY: 'Japan', KRW: 'Korea',
    CNY: 'China', HKD: 'Hong Kong', TWD: 'Taiwan', AUD: 'Australia',
    CAD: 'Canada', BRL: 'Brazil', MXN: 'Mexico', TRY: 'Turkey',
    RUB: 'Russia', INR: 'India', ARS: 'Argentina', PLN: 'Poland',
    SEK: 'Sweden', NOK: 'Norway', DKK: 'Denmark', CHF: 'Switzerland',
    SAR: 'Saudi Arabia', AED: 'UAE', ZAR: 'South Africa', THB: 'Thailand',
    IDR: 'Indonesia', VND: 'Vietnam', UAH: 'Ukraine', MYR: 'Malaysia',
    SGD: 'Singapore', PHP: 'Philippines', NZD: 'New Zealand', CLP: 'Chile',
    COP: 'Colombia', PEN: 'Peru', RON: 'Romania', HUF: 'Hungary',
    CZK: 'Czech Republic', QAR: 'Qatar', KWD: 'Kuwait', JOD: 'Jordan', MAD: 'Morocco',
  };
  return map[code.toUpperCase()] ?? null;
}

/**
 * Flattens a WGCards `getAllItem` response into `provider_product_catalog` upsert rows.
 * Returns one row per SKU; the item (SPU) `itemId` becomes `external_parent_product_id`.
 */
export function flattenWgcardsItemsToCatalogRows(
  items: readonly WgcardsAllItemRecord[],
  providerCode: string,
  providerAccountId: string,
  updatedAtIso: string,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  for (const item of items) {
    const region = regionFromCurrencyCode(item.currencyCode);

    // Live API returns `skuInfos`; PDF docs say `skuList`. Accept either.
    const skus: readonly (WgcardsSkuInfo | { skuId: string; skuName: string; skuPriceCurrency: string; maxFaceValue: number; minFaceValue: number; skuPrice?: number; stock?: number })[] =
      (item.skuInfos && item.skuInfos.length > 0)
        ? item.skuInfos
        : (item.skuList ?? []);

    for (const sku of skus) {
      const productName = `${item.itemName} — ${sku.skuName}`;

      // `getAllItem` returns `skuList` which has NO price or stock fields.
      // `getItemAndStock` returns `skuInfos` which DOES include both.
      // Detect by checking whether the field exists on the object at runtime;
      // do NOT default to 0, because 0 would mark items as unavailable when
      // we simply have no data — a false negative that hides the entire catalog.
      const hasStock = 'stock' in sku;
      const hasPrice = 'skuPrice' in sku;
      const skuPrice = hasPrice ? ((sku as WgcardsSkuInfo).skuPrice ?? 0) : 0;
      const stock = hasStock ? ((sku as WgcardsSkuInfo).stock ?? 0) : null;

      const priceCents = skuPrice > 0 ? Math.round(skuPrice * 100) : 0;
      // When stock data is absent (getAllItem / skuList path), default to available=true:
      // presence in the catalog means the product exists — we just don't know exact qty.
      const available = stock === null ? true : (stock === -1 || stock > 0);

      rows.push({
        provider_account_id: providerAccountId,
        provider_code: providerCode,
        external_product_id: sku.skuId,
        external_parent_product_id: item.itemId,
        product_name: productName,
        platform: detectPlatform(productName),
        region,
        min_price_cents: priceCents,
        currency: sku.skuPriceCurrency || 'USD',
        qty: stock === null ? 0 : (stock === -1 ? 999 : Math.max(0, stock)),
        available_to_buy: available,
        thumbnail: (item as { spuImage?: string | null }).spuImage ?? null,
        slug: item.itemId,
        developer: null,
        publisher: item.itemBrandName || null,
        release_date: null,
        wholesale_price_cents: priceCents > 0 ? priceCents : null,
        updated_at: updatedAtIso,
        raw_data: {
          itemId: item.itemId,
          itemName: item.itemName,
          itemBrandName: item.itemBrandName,
          currencyCode: item.currencyCode,
          spuType: item.spuType,
          skuId: sku.skuId,
          skuName: sku.skuName,
          maxFaceValue: sku.maxFaceValue,
          minFaceValue: sku.minFaceValue,
        },
      });
    }
  }

  return rows;
}
