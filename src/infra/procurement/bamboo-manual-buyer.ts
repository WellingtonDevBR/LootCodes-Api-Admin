/**
 * Bamboo buyer HTTP for admin manual purchase (checkout + poll).
 * Mirrors Edge `provider-procurement/providers/bamboo/adapter.ts` purchase path.
 */
import { createHash } from 'node:crypto';
import { MarketplaceApiError, MarketplaceHttpClient } from '../marketplace/_shared/marketplace-http.js';
import type { BambooCatalogResponse, BambooOrderResponse, BambooCard } from '../marketplace/bamboo/types.js';
import { getOptionalEnvVar } from '../../config/env.js';
import { floatToCents } from '../../shared/pricing.js';
import { buildProviderProxyHeaders } from './provider-proxy-headers.js';
import { createLogger } from '../../shared/logger.js';
import {
  normalizeBambooWalletCurrency,
  parseBambooAccountsResponse,
  resolveBambooCheckoutAccountId,
} from './bamboo-resolve-checkout-account.js';

const logger = createLogger('bamboo-manual-buyer');

/** Official Bamboo Card Portal integration hosts (same host prod/sandbox; credentials differ). */
export const BAMBOO_OFFICIAL_INTEGRATION_V1 = 'https://api.bamboocardportal.com/api/integration/v1.0';
export const BAMBOO_OFFICIAL_INTEGRATION_V2 = 'https://api.bamboocardportal.com/api/integration/v2.0';

/** Hostname for Bamboo's public integration API (do not send EC2 proxy HMAC headers here). */
export const BAMBOO_OFFICIAL_API_HOSTNAME = 'api.bamboocardportal.com';

export function isBambooOfficialIntegrationHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === BAMBOO_OFFICIAL_API_HOSTNAME;
  } catch {
    return false;
  }
}

/**
 * EC2 proxy signing (`PROVIDER_PROXY_SHARED_SECRET`) must not be sent to Bamboo's
 * public API — extraneous `x-ts` / `x-signature` can yield HTTP 400 from their gateway.
 */
export function resolveBambooProxySigner(
  baseUrl: string,
): typeof buildProviderProxyHeaders | undefined {
  return isBambooOfficialIntegrationHost(baseUrl) ? undefined : buildProviderProxyHeaders;
}

function envFlagEnabled(name: string): boolean {
  const raw = getOptionalEnvVar(name);
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function profileStr(profile: Record<string, unknown>, key: string): string | undefined {
  const v = profile[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Resolves catalog (v2) and orders (v1) base URLs.
 * When `BAMBOO_FORCE_PUBLIC_API` is set, ignores `api_profile` proxy URLs and
 * targets api.bamboocardportal.com (optional overrides via `BAMBOO_PUBLIC_BASE_URL_*`).
 */
export function resolveBambooIntegrationBaseUrls(profile: Record<string, unknown>): {
  readonly catalogBaseUrl: string;
  readonly ordersBaseUrl: string;
  readonly usingForcedPublicApi: boolean;
} {
  const forcePublic = envFlagEnabled('BAMBOO_FORCE_PUBLIC_API');
  if (forcePublic) {
    const v2 = getOptionalEnvVar('BAMBOO_PUBLIC_BASE_URL_V2') ?? BAMBOO_OFFICIAL_INTEGRATION_V2;
    const v1 = getOptionalEnvVar('BAMBOO_PUBLIC_BASE_URL_V1') ?? BAMBOO_OFFICIAL_INTEGRATION_V1;
    return {
      catalogBaseUrl: trimTrailingSlash(v2),
      ordersBaseUrl: trimTrailingSlash(v1),
      usingForcedPublicApi: true,
    };
  }

  const v2 = profileStr(profile, 'base_url_v2') ?? BAMBOO_OFFICIAL_INTEGRATION_V2;
  const v1 = profileStr(profile, 'base_url') ?? BAMBOO_OFFICIAL_INTEGRATION_V1;
  return {
    catalogBaseUrl: trimTrailingSlash(v2),
    ordersBaseUrl: trimTrailingSlash(v1),
    usingForcedPublicApi: false,
  };
}

const ORDER_POLL_INTERVAL_MS = 2_000;
const ORDER_POLL_MAX_ATTEMPTS = 15;
const BAMBOO_HTTP_TIMEOUT_MS = 60_000;

export interface BambooOfferQuote {
  readonly price_cents: number;
  readonly currency: string;
  readonly available_quantity: number | null;
  readonly provider_metadata: Record<string, unknown>;
}

export interface BambooManualPurchaseExecResult {
  readonly success: boolean;
  readonly keys?: string[];
  readonly provider_order_ref?: string;
  readonly provider_request_id?: string;
  readonly cost_cents?: number | null;
  readonly currency?: string;
  readonly error_code?: string;
  readonly error_message?: string;
}

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

function normalizeRegion(countryCode: string): string | null {
  if (!countryCode) return null;
  return countryCode === 'GLC' ? 'GLOBAL' : countryCode;
}

function mapProductToQuote(product: BambooCatalogResponse['items'][0]['products'][0], brand: BambooCatalogResponse['items'][0]): BambooOfferQuote {
  const platform = detectPlatformFromName(product.name) ?? detectPlatformFromName(brand.name);
  const region = normalizeRegion(brand.countryCode);

  return {
    price_cents: floatToCents(product.price.min),
    currency: product.price.currencyCode,
    available_quantity: product.count ?? null,
    provider_metadata: {
      product_name: product.name,
      brand_id: brand.internalId,
      brand_name: brand.name,
      country_code: brand.countryCode,
      platform,
      region,
      min_face_value: product.minFaceValue,
      max_face_value: product.maxFaceValue,
      logo_url: brand.logoUrl ?? null,
      is_deleted: product.isDeleted,
      cheapest_offer_id: String(product.id),
    },
  };
}

function mapOrderStatus(status: string): 'success' | 'failed' | 'pending' {
  const lower = status.toLowerCase();
  if (lower === 'succeeded' || lower === 'partialfailed') return 'success';
  if (lower === 'failed' || lower === 'cancelled' || lower === 'canceled') return 'failed';
  return 'pending';
}

export function mapCardToKey(card: BambooCard): string {
  const parts = [card.cardCode];
  if (card.pin) {
    parts.push(`PIN: ${card.pin}`);
  }
  return parts.join(' | ');
}

function extractKeysFromOrder(order: BambooOrderResponse): string[] {
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

function toGuid(input: string): string {
  const hex = createHash('sha256').update(input, 'utf8').digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBambooManualBuyer(params: {
  readonly secrets: Record<string, string>;
  readonly profile: Record<string, unknown>;
}): BambooManualBuyer | null {
  const clientId = params.secrets['BAMBOO_CLIENT_ID'];
  const clientSecret = params.secrets['BAMBOO_CLIENT_SECRET'];
  const { catalogBaseUrl, ordersBaseUrl, usingForcedPublicApi } = resolveBambooIntegrationBaseUrls(
    params.profile,
  );
  if (usingForcedPublicApi) {
    logger.info('Bamboo manual buyer: BAMBOO_FORCE_PUBLIC_API — using api.bamboocardportal.com integration URLs');
  }

  const accountIdRaw = params.profile.account_id ?? params.profile['account_id'];
  const accountId =
    typeof accountIdRaw === 'number' && Number.isFinite(accountIdRaw)
      ? accountIdRaw
      : Number.parseInt(String(accountIdRaw ?? '0'), 10);

  if (!clientId || !clientSecret || !accountId) {
    logger.warn('Bamboo manual buyer unavailable — missing client credentials or account_id in api_profile');
    return null;
  }

  const basicAuth = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

  const catalogClient = new MarketplaceHttpClient({
    baseUrl: catalogBaseUrl,
    providerCode: 'bamboo',
    timeoutMs: BAMBOO_HTTP_TIMEOUT_MS,
    rateLimiter: { maxRequests: 50, windowMs: 60_000 },
    headers: async () => ({ Authorization: basicAuth }),
    proxySigner: resolveBambooProxySigner(catalogBaseUrl),
  });

  const ordersClient = new MarketplaceHttpClient({
    baseUrl: ordersBaseUrl,
    providerCode: 'bamboo',
    timeoutMs: BAMBOO_HTTP_TIMEOUT_MS,
    rateLimiter: { maxRequests: 50, windowMs: 60_000 },
    headers: async () => ({ Authorization: basicAuth }),
    proxySigner: resolveBambooProxySigner(ordersBaseUrl),
  });

  return new BambooManualBuyer(catalogClient, ordersClient, accountId);
}

export class BambooManualBuyer {
  constructor(
    private readonly catalogClient: MarketplaceHttpClient,
    private readonly ordersClient: MarketplaceHttpClient,
    private readonly accountId: number,
  ) {}

  /**
   * Active non-sandbox wallets for UI / checkout currency selection (Bamboo GET accounts).
   */
  async fetchLiveWalletSummaries(): Promise<
    ReadonlyArray<{ readonly id: number; readonly currency: string; readonly balance: number }>
  > {
    const raw = await this.ordersClient.get<unknown>('accounts');
    return parseBambooAccountsResponse(raw)
      .filter((a) => a.isActive && !a.sandboxMode && Number.isFinite(a.id) && a.id > 0)
      .map((a) => ({
        id: a.id,
        currency: normalizeBambooWalletCurrency(a.currency),
        balance: a.balance,
      }))
      .sort((x, y) => x.currency.localeCompare(y.currency) || x.id - y.id);
  }

  async quote(offerId: string, targetCurrency = 'USD'): Promise<BambooOfferQuote> {
    const tc = normalizeBambooWalletCurrency(targetCurrency);
    const path = `catalog?ProductId=${encodeURIComponent(offerId)}&TargetCurrency=${encodeURIComponent(tc)}`;
    try {
      const result = await this.catalogClient.get<BambooCatalogResponse>(path);
      for (const brand of result.items ?? []) {
        const product = brand.products?.find((p) => String(p.id) === String(offerId));
        if (product) {
          return mapProductToQuote(product, brand);
        }
      }
      throw new Error(`Bamboo product not found: ${offerId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/\b429\b|Too many requests/i.test(msg)) throw err;
      logger.warn('Bamboo catalog quote rate-limited; retrying once', { offerId });
      await sleep(2_500);
      const result = await this.catalogClient.get<BambooCatalogResponse>(path);
      for (const brand of result.items ?? []) {
        const product = brand.products?.find((p) => String(p.id) === String(offerId));
        if (product) {
          return mapProductToQuote(product, brand);
        }
      }
      throw new Error(`Bamboo product not found: ${offerId}`);
    }
  }

  async purchase(
    offerId: string,
    quantity: number,
    idempotencyKey: string,
    options?: {
      readonly prefetchedQuote?: BambooOfferQuote;
      readonly walletCurrency?: string;
    },
  ): Promise<BambooManualPurchaseExecResult> {
    const walletCurrency = normalizeBambooWalletCurrency(options?.walletCurrency);
    let faceValue: number;
    try {
      const quoteResult = options?.prefetchedQuote ?? await this.quote(offerId, walletCurrency);
      const meta = quoteResult.provider_metadata;
      faceValue = typeof meta.min_face_value === 'number' ? meta.min_face_value : 0;
      if (!faceValue) {
        return {
          success: false,
          error_code: 'INVALID_FACE_VALUE',
          error_message: `Cannot determine face value for product ${offerId}`,
        };
      }
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error_code: 'QUOTE_FAILED',
        error_message: `Cannot determine price for product ${offerId}: ${cause}`,
      };
    }

    const bambooRequestId = toGuid(idempotencyKey);

    let checkoutAccountId = this.accountId;
    try {
      const accountsRaw = await this.ordersClient.get<unknown>('accounts');
      const accounts = parseBambooAccountsResponse(accountsRaw);
      const resolved = resolveBambooCheckoutAccountId(this.accountId, accounts, walletCurrency);
      if (!resolved.ok) {
        return {
          success: false,
          error_code: 'INVALID_BAMBOO_ACCOUNT',
          error_message: resolved.error_message,
        };
      }
      checkoutAccountId = resolved.accountId;
      if (resolved.resolutionNote) {
        logger.warn(resolved.resolutionNote, {
          configuredAccountId: this.accountId,
          checkoutAccountId,
        });
      }
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error_code: 'ACCOUNTS_FETCH_FAILED',
        error_message: `Cannot resolve Bamboo live account (GET accounts failed): ${cause}`,
      };
    }

    const checkoutBody = {
      RequestId: bambooRequestId,
      AccountId: checkoutAccountId,
      Products: [{
        ProductId: Number(offerId),
        Quantity: quantity,
        Value: faceValue,
      }],
    };

    try {
      await this.ordersClient.post<string>('orders/checkout', checkoutBody);
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      if (err instanceof MarketplaceApiError && err.responseBody?.trim()) {
        const snippet = err.responseBody.trim().slice(0, 500);
        message = `${message}: ${snippet}`;
      }
      return {
        success: false,
        error_code: 'ORDER_CREATE_FAILED',
        error_message: message,
      };
    }

    const order = await this.pollOrderCompletion(bambooRequestId);
    if (!order) {
      return {
        success: false,
        provider_order_ref: bambooRequestId,
        error_code: 'ORDER_TIMEOUT',
        error_message: 'Bamboo order did not complete within expected time',
      };
    }

    const orderStatus = mapOrderStatus(order.status);
    if (orderStatus === 'failed') {
      return {
        success: false,
        provider_order_ref: bambooRequestId,
        provider_request_id: String(order.orderId),
        error_code: 'ORDER_FAILED',
        error_message: order.errorMessage ?? 'Bamboo order failed',
      };
    }

    const keys = extractKeysFromOrder(order);
    if (!keys.length) {
      return {
        success: false,
        provider_order_ref: bambooRequestId,
        provider_request_id: String(order.orderId),
        error_code: 'NO_KEYS_RETURNED',
        error_message: 'Bamboo returned no card codes after successful order',
      };
    }

    return {
      success: true,
      provider_order_ref: bambooRequestId,
      provider_request_id: String(order.orderId),
      keys,
      cost_cents: floatToCents(order.total),
      currency: order.currency,
    };
  }

  private async pollOrderCompletion(requestId: string): Promise<BambooOrderResponse | null> {
    for (let attempt = 0; attempt < ORDER_POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(ORDER_POLL_INTERVAL_MS);
      }

      let order: BambooOrderResponse;
      try {
        order = await this.ordersClient.get<BambooOrderResponse>(
          `orders/${encodeURIComponent(requestId)}`,
        );
      } catch {
        continue;
      }

      const simplified = mapOrderStatus(order.status);
      if (simplified === 'failed') {
        return order;
      }

      if (simplified === 'success') {
        const keys = extractKeysFromOrder(order);
        if (keys.length > 0) {
          return order;
        }
      }
    }

    return null;
  }
}
