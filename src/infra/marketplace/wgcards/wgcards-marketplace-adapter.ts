/**
 * WgcardsMarketplaceAdapter — IProductSearchAdapter for WGCards.
 *
 * Uses `/api/getItemAndStock` for live product search:
 *   - `itemName` maps to the search query (partial-match, case-insensitive server-side)
 *   - Each item (SPU) contains multiple SKUs; each SKU becomes one ProductSearchResult
 *   - `skuId` is stored as `externalProductId` (matches `provider_variant_offers.external_offer_id`)
 *   - `stock` is included per SKU; -1 means unlimited
 *
 * Rate limit: 5 calls / 60 seconds — handled naturally by live-search debouncing in the CRM.
 */
import type {
  IProductSearchAdapter,
  ProductSearchResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type { WgcardsHttpClient } from '../../procurement/wgcards/wgcards-http-client.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('wgcards-marketplace-adapter');

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

/**
 * Infer a human-readable region from the face-value currency code.
 * WGCards `currencyCode` is the transaction currency of the card (e.g. JPY for a JP Nintendo card).
 */
function regionFromCurrencyCode(code: string): string | null {
  const map: Record<string, string> = {
    USD: 'Global',
    EUR: 'Europe',
    GBP: 'UK',
    JPY: 'Japan',
    KRW: 'Korea',
    CNY: 'China',
    HKD: 'Hong Kong',
    TWD: 'Taiwan',
    AUD: 'Australia',
    CAD: 'Canada',
    BRL: 'Brazil',
    MXN: 'Mexico',
    TRY: 'Turkey',
    RUB: 'Russia',
    INR: 'India',
    ARS: 'Argentina',
    PLN: 'Poland',
    SEK: 'Sweden',
    NOK: 'Norway',
    DKK: 'Denmark',
    CHF: 'Switzerland',
    SAR: 'Saudi Arabia',
    AED: 'UAE',
    ZAR: 'South Africa',
    THB: 'Thailand',
    IDR: 'Indonesia',
    VND: 'Vietnam',
    UAH: 'Ukraine',
    MYR: 'Malaysia',
    SGD: 'Singapore',
    PHP: 'Philippines',
    NZD: 'New Zealand',
    CLP: 'Chile',
    COP: 'Colombia',
    PEN: 'Peru',
    RON: 'Romania',
    HUF: 'Hungary',
    CZK: 'Czech Republic',
    QAR: 'Qatar',
    KWD: 'Kuwait',
    JOD: 'Jordan',
    MAD: 'Morocco',
  };
  return map[code.toUpperCase()] ?? null;
}

export class WgcardsMarketplaceAdapter implements IProductSearchAdapter {
  constructor(
    private readonly client: WgcardsHttpClient,
    private readonly appId: string,
  ) {}

  async searchProducts(query: string, limit = 15): Promise<ProductSearchResult[]> {
    // Fetch up to 3x the limit at the item level because each item (SPU) expands
    // into multiple SKUs. The API page `size` is items, not SKUs.
    const pageSize = Math.min(Math.ceil((limit * 3) / 2), 50);

    let page;
    try {
      page = await this.client.getItemAndStock({
        appId: this.appId,
        itemName: query,
        currencyCode: 'USD',
        current: 1,
        size: pageSize,
      });
    } catch (err) {
      logger.warn(
        'WGCards getItemAndStock failed',
        err instanceof Error ? err : new Error(String(err)),
        { query },
      );
      return [];
    }

    const results: ProductSearchResult[] = [];

    for (const item of page.records) {
      for (const sku of item.skuInfos) {
        if (results.length >= limit) break;

        const available = sku.stock === -1 || sku.stock > 0;
        const priceCents = sku.skuPrice > 0 ? Math.round(sku.skuPrice * 100) : 0;
        const combinedName = `${item.itemName} — ${sku.skuName}`;

        results.push({
          externalProductId: sku.skuId,
          productName: combinedName,
          platform: detectPlatform(combinedName),
          region: regionFromCurrencyCode(item.currencyCode),
          priceCents,
          currency: sku.skuPriceCurrency,
          available,
        });
      }

      if (results.length >= limit) break;
    }

    return results;
  }
}
