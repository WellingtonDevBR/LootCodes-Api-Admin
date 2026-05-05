/**
 * Bamboo marketplace adapter — buyer/procurement only.
 *
 * Capabilities:
 *  - IProductSearchAdapter: live catalog search via Bamboo V2 API
 *
 * Bamboo is a stored-value product provider (gift cards, game cards).
 * It does NOT support seller/marketplace listings.
 *
 * Auth: HTTP Basic (ClientId:ClientSecret)
 * Catalog: GET /api/integration/v2.0/catalog?Name={term}&TargetCurrency=USD
 * Orders:  GET /api/integration/v1.0/orders/{requestId}
 */
import type {
  IProductSearchAdapter,
  ProductSearchResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type { BambooCatalogResponse, BambooOrderResponse, BambooCard } from './types.js';
import { createLogger } from '../../../shared/logger.js';
import { floatToCents } from '../../../shared/pricing.js';

const logger = createLogger('bamboo-adapter');

const CATALOG_PAGE_SIZE = 50;
const TARGET_CURRENCY = 'USD';

function detectPlatformFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (/\bxbox\b/.test(lower)) return 'Xbox';
  if (/\bplaystation\b|\bps[45]\b|\bpsn\b/.test(lower)) return 'PlayStation';
  if (/\bsteam\b/.test(lower)) return 'Steam';
  if (/\bnintendo\b|\bswitch\b|\beshop\b/.test(lower)) return 'Nintendo';
  if (/\bea\s?(play|access|origin)\b|\borigin\b/.test(lower)) return 'EA';
  if (/\bepic\s?games?\b/.test(lower)) return 'Epic Games';
  if (/\bbattle\.?net\b|\bblizzard\b/.test(lower)) return 'Battle.net';
  if (/\bubisoft\b|\buplay\b/.test(lower)) return 'Ubisoft';
  if (/\bgog\b/.test(lower)) return 'GOG';
  return null;
}

export function mapCardToKey(card: BambooCard): string {
  const parts = [card.cardCode];
  if (card.pin) {
    parts.push(`PIN: ${card.pin}`);
  }
  return parts.join(' | ');
}

export class BambooMarketplaceAdapter implements IProductSearchAdapter {
  private readonly catalogClient: MarketplaceHttpClient;
  private readonly ordersClient: MarketplaceHttpClient;

  constructor(catalogClient: MarketplaceHttpClient, ordersClient: MarketplaceHttpClient) {
    this.catalogClient = catalogClient;
    this.ordersClient = ordersClient;
  }

  async searchProducts(query: string, limit?: number): Promise<ProductSearchResult[]> {
    const maxResults = limit ?? 20;

    try {
      const path = `catalog?Name=${encodeURIComponent(query)}&TargetCurrency=${TARGET_CURRENCY}&PageSize=${CATALOG_PAGE_SIZE}&PageIndex=0`;

      const response = await this.catalogClient.get<BambooCatalogResponse>(path);

      const results: ProductSearchResult[] = [];

      for (const brand of response.items ?? []) {
        for (const product of brand.products ?? []) {
          if (product.isDeleted) continue;
          if (results.length >= maxResults) break;

          results.push({
            externalProductId: String(product.id),
            productName: product.name || brand.name,
            platform: detectPlatformFromName(product.name) ?? detectPlatformFromName(brand.name),
            region: brand.countryCode === 'GLC' ? 'GLOBAL' : brand.countryCode,
            priceCents: floatToCents(product.price.min),
            currency: product.price.currencyCode,
            available: !product.isDeleted && (product.count === null || product.count > 0),
          });
        }
        if (results.length >= maxResults) break;
      }

      return results;
    } catch (err) {
      logger.warn('Bamboo catalog search failed', err as Error, { query });
      return [];
    }
  }

  async fetchOrderResult(requestId: string): Promise<BambooOrderResponse> {
    return this.ordersClient.get<BambooOrderResponse>(
      `orders/${encodeURIComponent(requestId)}`,
    );
  }

  extractKeysFromOrder(order: BambooOrderResponse): string[] {
    const keys: string[] = [];
    for (const item of order.items ?? []) {
      for (const card of item.cards ?? []) {
        if (card.cardCode && (!card.status || card.status.toLowerCase() === 'sold')) {
          keys.push(mapCardToKey(card));
        }
      }
    }
    return keys;
  }
}
