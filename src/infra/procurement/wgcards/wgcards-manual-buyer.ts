/**
 * WgcardsManualBuyer — wires together the crypto, token manager, and HTTP client
 * into a cohesive buyer object consumed by `WgcardsBuyerProvider`.
 *
 * Factory function `createWgcardsManualBuyer` follows the same pattern as
 * `createBambooManualBuyer` and `createAppRouteManualBuyer`:
 *   - Reads secrets from `provider_secrets_ref` (via Vault) — never from `api_profile`.
 *   - Reads non-secret config (base_url) from `api_profile`.
 *   - Returns `null` with a `logger.warn` if any required secret is missing.
 *
 * Secrets expected in `provider_secrets_ref`:
 *   WGCARDS_APP_ID     — also serves as the AES-128 key (must be 16 bytes)
 *   WGCARDS_APP_KEY    — used only for getToken; not stored elsewhere
 *   WGCARDS_ACCOUNT_ID — accountId sent in all request envelopes
 *
 * api_profile keys:
 *   base_url  — defaults to https://api.wgcards.com (omit for production)
 */
import { createLogger } from '../../../shared/logger.js';
import { WgcardsAesCrypto } from './wgcards-aes-crypto.js';
import { WgcardsTokenManager, type WgcardsCachedToken } from './wgcards-token-manager.js';
import {
  WgcardsHttpClient,
  type WgcardsAccountData,
  type WgcardsBuyCardData,
  type WgcardsPlaceOrderRequest,
  type WgcardsSkuInfo,
} from './wgcards-http-client.js';

const logger = createLogger('wgcards-manual-buyer');

const WGCARDS_DEFAULT_BASE_URL = 'https://api.wgcards.com';

/** WGCards JSON occasionally types `skuId` as a number — always compare coercively. */
export function sameWgcardsSkuId(apiValue: string | number, expected: string): boolean {
  return String(apiValue).trim() === String(expected).trim();
}

/** Poll config: how long to wait for card delivery after placeOrder. */
const CARD_POLL_INTERVAL_MS = 2_000;
const CARD_POLL_MAX_ATTEMPTS = 15; // 30 s total max

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function profileStr(profile: Record<string, unknown>, key: string): string | undefined {
  const v = profile[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export interface WgcardsQuoteResult {
  /** Unit cost in the smallest denomination of `currency` (i.e. cents for USD). */
  readonly price_cents: number;
  readonly currency: string;
  /** null when the supplier reports unlimited stock (-1). */
  readonly available_quantity: number | null;
}

export interface WgcardsPurchaseResult {
  readonly success: boolean;
  readonly orderId?: string;
  readonly keys?: readonly string[];
  readonly error?: string;
  readonly recoverable?: boolean;
}

/** Resolved from `getItemAndStock` — required so `placeOrder` uses the same pay currency / face value as pricing. */
export interface WgcardsSkuCheckoutMeta {
  /** ISO 4217 pay currency (`skuPriceCurrency` from WGCards). */
  readonly payCurrency: string;
  /** Present when the SKU is a fixed-denomination product (`minFaceValue === maxFaceValue`). */
  readonly faceValue?: number;
  /** From live SKU — custom-denomination SKUs need `faceValue` on placeOrder (see API doc). */
  readonly minFaceValue: number;
  readonly maxFaceValue: number;
}

export class WgcardsManualBuyer {
  constructor(
    private readonly client: WgcardsHttpClient,
    private readonly appId: string,
  ) {}

  async getAccount(): Promise<WgcardsAccountData> {
    return this.client.getAccount();
  }

  /** Batch-fetch stock for up to ~100 skuIds in one API call (5/60s rate limit). */
  async getStockBatch(skuIds: readonly string[]): Promise<ReadonlyArray<{ skuId: string; number: number }>> {
    return this.client.getStock(skuIds);
  }

  /**
   * Fetch live price + stock for all SKUs under a given parent itemId.
   * Uses `getItemAndStock(itemId)` which returns `skuInfos` with both
   * `skuPrice` and `stock` — the only WGCards endpoint that provides price
   * data in addition to availability.
   * Rate limit: 5/60s.
   */
  async getItemAndStockByParent(
    itemId: string,
    currencyCode = 'USD',
  ): Promise<readonly WgcardsSkuInfo[]> {
    const page = await this.client.getItemAndStock({
      appId: this.appId,
      itemId,
      currencyCode,
      current: 1,
      size: 200,
    });
    const record = page.records.find((r) => r.itemId === itemId);
    return record?.skuInfos ?? [];
  }

  /**
   * Looks up live SKU metadata for `placeOrder`.
   * WGCards rejects orders when `currency` does not match the wallet / quote currency for that SKU (often CNY).
   */
  async getSkuCheckoutMeta(
    parentItemId: string,
    skuId: string,
    currencyHint: string,
  ): Promise<WgcardsSkuCheckoutMeta | null> {
    const hint = /^[A-Za-z]{3}$/.test(currencyHint.trim()) ? currencyHint.trim().toUpperCase() : 'USD';

    let skus = await this.getItemAndStockByParent(parentItemId, hint);
    let sku = skus.find((s) => sameWgcardsSkuId(s.skuId, skuId)) ?? null;

    if (!sku) {
      skus = await this.getItemAndStockByParent(parentItemId, 'USD');
      sku = skus.find((s) => sameWgcardsSkuId(s.skuId, skuId)) ?? null;
    }
    if (!sku) {
      skus = await this.getItemAndStockByParent(parentItemId, 'CNY');
      sku = skus.find((s) => sameWgcardsSkuId(s.skuId, skuId)) ?? null;
    }
    if (!sku) {
      return null;
    }

    let payCurrency = (sku.skuPriceCurrency || hint).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(payCurrency)) {
      payCurrency = hint;
    }

    if (payCurrency !== hint) {
      skus = await this.getItemAndStockByParent(parentItemId, payCurrency);
      sku = skus.find((s) => sameWgcardsSkuId(s.skuId, skuId)) ?? sku;
    }

    const minFv = Number(sku.minFaceValue);
    const maxFv = Number(sku.maxFaceValue);
    const boundsOk = Number.isFinite(minFv) && Number.isFinite(maxFv);

    const faceValue =
      boundsOk && minFv === maxFv
        ? minFv
        : undefined;

    return {
      payCurrency,
      minFaceValue: boundsOk ? minFv : 0,
      maxFaceValue: boundsOk ? maxFv : 0,
      ...(faceValue !== undefined ? { faceValue } : {}),
    };
  }

  async quote(skuId: string): Promise<WgcardsQuoteResult> {
    const stocks = await this.client.getStock([skuId]);
    const entry = stocks.find((s) => sameWgcardsSkuId(s.skuId, skuId));
    if (!entry) {
      throw new Error(`WGCards getStock: skuId ${skuId} not found in response`);
    }

    // WGCards returns prices in the `skuPrice` field via getItemAndStock, but
    // getStock only returns `number` (quantity). For quote pricing we use the
    // stock check combined with the cached snapshot price. If stock is 0 we
    // report unavailable.
    const availableQuantity = entry.number === -1 ? null : entry.number;

    // Price cannot be obtained from getStock alone — we return 0 cents and
    // let the provider snapshot supply the cost. The stock availability is
    // the primary output of quote() from WGCards.
    return {
      price_cents: 0,
      currency: 'USD',
      available_quantity: availableQuantity,
    };
  }

  async purchase(req: WgcardsPlaceOrderRequest): Promise<WgcardsPurchaseResult> {
    let orderId: string;
    try {
      orderId = await this.client.placeOrder(req);
    } catch (err) {
      logger.error('WGCards placeOrder failed', err instanceof Error ? err : new Error(String(err)), {
        serviceOrder: req.serviceOrder,
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        recoverable: false,
      };
    }

    logger.info('WGCards: order placed, polling for cards', { orderId });

    // Poll getBuyCard until all cards are delivered or max attempts reached.
    for (let attempt = 1; attempt <= CARD_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(CARD_POLL_INTERVAL_MS);

      let cardData: WgcardsBuyCardData;
      try {
        cardData = await this.client.getBuyCard(orderId);
      } catch (err) {
        logger.warn('WGCards getBuyCard poll error', err instanceof Error ? err : new Error(String(err)), {
          orderId,
          attempt,
        });
        continue;
      }

      if (cardData.records.length > 0) {
        const keys = cardData.records.map((r) => r.card.trim()).filter(Boolean);
        logger.info('WGCards: cards received', { orderId, count: keys.length });
        return { success: true, orderId, keys };
      }

      logger.debug('WGCards: cards not yet delivered', { orderId, attempt });
    }

    // Cards not received within poll window — order placed but delivery pending.
    logger.warn('WGCards: card delivery timed out after polling', { orderId });
    return {
      success: false,
      orderId,
      error: `WGCards order ${orderId} placed but cards not delivered within poll window`,
      recoverable: true,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/** Shared construction result used by both the buyer provider and the marketplace adapter. */
export interface WgcardsClientBundle {
  readonly client: WgcardsHttpClient;
  readonly appId: string;
}

/**
 * Builds the AES crypto + token manager + HTTP client triple from secrets/profile.
 * Returns `null` (with a warn log) if any required credential is missing.
 *
 * Shared by `createWgcardsManualBuyer` (buyer flow) and the marketplace adapter
 * bootstrap (live-search flow) so the construction logic lives in one place.
 */
export function createWgcardsHttpClient(params: {
  readonly secrets: Record<string, string>;
  readonly profile: Record<string, unknown>;
  readonly initialTokenCache?: WgcardsCachedToken | null;
  readonly onTokenRefreshed?: (entry: WgcardsCachedToken) => void;
}): WgcardsClientBundle | null {
  const appId = params.secrets['WGCARDS_APP_ID'];
  const appKey = params.secrets['WGCARDS_APP_KEY'];
  const accountId = params.secrets['WGCARDS_ACCOUNT_ID'];

  if (!appId?.trim() || !appKey?.trim() || !accountId?.trim()) {
    logger.warn(
      'WGCards client unavailable — missing WGCARDS_APP_ID, WGCARDS_APP_KEY, or WGCARDS_ACCOUNT_ID',
    );
    return null;
  }

  let crypto: WgcardsAesCrypto;
  try {
    crypto = new WgcardsAesCrypto(appId.trim());
  } catch (err) {
    logger.warn(
      'WGCards client unavailable — AES key construction failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    return null;
  }

  const baseUrl =
    profileStr(params.profile, 'base_url') ??
    profileStr(params.profile, 'baseUrl') ??
    WGCARDS_DEFAULT_BASE_URL;

  const clientRef: { instance: WgcardsHttpClient | null } = { instance: null };

  const tokenManager = new WgcardsTokenManager({
    initialCache: params.initialTokenCache ?? null,
    onTokenRefreshed: params.onTokenRefreshed,
    fetchToken: async () => clientRef.instance!.getToken(appKey.trim()),
  });

  const httpClient = new WgcardsHttpClient(
    baseUrl,
    appId.trim(),
    accountId.trim(),
    crypto,
    tokenManager,
  );
  clientRef.instance = httpClient;

  return { client: httpClient, appId: appId.trim() };
}

export function createWgcardsManualBuyer(params: {
  readonly secrets: Record<string, string>;
  readonly profile: Record<string, unknown>;
  readonly initialTokenCache?: WgcardsCachedToken | null;
  readonly onTokenRefreshed?: (entry: WgcardsCachedToken) => void;
}): WgcardsManualBuyer | null {
  const bundle = createWgcardsHttpClient(params);
  if (!bundle) return null;
  return new WgcardsManualBuyer(bundle.client, bundle.appId);
}
