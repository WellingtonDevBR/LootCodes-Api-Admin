/**
 * Kinguin marketplace adapter for LootCodes Admin API.
 *
 * Capabilities:
 *   - ISellerListingAdapter
 *   - ISellerDeclaredStockAdapter (declared stock + webhook-driven provisioning)
 *   - ISellerStockSyncAdapter
 *   - ISellerPricingAdapter (pricingModel = 'gross')
 *   - ISellerBatchPriceAdapter (sequential PATCH — no native batch endpoint)
 *   - ISellerCallbackSetupAdapter (Envoy webhook subscriptions)
 *
 * Auth: OAuth2 client_credentials for seller + webhook APIs.
 * Prices: EUR cents (integer) for seller API.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type {
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  ISellerStockSyncAdapter,
  ISellerPricingAdapter,
  ISellerBatchPriceAdapter,
  ISellerCallbackSetupAdapter,
  IProductSearchAdapter,
  ProductSearchResult,
  CreateListingParams,
  CreateListingResult,
  UpdateListingParams,
  UpdateListingResult,
  ListingStatusResult,
  DeclareStockResult,
  KeyProvisionParams,
  KeyProvisionResult,
  SyncStockLevelResult,
  PricingContext,
  SellerPayoutResult,
  BatchPriceUpdate,
  BatchPriceUpdateResult,
  RegisterCallbacksResult,
  RemoveCallbackResult,
  GetCallbacksResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type {
  KinguinOffer,
  KinguinCreateOfferRequest,
  KinguinUpdateOfferRequest,
  KinguinPriceAndCommission,
  KinguinSubscription,
  KinguinSubscriptionRequest,
  KinguinStockItem,
  KinguinBuyerSearchResponse,
} from './types.js';
import { KINGUIN_MAX_DECLARED_STOCK } from './types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('kinguin-adapter');

function capDeclaredStock(quantity: number): number {
  return Math.min(Math.max(0, quantity), KINGUIN_MAX_DECLARED_STOCK);
}

export class KinguinMarketplaceAdapter
  implements
    ISellerListingAdapter,
    ISellerDeclaredStockAdapter,
    ISellerStockSyncAdapter,
    ISellerPricingAdapter,
    ISellerBatchPriceAdapter,
    ISellerCallbackSetupAdapter,
    IProductSearchAdapter
{
  constructor(
    private readonly httpClient: MarketplaceHttpClient,
    private readonly webhookHttpClient?: MarketplaceHttpClient,
    private readonly buyerHttpClient?: MarketplaceHttpClient,
  ) {}

  // ─── ISellerListingAdapter ───────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const qty = capDeclaredStock(params.quantity ?? 0);

    const body: KinguinCreateOfferRequest = {
      productId: params.externalProductId,
      price: { amount: params.priceCents, currency: 'EUR' },
      status: 'ACTIVE',
      declaredStock: qty,
      declaredTextStock: qty,
    };

    const offer = await this.httpClient.post<KinguinOffer>(
      '/api/v1/offers',
      body,
    );

    logger.info('Kinguin offer created', {
      offerId: offer.id,
      productId: params.externalProductId,
    });

    return {
      externalListingId: offer.id,
      status: offer.status === 'ACTIVE' ? 'active' : 'paused',
    };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const body: KinguinUpdateOfferRequest = {};

    if (params.priceCents != null) {
      body.price = { amount: params.priceCents, currency: 'EUR' };
    }
    if (params.quantity != null) {
      const q = capDeclaredStock(params.quantity);
      body.declaredStock = q;
      body.declaredTextStock = q;
    }

    await this.httpClient.patch<KinguinOffer>(
      `/api/v1/offers/${encodeURIComponent(params.externalListingId)}`,
      body,
    );

    return { success: true };
  }

  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    const body: KinguinUpdateOfferRequest = { status: 'INACTIVE' };
    await this.httpClient.patch(
      `/api/v1/offers/${encodeURIComponent(externalListingId)}`,
      body,
    );

    logger.info('Kinguin offer deactivated', { offerId: externalListingId });
    return { success: true };
  }

  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    const offer = await this.httpClient.get<KinguinOffer>(
      `/api/v1/offers/${encodeURIComponent(externalListingId)}`,
    );

    return {
      status: offer.status === 'ACTIVE' ? 'active' : 'paused',
      externalListingId: offer.id,
      stock: offer.declaredStock,
      priceCents: offer.price?.amount,
    };
  }

  // ─── ISellerDeclaredStockAdapter ─────────────────────────────────────

  async declareStock(externalListingId: string, quantity: number): Promise<DeclareStockResult> {
    const capped = capDeclaredStock(quantity);

    await this.httpClient.patch<KinguinOffer>(
      `/api/v1/offers/${encodeURIComponent(externalListingId)}`,
      { declaredStock: capped, declaredTextStock: capped },
    );

    const live = await this.httpClient.get<KinguinOffer>(
      `/api/v1/offers/${encodeURIComponent(externalListingId)}`,
    );

    logger.info('Kinguin declared stock updated', {
      offerId: externalListingId,
      declaredQuantity: capped,
      confirmedQuantity: live.declaredStock,
    });

    return {
      success: true,
      declaredQuantity: capped,
    };
  }

  async provisionKeys(params: KeyProvisionParams): Promise<KeyProvisionResult> {
    let provisioned = 0;
    const errors: string[] = [];

    for (const key of params.keys) {
      try {
        await this.httpClient.post<KinguinStockItem>(
          `/api/v1/offers/${encodeURIComponent(params.externalReservationId)}/stock`,
          {
            body: key.value,
            mimeType: key.type ?? 'text/plain',
            reservationId: params.reservationId,
          },
        );
        provisioned++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
      }
    }

    return {
      success: provisioned === params.keys.length,
      provisioned,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  async cancelReservation(_reservationId: string, _reason: string): Promise<{ success: boolean }> {
    // Kinguin owns reservation lifecycle — we receive CANCELED webhooks.
    return { success: true };
  }

  // ─── ISellerStockSyncAdapter ─────────────────────────────────────────

  async syncStockLevel(externalListingId: string, availableQuantity: number): Promise<SyncStockLevelResult> {
    const before = await this.httpClient.get<KinguinOffer>(
      `/api/v1/offers/${encodeURIComponent(externalListingId)}`,
    );

    const capped = capDeclaredStock(availableQuantity);

    await this.httpClient.patch(
      `/api/v1/offers/${encodeURIComponent(externalListingId)}`,
      { declaredStock: capped, declaredTextStock: capped },
    );

    logger.info('Kinguin stock synced', {
      offerId: externalListingId,
      previousQuantity: before.declaredStock,
      newQuantity: capped,
    });

    return {
      success: true,
      syncedQuantity: capped,
    };
  }

  // ─── ISellerPricingAdapter ───────────────────────────────────────────

  async calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult> {
    const productId = ctx.externalProductId ?? 'generic';

    const result = await this.calculateCommission(productId, ctx.priceCents);
    if (!result) {
      throw new Error(`Kinguin commission API returned no data for product ${productId}`);
    }

    const grossPriceCents = result.price;
    const feeCents = grossPriceCents - result.priceIWTR;

    return {
      grossPriceCents,
      feeCents,
      netPayoutCents: result.priceIWTR,
    };
  }

  // ─── IProductSearchAdapter ────────────────────────────────────────────

  async searchProducts(query: string, limit = 10): Promise<ProductSearchResult[]> {
    if (!this.buyerHttpClient) {
      logger.info('Kinguin product search skipped — no buyer API credentials');
      return [];
    }

    if (query.length < 3) return [];

    try {
      const result = await this.buyerHttpClient.get<KinguinBuyerSearchResponse>(
        `/v1/products?name=${encodeURIComponent(query)}&limit=${limit}`,
      );

      return (result.results ?? []).map((p) => ({
        externalProductId: p.productId,
        productName: p.name,
        platform: p.platform ?? null,
        region: p.regionalLimitations ?? null,
        priceCents: Math.round(p.price * 100),
        currency: 'EUR',
        available: p.qty > 0 && !p.isPreorder,
      }));
    } catch (err) {
      logger.warn('Kinguin product search failed', err as Error);
      return [];
    }
  }

  private async calculateCommission(
    productId: string,
    priceIWTR: number,
  ): Promise<KinguinPriceAndCommission | null> {
    try {
      return await this.httpClient.get<KinguinPriceAndCommission>(
        `/api/v1/offers/calculations/priceAndCommission?kpcProductId=${encodeURIComponent(productId)}&priceIWTR=${priceIWTR}`,
      );
    } catch (err) {
      logger.error('Kinguin commission calculation failed', err, { productId, priceIWTR });
      return null;
    }
  }

  // ─── ISellerBatchPriceAdapter ────────────────────────────────────────

  async batchUpdatePrices(updates: BatchPriceUpdate[]): Promise<BatchPriceUpdateResult> {
    let updated = 0;
    let failed = 0;
    const errors: Array<{ externalListingId: string; error: string }> = [];

    for (const u of updates) {
      if (u.priceCents <= 0) {
        failed++;
        errors.push({
          externalListingId: u.externalListingId,
          error: 'priceCents must be positive',
        });
        continue;
      }

      try {
        await this.httpClient.patch<KinguinOffer>(
          `/api/v1/offers/${encodeURIComponent(u.externalListingId)}`,
          { price: { amount: u.priceCents, currency: 'EUR' as const } },
        );
        updated++;

        logger.info('Kinguin price updated', {
          offerId: u.externalListingId,
          priceCents: u.priceCents,
        });
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Kinguin batch price update failed for offer', err, {
          offerId: u.externalListingId,
        });
        errors.push({
          externalListingId: u.externalListingId,
          error: msg,
        });
      }
    }

    return {
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ─── ISellerCallbackSetupAdapter ─────────────────────────────────────

  async registerCallback(
    _type: string,
    url: string,
    authToken: string,
  ): Promise<RegisterCallbacksResult> {
    const client = this.webhookHttpClient ?? this.httpClient;

    const request: KinguinSubscriptionRequest = {
      endpoints: {
        reserve: url,
        give: url,
        cancel: url,
        delivered: url,
        outofstock: url,
        returned: url,
        reversed: url,
        refunded: url,
        processingpreorder: url,
        offerblocked: url,
        processingingame: url,
        chatmessage: url,
        orderprocessing: url,
      },
      headers: [{ name: 'X-Auth-Token', value: authToken }],
    };

    const sub = await client.post<KinguinSubscription>(
      '/api/v1/subscription',
      request,
    );

    return {
      registered: 1,
      callbackIds: [sub.id],
    };
  }

  async removeCallback(_callbackId: string): Promise<RemoveCallbackResult> {
    // Kinguin manages a single subscription per account; re-issuing
    // registerCallback overwrites the existing endpoints.
    return { removed: true };
  }

  async getCallbacks(): Promise<GetCallbacksResult> {
    const client = this.webhookHttpClient ?? this.httpClient;

    try {
      const sub = await client.get<KinguinSubscription>(
        '/api/v1/subscription',
      );

      const callbacks = Object.entries(sub.endpoints).map(([type, url]) => ({
        id: sub.id,
        type,
        url,
      }));

      return { callbacks };
    } catch {
      return { callbacks: [] };
    }
  }
}
