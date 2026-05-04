/**
 * Digiseller/Plati.market marketplace adapter for LootCodes Admin API.
 *
 * Capabilities:
 *   - ISellerListingAdapter
 *   - ISellerKeyUploadAdapter (POST /api/product/content/add/text)
 *   - ISellerStockSyncAdapter (status toggle based on remote stock count)
 *
 * Two delivery models:
 *   key_upload:      Keys uploaded via /api/product/content/add/text
 *   declared_stock:  Form delivery — Digiseller POSTs to our webhook on sale
 *
 * Auth: SHA256 signature-based token, appended as ?token=X query param.
 * Prices: Floats (e.g. 7.25) — converted to/from cents here.
 * Product IDs: Integers — stored as strings in seller_listings.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type {
  ISellerListingAdapter,
  ISellerKeyUploadAdapter,
  ISellerStockSyncAdapter,
  CreateListingParams,
  CreateListingResult,
  UpdateListingParams,
  UpdateListingResult,
  ListingStatusResult,
  UploadKeysResult,
  SyncStockLevelResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type {
  DigisellerCreateProductResponse,
  DigisellerEditProductResponse,
  DigisellerProductStatusResponse,
  DigisellerProductDataResponse,
  DigisellerAddTextContentResponse,
  DigisellerCodeCountResponse,
  DigisellerApiResponse,
} from './types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('digiseller-adapter');

function centsToDigiPrice(cents: number): number {
  return Math.round(cents) / 100;
}

export class DigisellerMarketplaceAdapter
  implements
    ISellerListingAdapter,
    ISellerKeyUploadAdapter,
    ISellerStockSyncAdapter
{
  private readonly defaultCurrency: string;

  constructor(
    private readonly httpClient: MarketplaceHttpClient,
    options?: { defaultCurrency?: string },
  ) {
    this.defaultCurrency = options?.defaultCurrency ?? 'USD';
  }

  // ─── ISellerListingAdapter ───────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const body = {
      content_type: 'Text',
      categories: [{ owner: 0, category_id: 0 }],
      name: [{ locale: 'en-US', value: `Product ${params.externalProductId}` }],
      price: {
        price: centsToDigiPrice(params.priceCents),
        currency: params.currency || this.defaultCurrency,
      },
      description: [{ locale: 'en-US', value: 'Digital product key' }],
      guarantee: { enabled: true, value: 24 },
      enabled: true,
    };

    const resp = await this.httpClient.post<DigisellerCreateProductResponse>(
      '/api/product/create/uniquefixed',
      body,
    );

    this.assertRetval(resp, 'createListing');
    const productId = resp.content.product_id;

    logger.info('Digiseller product created', {
      productId,
      price: centsToDigiPrice(params.priceCents),
      currency: params.currency,
    });

    return {
      externalListingId: String(productId),
      status: 'active',
    };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const productId = Number(params.externalListingId);
    const body: Record<string, unknown> = {};

    if (params.priceCents != null) {
      body.price = {
        price: centsToDigiPrice(params.priceCents),
        currency: this.defaultCurrency,
      };
    }

    const resp = await this.httpClient.post<DigisellerEditProductResponse>(
      `/api/product/edit/uniquefixed/${productId}`,
      body,
    );

    this.assertRetval(resp, 'updateListing');

    logger.info('Digiseller product updated', {
      productId,
      priceCents: params.priceCents,
    });

    return { success: true };
  }

  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    const productId = Number(externalListingId);

    const resp = await this.httpClient.post<DigisellerProductStatusResponse>(
      '/api/product/edit/V2/status',
      { new_status: 'disabled', products: [productId] },
    );

    this.assertRetval(resp, 'deactivateListing');

    logger.info('Digiseller product deactivated', { productId });
    return { success: true };
  }

  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    const productId = Number(externalListingId);

    const resp = await this.httpClient.get<DigisellerProductDataResponse>(
      `/api/products/${productId}/data`,
    );

    if (resp.retval !== 0 || !resp.product) {
      throw new Error(
        `Digiseller getListingStatus failed: retval=${resp.retval} ${resp.retdesc ?? ''}`,
      );
    }

    const p = resp.product;
    const priceCents = p.prices?.initial
      ? Math.round(p.prices.initial.price * 100)
      : Math.round(p.price * 100);

    return {
      status: p.is_available === 0 ? 'paused' : 'active',
      externalListingId: String(p.id),
      stock: p.num_in_stock ?? 0,
      priceCents,
    };
  }

  // ─── ISellerKeyUploadAdapter ─────────────────────────────────────────

  async uploadKeys(externalListingId: string, keys: string[]): Promise<UploadKeysResult> {
    const productId = Number(externalListingId);

    const body = {
      product_id: productId,
      content: keys.map((value, idx) => ({
        serial: String(idx + 1),
        value,
      })),
    };

    const resp = await this.httpClient.post<DigisellerAddTextContentResponse>(
      '/api/product/content/add/text',
      body,
    );

    if (resp.retval !== 0) {
      const errorMsg = resp.retdesc ?? 'Unknown error';
      logger.error('Digiseller key upload failed', new Error(errorMsg), {
        productId,
        keyCount: keys.length,
      });
      return {
        uploaded: 0,
        failed: keys.length,
        errors: [errorMsg],
      };
    }

    const accepted = resp.content?.added ?? keys.length;

    logger.info('Digiseller keys uploaded', {
      productId,
      accepted,
      total: keys.length,
    });

    return {
      uploaded: accepted,
      failed: keys.length - accepted,
    };
  }

  // ─── ISellerStockSyncAdapter ─────────────────────────────────────────

  async syncStockLevel(externalListingId: string, _availableQuantity: number): Promise<SyncStockLevelResult> {
    const productId = Number(externalListingId);

    const remoteStock = await this.getStockCount(productId);
    const desiredStatus = remoteStock === 0 ? 'disabled' : 'active';

    try {
      await this.setProductStatus(productId, desiredStatus);
    } catch (err) {
      logger.warn('Digiseller setProductStatus failed during sync', err, {
        productId,
        desiredStatus,
        remoteStock,
      });
    }

    logger.info('Digiseller stock synced', {
      productId,
      remoteStock,
    });

    return {
      success: true,
      syncedQuantity: remoteStock,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private async getStockCount(productId: number): Promise<number> {
    try {
      const resp = await this.httpClient.get<DigisellerCodeCountResponse>(
        `/api/products/content/code/count/${productId}`,
      );
      return resp.cnt_goods ?? 0;
    } catch (err) {
      logger.warn('Digiseller stock count query failed', err, { productId });
      return 0;
    }
  }

  private async setProductStatus(productId: number, status: 'active' | 'disabled'): Promise<void> {
    const resp = await this.httpClient.post<DigisellerProductStatusResponse>(
      '/api/product/edit/V2/status',
      { new_status: status, products: [productId] },
    );
    this.assertRetval(resp, `setProductStatus(${status})`);
  }

  private assertRetval(
    resp: DigisellerApiResponse,
    operation: string,
  ): void {
    if (resp.retval !== 0) {
      let detail = `retval=${resp.retval} ${resp.retdesc ?? ''}`;
      if (resp.errors?.length) {
        const errMsgs = resp.errors.map((e) => {
          const msg = Array.isArray(e.message)
            ? e.message.map((m) => `${m.locale}: ${m.value}`).join(', ')
            : e.message;
          return `[${e.code}] ${msg}`;
        });
        detail += ` | errors: ${errMsgs.join('; ')}`;
      }
      throw new Error(`Digiseller ${operation} failed: ${detail}`);
    }
  }
}
