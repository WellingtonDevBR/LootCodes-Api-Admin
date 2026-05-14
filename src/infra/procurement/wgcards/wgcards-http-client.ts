/**
 * WgcardsHttpClient
 *
 * Low-level typed HTTP client for the WGCards v3 API.
 *
 * Every request follows the same envelope pattern:
 *   POST <endpoint>
 *   Headers: { appId, Authorization: "Bearer <token>" }
 *   Body: { appId, accountId, msg: AES_encrypt(JSON.stringify(payload)) }
 *
 * Every response is a raw Base64-encoded AES ciphertext that decrypts to:
 *   { appId, code: 200 | <error>, msg: "success" | <error>, data: <T> }
 *
 * Ref: WgCardsEnglishAPIDocV3_0_0
 */
import { createLogger } from '../../../shared/logger.js';
import type { WgcardsAesCrypto } from './wgcards-aes-crypto.js';
import type { WgcardsTokenManager } from './wgcards-token-manager.js';

const logger = createLogger('wgcards-http-client');

// ─── Response shapes ─────────────────────────────────────────────────────────

interface WgcardsEnvelope<T> {
  readonly appId: string;
  readonly code: number;
  readonly msg: string;
  readonly data: T;
}

export interface WgcardsWalletAccount {
  readonly walletId: string;
  readonly currency: string;
  /** Balance in native currency units (not cents). */
  readonly balance: number;
  readonly effective: boolean;
}

export interface WgcardsAccountData {
  readonly userId: string;
  readonly accounts: readonly WgcardsWalletAccount[];
}

export interface WgcardsStockEntry {
  readonly itemId: string;
  readonly skuId: string;
  /** Available quantity. -1 means unlimited stock. */
  readonly number: number;
}

export interface WgcardsPlaceOrderData {
  /** Internal order code — nested envelope: { code, data: orderId, message } */
  readonly code: number;
  readonly data: string;
  readonly message: string;
}

export interface WgcardsCardRecord {
  readonly skuId: string;
  /** The actual redemption code. May include tab-separated pin in same field. */
  readonly card: string;
  readonly pinCode: string;
  readonly snCode: string;
}

export interface WgcardsBuyCardData {
  readonly current: number;
  readonly pages: number;
  readonly size: number;
  readonly total: number;
  readonly records: readonly WgcardsCardRecord[];
}

export interface WgcardsPlaceOrderItem {
  readonly skuId: string;
  readonly buyNum: number;
  /** Required for custom face-value SKUs. */
  readonly faceValue?: number;
}

export interface WgcardsPlaceOrderRequest {
  readonly serviceOrder: string;
  readonly currency: string;
  readonly items: readonly WgcardsPlaceOrderItem[];
}

export interface WgcardsSkuInfo {
  readonly skuId: string;
  readonly skuName: string;
  /** Purchase price in `skuPriceCurrency`. 0 for custom face-value SKUs. */
  readonly skuPrice: number;
  readonly skuPriceCurrency: string;
  readonly maxFaceValue: number;
  readonly minFaceValue: number;
  readonly maxPrice: number;
  readonly minPrice: number;
  /** Available stock. -1 = unlimited. */
  readonly stock: number;
}

export interface WgcardsItemRecord {
  readonly itemId: string;
  readonly itemName: string;
  readonly itemTitle: string;
  readonly itemBrandName: string;
  /** Face-value currency (e.g. "JPY" for a Nintendo JP card). */
  readonly currencyCode: string;
  readonly spuImage: string | null;
  /** 1=game 2=giftcard 3=software 4=microsoft */
  readonly spuType: number;
  readonly skuInfos: readonly WgcardsSkuInfo[];
}

export interface WgcardsItemPage {
  readonly current: number;
  readonly pages: number;
  readonly size: number;
  readonly total: number;
  readonly records: readonly WgcardsItemRecord[];
}

export interface WgcardsGetItemParams {
  readonly appId: string;
  readonly itemName?: string;
  readonly itemId?: string;
  readonly currencyCode?: string;
  readonly current?: number;
  readonly size?: number;
}

/**
 * SKU shape returned by `/api/getAllItem`.
 * Unlike `WgcardsSkuInfo` (from getItemAndStock), this has NO price and NO stock —
 * only face-value ranges and the purchase-currency code.
 */
export interface WgcardsAllItemSku {
  readonly skuId: string;
  readonly skuName: string;
  /** Currency the buyer pays in (purchase currency). */
  readonly skuPriceCurrency: string;
  readonly maxFaceValue: number;
  readonly minFaceValue: number;
}

export interface WgcardsAllItemRecord {
  readonly itemId: string;
  readonly itemName: string;
  readonly itemBrandName: string;
  /** Face-value / transaction currency — used to infer region. */
  readonly currencyCode: string;
  /** 1=game 2=giftcard 3=software 4=microsoft */
  readonly spuType: number;
  /**
   * PDF docs say `skuList`; the live API returns `skuInfos` (same as getItemAndStock).
   * Both fields are typed as optional — the mapper resolves whichever is present.
   */
  readonly skuList?: readonly WgcardsAllItemSku[];
  readonly skuInfos?: readonly WgcardsSkuInfo[];
}

export interface WgcardsGetAllItemParams {
  readonly appId: string;
  readonly itemName?: string;
  readonly itemId?: string;
  readonly currencyCode?: string;
  readonly language?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class WgcardsHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly appId: string,
    private readonly accountId: string,
    private readonly crypto: WgcardsAesCrypto,
    private readonly tokenManager: WgcardsTokenManager,
  ) {}

  // ─── Auth (used internally by token manager) ────────────────────────────

  /**
   * Calls POST /api/getToken — used as the `fetchToken` callback in
   * `WgcardsTokenManager`. Does NOT require an existing token.
   *
   * The API accepts the outer envelope but requires NO Authorization header
   * on this specific endpoint.
   */
  async getToken(appKey: string): Promise<string> {
    const payload = { appId: this.appId, appKey };
    const msg = this.crypto.encrypt(JSON.stringify(payload));
    const body = { appId: this.appId, accountId: this.accountId, msg };

    const raw = await this.rawPost('/api/getToken', body, { requiresToken: false });
    const envelope = this.crypto.decryptJson<WgcardsEnvelope<string>>(raw);
    assertOk(envelope, '/api/getToken');
    return envelope.data;
  }

  // ─── Account ─────────────────────────────────────────────────────────────

  async getAccount(): Promise<WgcardsAccountData> {
    const payload = { userId: this.appId };
    const envelope = await this.post<WgcardsAccountData>('/api/getAccount', payload);
    return envelope;
  }

  // ─── Stock ───────────────────────────────────────────────────────────────

  async getStock(skuIds: readonly string[]): Promise<readonly WgcardsStockEntry[]> {
    const payload = { skuIds };
    return this.post<readonly WgcardsStockEntry[]>('/api/getStock', payload);
  }

  // ─── Product + Stock search ──────────────────────────────────────────────

  /**
   * `/api/getAllItem` — fetch the complete WGCards catalog in one call.
   * Rate limit: 2 per hour. Use for catalog ingestion (background sync).
   * Returns ALL items without pagination; does NOT include prices or stock.
   * Optionally filter by `itemName` or `itemId` for targeted refreshes.
   */
  async getAllItem(params: WgcardsGetAllItemParams): Promise<readonly WgcardsAllItemRecord[]> {
    const payload = {
      appId: params.appId,
      currencyCode: params.currencyCode ?? '',
      language: params.language ?? 'en',
      itemId: params.itemId ?? '',
      itemName: params.itemName ?? '',
    };
    return this.post<readonly WgcardsAllItemRecord[]>('/api/getAllItem', payload);
  }

  /**
   * `/api/getItemAndStock` — paginated product search.
   * Pass `itemName` for text search, `itemId` to filter by known ID.
   * Each item in `records` contains `skuInfos` with live `stock` counts.
   * Rate limit: 5 per 60 seconds.
   */
  async getItemAndStock(params: WgcardsGetItemParams): Promise<WgcardsItemPage> {
    const payload = {
      appId: params.appId,
      currencyCode: params.currencyCode ?? 'USD',
      current: params.current ?? 1,
      size: params.size ?? 15,
      itemId: params.itemId ?? '',
      itemName: params.itemName ?? '',
    };
    return this.post<WgcardsItemPage>('/api/getItemAndStock', payload);
  }

  // ─── Order placement ─────────────────────────────────────────────────────

  /**
   * Places an order and returns the WGCards `orderId`.
   * `serviceOrder` is the caller-provided idempotency key (must be unique).
   */
  async placeOrder(req: WgcardsPlaceOrderRequest): Promise<string> {
    const payload = {
      userId: this.appId,
      accountId: this.accountId,
      currency: req.currency,
      serviceOrder: req.serviceOrder,
      detailVos: req.items.map((item) => ({
        skuId: item.skuId,
        buyNum: item.buyNum,
        ...(item.faceValue !== undefined ? { faceValue: item.faceValue } : {}),
      })),
    };

    const data = await this.post<WgcardsPlaceOrderData>('/api/placeOrder', payload);

    if (data.code !== 200 || !data.data) {
      throw new Error(`WGCards placeOrder inner error: code=${data.code} message=${data.message}`);
    }
    return data.data;
  }

  // ─── Card retrieval ──────────────────────────────────────────────────────

  /**
   * Retrieves the card codes for a completed order.
   * Polls should call this after `placeOrder` succeeds (the API may return
   * an empty records list if fulfillment is still in progress).
   */
  async getBuyCard(
    orderId: string,
    page = 1,
    size = 200,
  ): Promise<WgcardsBuyCardData> {
    const payload = {
      userId: this.appId,
      orderId,
      current: page,
      size,
    };
    return this.post<WgcardsBuyCardData>('/api/getBuyCard', payload);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const msg = this.crypto.encrypt(JSON.stringify(payload));
    const body = { appId: this.appId, accountId: this.accountId, msg };
    const raw = await this.rawPost(path, body, { requiresToken: true });
    const envelope = this.crypto.decryptJson<WgcardsEnvelope<T>>(raw);
    assertOk(envelope, path);
    return envelope.data;
  }

  private async rawPost(
    path: string,
    body: Record<string, unknown>,
    opts: { requiresToken: boolean },
  ): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: '*/*',
      appId: this.appId,
    };

    if (opts.requiresToken) {
      const token = await this.tokenManager.getToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    logger.debug('WGCards HTTP request', { path });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `WGCards HTTP ${response.status} at ${path}: ${text.slice(0, 300)}`,
      );
    }

    // The response body is the raw encrypted string (not wrapped in JSON on the outer level)
    const text = await response.text();
    // Some endpoints return unencrypted JSON on error. If it parses as a JSON
    // object with a numeric `code` field, surface it directly — do NOT try to
    // AES-decrypt it (decryption on plain JSON produces garbage).
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      let parsed: Record<string, unknown> | undefined;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        // Not valid JSON — fall through to treat as raw ciphertext
      }
      if (parsed !== undefined && typeof parsed['code'] === 'number') {
        const code = parsed['code'] as number;
        if (code !== 200) {
          const msg =
            typeof parsed['msg'] === 'string' ? parsed['msg'] : '(no message)';
          throw new Error(`WGCards API error at ${path}: code=${code} msg=${msg}`);
        }
        // code===200 unencrypted — unusual but fall through to decrypt (shouldn't happen)
      }
    }

    return trimmed;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertOk(envelope: WgcardsEnvelope<unknown>, path: string): void {
  if (envelope.code !== 200) {
    const msg = envelope.msg ?? '(no message)';
    throw new Error(
      `WGCards API error at ${path}: code=${envelope.code} msg=${msg}`,
    );
  }
}
