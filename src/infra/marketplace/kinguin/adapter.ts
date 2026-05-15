/**
 * Kinguin marketplace adapter for LootCodes Admin API.
 *
 * Capabilities:
 *   - ISellerListingAdapter
 *   - ISellerDeclaredStockAdapter (declared stock + webhook-driven provisioning)
 *   - ISellerStockSyncAdapter
 *   - ISellerPricingAdapter (pricingModel = 'gross')
 *   - ISellerCompetitionAdapter (`/v2/products/{id}` buyer-ESA path; falls back to
 *     seller `/api/v1/offers` lookup when no buyer ESA key is configured)
 *   - ISellerBatchPriceAdapter (sequential PATCH — no native batch endpoint)
 *   - ISellerCallbackSetupAdapter (Envoy webhook subscriptions)
 *
 * Auth: OAuth2 client_credentials for seller + webhook APIs.
 *       X-Api-Key (buyer ESA) for the buyer-side product/offer queries used by
 *       `searchProducts` and `getCompetitorPrices`.
 * Prices: EUR cents (integer) for seller API; EUR floats for buyer ESA.
 *
 * Capability parity with the storefront Edge Function
 * `supabase/functions/provider-procurement/providers/kinguin/adapter.ts`:
 * the dual buyer/seller competitor lookup is a 1:1 port so the cron and the
 * storefront see identical competitor snapshots per product.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type {
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  ISellerStockSyncAdapter,
  ISellerPricingAdapter,
  ISellerCompetitionAdapter,
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
  CompetitorPrice,
  BatchPriceUpdate,
  BatchPriceUpdateResult,
  RegisterCallbacksResult,
  RemoveCallbackResult,
  GetCallbacksResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type {
  KinguinOffer,
  KinguinOfferPage,
  KinguinCreateOfferRequest,
  KinguinUpdateOfferRequest,
  KinguinPriceAndCommission,
  KinguinSubscription,
  KinguinSubscriptionRequest,
  KinguinStockItem,
  KinguinBuyerProduct,
  KinguinBuyerSearchResponse,
} from './types.js';
import { capKinguinDeclaredStock } from '../../../core/shared/kinguin.constants.js';
import { createLogger } from '../../../shared/logger.js';
import { floatToCents } from '../../../shared/pricing.js';

const logger = createLogger('kinguin-adapter');

export class KinguinMarketplaceAdapter
  implements
    ISellerListingAdapter,
    ISellerDeclaredStockAdapter,
    ISellerStockSyncAdapter,
    ISellerPricingAdapter,
    ISellerCompetitionAdapter,
    ISellerBatchPriceAdapter,
    ISellerCallbackSetupAdapter,
    IProductSearchAdapter
{
  constructor(
    private readonly httpClient: MarketplaceHttpClient,
    private readonly webhookHttpClient?: MarketplaceHttpClient,
    private readonly buyerHttpClient?: MarketplaceHttpClient,
  ) {}

  /** Live marketplace search calls the buyer HTTP API; seller OAuth alone is not enough. */
  isBuyerProductSearchConfigured(): boolean {
    return this.buyerHttpClient !== undefined;
  }

  // ─── ISellerListingAdapter ───────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const qty = capKinguinDeclaredStock(params.quantity ?? 0);

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
      const q = capKinguinDeclaredStock(params.quantity);
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
    const capped = capKinguinDeclaredStock(quantity);

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

    const capped = capKinguinDeclaredStock(availableQuantity);

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

  // ─── ISellerCompetitionAdapter ───────────────────────────────────────

  /**
   * Returns competitor offers for an external product id.
   *
   * Two paths:
   *   1. Buyer ESA (`GET /v2/products/{id}`) — preferred, returns ALL merchants'
   *      live offers including ours. Each row's `merchantName` is the actual
   *      Kinguin seller display name, and we tag our row with `isOwnOffer: true`
   *      by cross-referencing the seller-side Sales Manager offer id.
   *   2. Seller API (`GET /api/v1/offers?filter.productId=...`) — fallback when
   *      no buyer ESA key is configured. Kinguin does NOT expose other sellers'
   *      offers via the seller API, so every row is our own. Auto-pricing will
   *      correctly exclude `isOwnOffer: true` rows from "lowest competitor"
   *      computations and fall back to cost-basis / fixed pricing.
   */
  async getCompetitorPrices(externalProductId: string): Promise<CompetitorPrice[]> {
    if (this.buyerHttpClient) {
      try {
        return await this.getCompetitorPricesViaBuyerApi(externalProductId);
      } catch (err) {
        logger.warn('Buyer API competitor lookup failed — falling back to seller API', err as Error, {
          externalProductId,
        });
      }
    }

    return this.getCompetitorPricesViaSellerApi(externalProductId);
  }

  private async getCompetitorPricesViaBuyerApi(
    externalProductId: string,
  ): Promise<CompetitorPrice[]> {
    if (!this.buyerHttpClient) {
      return [];
    }

    const product = await this.buyerHttpClient.get<KinguinBuyerProduct>(
      `/v2/products/${encodeURIComponent(externalProductId)}`,
    );

    const buyerOffers = product.offers ?? [];

    // Identify our own offer id (best-effort) so callers can exclude self
    // from "lowest competitor" computations.
    let ownOfferId: string | null = null;
    try {
      const ownOffers = await this.httpClient.get<KinguinOfferPage>(
        `/api/v1/offers?filter.productId=${encodeURIComponent(externalProductId)}&size=1`,
      );
      if (ownOffers.content?.length) {
        ownOfferId = ownOffers.content[0].id;
      }
    } catch {
      // Own-offer lookup is best-effort; auto-pricing tolerates `isOwnOffer: null`.
    }

    // No per-merchant breakdown — fall back to the aggregate `product.price`
    // so callers at least learn the lowest competitor price for that product.
    if (buyerOffers.length === 0) {
      if (product.price > 0) {
        return [{
          merchantName: 'unknown',
          priceCents: floatToCents(product.price),
          currency: 'EUR',
          inStock: (product.qty ?? 0) > 0,
          isOwnOffer: null,
        }];
      }
      return [];
    }

    const prices = buyerOffers
      .filter((o) => o.qty > 0)
      .map((o) => ({
        merchantName: o.merchantName || 'unknown',
        priceCents: floatToCents(o.price),
        currency: 'EUR',
        inStock: o.qty > 0,
        isOwnOffer: ownOfferId ? o.offerId === ownOfferId : null,
        externalListingId: o.offerId || undefined,
      } satisfies CompetitorPrice));

    return prices;
  }

  /**
   * Fallback when no buyer ESA key is available. The Sales Manager
   * `/api/v1/offers?filter.productId=...` endpoint returns ONLY our own offers
   * for that product — Kinguin does not expose other sellers' offers via
   * the seller API. Treat every row as `isOwnOffer: true` so the auto-pricing
   * intelligence layer excludes them from competitor calculations.
   */
  private async getCompetitorPricesViaSellerApi(
    externalProductId: string,
  ): Promise<CompetitorPrice[]> {
    try {
      const page = await this.httpClient.get<KinguinOfferPage>(
        `/api/v1/offers?filter.productId=${encodeURIComponent(externalProductId)}&size=20`,
      );

      const offers = page.content ?? [];
      const prices = offers
        .filter((o) => o.status === 'ACTIVE' && !o.block)
        .map((o) => ({
          merchantName: 'self',
          priceCents: o.price.amount,
          currency: 'EUR',
          inStock: o.buyableStock > 0 || o.declaredStock > 0,
          isOwnOffer: true,
          externalListingId: o.id,
        } satisfies CompetitorPrice));

      if (prices.length === 0) {
        logger.warn('Kinguin seller-API competitor lookup returned no own offers — buyer API key recommended for competitor visibility', {
          externalProductId,
        });
      } else {
        logger.info('Kinguin competitor lookup via seller API (own offers only — buyer API key required for full competitor visibility)', {
          externalProductId,
          ownOfferCount: prices.length,
        });
      }

      return prices;
    } catch (err) {
      logger.error('Kinguin getCompetitorPrices (seller API) failed', err as Error, { externalProductId });
      return [];
    }
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
        priceCents: floatToCents(p.price),
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
