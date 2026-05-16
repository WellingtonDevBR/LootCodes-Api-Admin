/**
 * Gamivo marketplace adapter for LootCodes Admin API.
 *
 * Capabilities:
 *   - ISellerListingAdapter
 *   - ISellerDeclaredStockAdapter (Import API — keys delivered on-demand)
 *   - ISellerPricingAdapter (pricingModel = 'seller_price')
 *   - ISellerCompetitionAdapter (`/products/{id}/offers`)
 *   - ISellerBatchPriceAdapter (sequential PUTs — Gamivo has no bulk price API)
 *   - ISellerCallbackSetupAdapter
 *   - IProductSearchAdapter
 *
 * NOTE: SellerKeyUploadProvider is intentionally NOT implemented.
 * Gamivo uses the Import API (declared_stock + on-demand callbacks).
 * Pre-uploading keys causes orphan provisions and double-delivery.
 *
 * Prices are floats (EUR) in Gamivo's API — converted to/from cents here.
 * Gamivo's PUT accepts a net `seller_price`, so `pricingModel = 'seller_price'`
 * tells the auto-pricing orchestrator to feed it net cents directly (same
 * contract as Eneba's `priceIWantToGet`).
 *
 * Capability parity with the storefront Edge Function `provider-procurement`:
 * `getCompetitorPrices`, `batchUpdatePrices`, own-offer caching, and the
 * tier-aware `patchOffer` are 1:1 ports from
 * `supabase/functions/provider-procurement/providers/gamivo/adapter.ts` so the
 * two runtimes stay in lockstep.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type {
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
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
  PricingContext,
  SellerPayoutResult,
  RegisterCallbacksResult,
  RemoveCallbackResult,
  GetCallbacksResult,
  CompetitorPrice,
  BatchPriceUpdate,
  BatchPriceUpdateResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type {
  GamivoOfferDetail,
  GamivoCalculatePriceResponse,
  GamivoCreateOfferRequest,
  GamivoEditOfferRequest,
  GamivoSearchProduct,
} from './types.js';
import {
  GAMIVO_OFFER_STATUS_ACTIVE,
  GAMIVO_OFFER_STATUS_INACTIVE,
} from './types.js';
import {
  buildCalculateSellerPriceQuery,
  buildCalculateSellerPriceQueryFromUniformCustomerGross,
  isGamivoPricingSafeOverrides,
  mapCalculatorResponseToPutSellerFields,
  sellerFieldsFromOfferGet,
} from './gamivo-put-pricing.js';
import { createLogger } from '../../../shared/logger.js';
import { floatToCents as rawFloatToCents } from '../../../shared/pricing.js';

const logger = createLogger('gamivo-adapter');

const OWN_OFFERS_CACHE_TTL_MS = 30_000;

function floatToCents(value: number | undefined | null): number {
  if (value == null || isNaN(value)) return 0;
  return rawFloatToCents(value);
}

export class GamivoMarketplaceAdapter
  implements
    ISellerListingAdapter,
    ISellerDeclaredStockAdapter,
    ISellerPricingAdapter,
    ISellerCompetitionAdapter,
    ISellerBatchPriceAdapter,
    ISellerCallbackSetupAdapter,
    IProductSearchAdapter
{
  /**
   * Marks Gamivo as a NET-pricing marketplace (matches Eneba). The auto-pricing
   * orchestrator skips `calculateNetPayout` and passes `listing.price_cents` as
   * the seller net directly to PUT.
   */
  readonly pricingModel = 'seller_price' as const;

  private ownOffersCache: { offers: GamivoOfferDetail[]; expiresAt: number } | null = null;

  constructor(private readonly httpClient: MarketplaceHttpClient) {}

  // ─── ISellerListingAdapter ───────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const sellerPrice = params.priceCents / 100;

    const body: GamivoCreateOfferRequest = {
      product: Number(params.externalProductId),
      seller_price: sellerPrice,
      tier_one_seller_price: sellerPrice,
      tier_two_seller_price: sellerPrice,
      wholesale_mode: 1,
      status: GAMIVO_OFFER_STATUS_ACTIVE,
      is_preorder: false,
      ...(params.quantity != null && params.quantity > 0 ? { keys: params.quantity } : {}),
    };

    const offerId = await this.httpClient.post<number>(
      '/api/public/v1/offers',
      body,
    );

    const resolvedId = typeof offerId === 'number'
      ? offerId
      : (offerId as unknown as Record<string, unknown>).id ?? offerId;

    logger.info('Gamivo offer created', {
      offerId: String(resolvedId),
      productId: params.externalProductId,
    });

    this.invalidateOwnOffersCache();

    return {
      externalListingId: String(resolvedId),
      status: 'active',
    };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const overrides: Partial<GamivoEditOfferRequest> = {};

    if (params.priceCents != null) {
      overrides.seller_price = params.priceCents / 100;
    }
    if (params.quantity != null) {
      overrides.keys = params.quantity;
    }

    await this.patchOffer(params.externalListingId, overrides);

    return { success: true };
  }

  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    await this.httpClient.put(
      `/api/public/v1/offers/${externalListingId}/change-status`,
      { status: GAMIVO_OFFER_STATUS_INACTIVE },
    );

    this.invalidateOwnOffersCache();

    logger.info('Gamivo offer deactivated', { offerId: externalListingId });
    return { success: true };
  }

  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    const offer = await this.httpClient.get<GamivoOfferDetail>(
      `/api/public/v1/offers/${externalListingId}`,
    );

    return {
      status: offer.status === GAMIVO_OFFER_STATUS_ACTIVE ? 'active' : 'paused',
      externalListingId: String(offer.id),
      stock: offer.stock_available,
      priceCents: floatToCents(offer.seller_price),
    };
  }

  // ─── ISellerDeclaredStockAdapter ─────────────────────────────────────

  async declareStock(externalListingId: string, quantity: number): Promise<DeclareStockResult> {
    const targetStatus = quantity > 0
      ? GAMIVO_OFFER_STATUS_ACTIVE
      : GAMIVO_OFFER_STATUS_INACTIVE;

    await this.patchOffer(externalListingId, {
      status: targetStatus,
      keys: quantity,
    });

    logger.info('Gamivo declared stock updated', {
      offerId: externalListingId,
      declaredQuantity: quantity,
    });

    return {
      success: true,
      declaredQuantity: quantity,
    };
  }

  async provisionKeys(params: KeyProvisionParams): Promise<KeyProvisionResult> {
    // No-op: Gamivo Import API delivers keys via inbound HTTP callback.
    // The adapter does not push keys outbound.
    logger.info('provisionKeys no-op for Gamivo (keys delivered via Import API callback)', {
      reservationId: params.reservationId,
      keyCount: params.keys.length,
    });

    return { success: true, provisioned: params.keys.length };
  }

  async cancelReservation(_reservationId: string, reason: string): Promise<{ success: boolean }> {
    // No-op: Gamivo Import API cancellations arrive via inbound callback.
    logger.info('cancelReservation no-op for Gamivo (marketplace-initiated)', {
      reason,
    });

    return { success: true };
  }

  // ─── ISellerPricingAdapter ───────────────────────────────────────────

  async calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult> {
    if (!ctx.externalListingId) {
      throw new Error('Gamivo calculateNetPayout requires externalListingId (offer ID)');
    }

    // priceCents here represents the seller net the caller wants to charge —
    // pricingModel='seller_price'. Gamivo's calculator returns customer_price
    // (gross) and seller_price (net) so we can derive the fee.
    const sellerPrice = ctx.priceCents / 100;

    const resp = await this.httpClient.get<GamivoCalculatePriceResponse>(
      `/api/public/v1/offers/calculate-customer-price/${ctx.externalListingId}?seller_price=${sellerPrice.toFixed(2)}`,
    );

    const grossCents = floatToCents(resp.customer_price);
    const netCents = floatToCents(resp.seller_price);

    return {
      grossPriceCents: grossCents,
      feeCents: grossCents - netCents,
      netPayoutCents: netCents,
    };
  }

  /**
   * GROSS (customer_price) → NET (seller_price) via Gamivo's
   * `/api/public/v1/offers/calculate-seller-price/{id}?price=X`.
   *
   * The auto-pricing engine works competitor positions in GROSS space (the
   * customer_price every Gamivo seller publishes), and we want to undercut by
   * the configured strategy in that same space. When we land on a target
   * customer price (e.g. 1 cent below P1), we PUT a `seller_price` to the
   * marketplace — but the relationship is not a flat percentage (Gamivo
   * applies tiered commission + fixed fee), so an observed-ratio approximation
   * drifts. This calls Gamivo's calculator directly so the seller_price we
   * push corresponds exactly to the customer_price we intended.
   */
  async calculateSellerPriceFromCustomerPrice(
    externalListingId: string,
    grossCustomerCents: number,
  ): Promise<number> {
    if (!externalListingId) {
      throw new Error('Gamivo calculateSellerPriceFromCustomerPrice requires externalListingId');
    }
    if (!Number.isFinite(grossCustomerCents) || grossCustomerCents <= 0) {
      throw new Error(
        `Gamivo calculateSellerPriceFromCustomerPrice requires positive grossCustomerCents (got ${grossCustomerCents})`,
      );
    }
    const grossEur = grossCustomerCents / 100;
    const qs = new URLSearchParams();
    qs.set('price', grossEur.toFixed(2));
    qs.set('tier_one_price', grossEur.toFixed(2));
    qs.set('tier_two_price', grossEur.toFixed(2));
    const resp = await this.httpClient.get<GamivoCalculatePriceResponse>(
      `/api/public/v1/offers/calculate-seller-price/${encodeURIComponent(externalListingId)}?${qs.toString()}`,
    );
    const netCents = floatToCents(resp.seller_price);
    if (!Number.isFinite(netCents) || netCents <= 0) {
      throw new Error(
        `Gamivo calculate-seller-price returned non-positive seller_price for offer ${externalListingId}`,
      );
    }
    return netCents;
  }

  // ─── ISellerCompetitionAdapter ───────────────────────────────────────

  /**
   * Fetch the live competitor ladder for a Gamivo product.
   *
   * Gamivo's `GET /api/public/v1/products/{productId}/offers` returns every
   * seller's **active** offer for the product (inactive offers are filtered
   * out server-side). Combined with our own offers list we can flag
   * `isOwnOffer` correctly. The price exposed to consumers is `retail_price`
   * (customer-facing gross EUR).
   *
   * Hidden own-offer synthesis (LOOTCODES-API-31 fix):
   * When our own offer is `INACTIVE` (typical: declared_stock=0 → we pushed
   * `status=INACTIVE`), Gamivo excludes it from `/products/{id}/offers`. We
   * fetched it directly via `findOwnOfferForProduct`, so we synthesize a
   * `CompetitorPrice` row for it. This keeps `resolveNetGrossRatio` working
   * without an extra calculator round-trip, and gives smart-pricing visibility
   * into our last-published retail price even while the listing is paused.
   */
  async getCompetitorPrices(externalProductId: string): Promise<CompetitorPrice[]> {
    const [offers, ownedOffer] = await Promise.all([
      this.fetchProductOffers(externalProductId),
      this.findOwnOfferForProduct(externalProductId),
    ]);

    const ownId = ownedOffer?.id != null ? String(ownedOffer.id) : null;
    const sorted = [...offers].sort((a, b) => a.retail_price - b.retail_price);

    const result: CompetitorPrice[] = sorted.map((offer) => ({
      merchantName: offer.seller_name,
      priceCents: floatToCents(offer.retail_price),
      currency: 'EUR',
      inStock: offer.stock_available > 0,
      isOwnOffer: ownId != null ? String(offer.id) === ownId : null,
      externalListingId: String(offer.id),
    }));

    if (
      ownedOffer
      && ownedOffer.retail_price > 0
      && !result.some((r) => r.isOwnOffer === true)
    ) {
      result.push({
        merchantName: ownedOffer.seller_name,
        priceCents: floatToCents(ownedOffer.retail_price),
        currency: 'EUR',
        inStock: ownedOffer.stock_available > 0,
        isOwnOffer: true,
        externalListingId: String(ownedOffer.id),
      });
    }

    return result;
  }

  // ─── ISellerBatchPriceAdapter ────────────────────────────────────────

  /**
   * Sequential PUTs — Gamivo has no bulk price API.
   *
   * Each PUT goes through {@link updateListing} → {@link patchOffer}, which
   * also re-aligns the wholesale tier seller nets via Gamivo's calculator so
   * the tier prices keep tracking retail. Without that the auto-pricing cron
   * silently drifts wholesale tiers on every change.
   *
   * The `preventPaidPriceChange` flag on `BatchPriceUpdate` is unused for
   * Gamivo (no per-update fee), and Gamivo's `seller_config.price_change_*`
   * quotas are also no-op; the auto-pricing orchestrator does not pass it
   * here for Gamivo.
   */
  async batchUpdatePrices(updates: BatchPriceUpdate[]): Promise<BatchPriceUpdateResult> {
    let updated = 0;
    let failed = 0;
    const errors: Array<{ externalListingId: string; error: string }> = [];

    for (const u of updates) {
      if (u.priceCents == null || u.priceCents <= 0) {
        failed++;
        errors.push({
          externalListingId: u.externalListingId,
          error: 'priceCents required and must be positive',
        });
        continue;
      }

      try {
        await this.updateListing({
          externalListingId: u.externalListingId,
          priceCents: u.priceCents,
          ...(u.currency ? { currency: u.currency } : {}),
        });
        updated++;
        logger.info('Gamivo price updated', {
          offerId: u.externalListingId,
          priceCents: u.priceCents,
        });
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Gamivo batch price update failed for offer', err as Error, {
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
  // Gamivo Import API callbacks are configured via Gamivo support, not via API.
  // These are best-effort stubs that track state locally.

  async registerCallback(
    _type: string,
    url: string,
    _authToken: string,
  ): Promise<RegisterCallbacksResult> {
    logger.info('Gamivo registerCallback — callbacks are configured via Gamivo support', { url });

    return {
      registered: 1,
      callbackIds: ['gamivo-import-api'],
    };
  }

  async removeCallback(callbackId: string): Promise<RemoveCallbackResult> {
    logger.info('Gamivo removeCallback — callbacks managed by Gamivo support', { callbackId });
    return { removed: true };
  }

  async getCallbacks(): Promise<GetCallbacksResult> {
    return {
      callbacks: [{
        id: 'gamivo-import-api',
        type: 'import_api',
        url: 'configured-via-gamivo-support',
      }],
    };
  }

  // ─── IProductSearchAdapter ────────────────────────────────────────────

  async searchProducts(query: string, limit = 10): Promise<ProductSearchResult[]> {
    try {
      const filters = JSON.stringify({ name: query });
      const products = await this.httpClient.get<GamivoSearchProduct[]>(
        `/api/public/v1/products/list-by-criteria/0/${limit}?filters=${encodeURIComponent(filters)}`,
      );

      return (products ?? []).map((p) => ({
        externalProductId: String(p.id),
        productName: p.name,
        platform: p.platform ?? null,
        region: p.region ?? null,
        priceCents: floatToCents(p.lowest_price),
        currency: 'EUR',
        available: true,
      }));
    } catch (err) {
      logger.warn('Gamivo product search failed', err as Error);
      return [];
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Recompute seller nets from customer-facing prices (retail + wholesale tiers)
   * via Gamivo's calculate-seller-price endpoint. On failure, returns null so
   * patchOffer falls back to the GET snapshot's seller-net fields.
   */
  private async fetchPutPricingFromCalculator(
    offerId: string,
    preUpdate: GamivoOfferDetail,
  ): Promise<Pick<GamivoEditOfferRequest, 'seller_price' | 'tier_one_seller_price' | 'tier_two_seller_price'> | null> {
    if (!(preUpdate.retail_price > 0)) {
      logger.warn('Gamivo calculate-seller-price skipped — retail_price not positive', { offerId });
      return null;
    }
    const qs = buildCalculateSellerPriceQuery(preUpdate);
    try {
      const resp = await this.httpClient.get<GamivoCalculatePriceResponse>(
        `/api/public/v1/offers/calculate-seller-price/${encodeURIComponent(offerId)}?${qs}`,
      );
      return mapCalculatorResponseToPutSellerFields(resp);
    } catch (err) {
      logger.warn('Gamivo calculate-seller-price failed — falling back to GET nets', err as Error, {
        offerId,
      });
      return null;
    }
  }

  /**
   * When only `seller_price` changes (no explicit tier overrides) the wholesale
   * tier seller nets must be recomputed — otherwise Gamivo keeps stale tier
   * nets while retail moves. The auto-pricing cron `refresh-prices` hits this
   * path on every tick. Flow:
   *
   *   base net → customer gross (calculate-customer-price)
   *            → aligned three nets (calculate-seller-price w/ uniform gross)
   */
  private async fetchAlignedSellerNetsFromBaseSellerNet(
    offerId: string,
    baseSellerNetEur: number,
  ): Promise<Pick<GamivoEditOfferRequest, 'seller_price' | 'tier_one_seller_price' | 'tier_two_seller_price'> | null> {
    if (!(baseSellerNetEur > 0)) {
      logger.warn('Gamivo aligned pricing skipped — base seller net not positive', { offerId });
      return null;
    }
    try {
      const cust = await this.httpClient.get<GamivoCalculatePriceResponse>(
        `/api/public/v1/offers/calculate-customer-price/${encodeURIComponent(offerId)}?seller_price=${baseSellerNetEur.toFixed(2)}`,
      );
      const gross = cust.customer_price;
      if (!(gross > 0)) {
        logger.warn('Gamivo aligned pricing skipped — customer_price not positive', {
          offerId,
          baseSellerNetEur,
        });
        return null;
      }
      const qs = buildCalculateSellerPriceQueryFromUniformCustomerGross(gross);
      const sell = await this.httpClient.get<GamivoCalculatePriceResponse>(
        `/api/public/v1/offers/calculate-seller-price/${encodeURIComponent(offerId)}?${qs}`,
      );
      return mapCalculatorResponseToPutSellerFields(sell);
    } catch (err) {
      logger.warn('Gamivo aligned tier pricing failed — falling back to GET snapshot + base override',
        err as Error,
        { offerId });
      return null;
    }
  }

  /**
   * GET → merge → PUT for `/api/public/v1/offers/{id}`.
   *
   * Always sends `wholesale_mode`, `is_preorder`, `status`, and `keys` to
   * Gamivo's PUT — omitting `keys` can clear stock / deactivate the offer.
   *
   * Seller-net handling:
   *   - status / keys only      → recompute nets from existing customer prices
   *                               via `calculate-seller-price`.
   *   - base seller_price only  → align tier nets via uniform customer gross.
   *   - explicit tier overrides → trust the caller, send as-is.
   */
  private async patchOffer(
    offerId: string,
    overrides: Partial<GamivoEditOfferRequest>,
  ): Promise<GamivoOfferDetail> {
    const preUpdate = await this.httpClient.get<GamivoOfferDetail>(
      `/api/public/v1/offers/${offerId}`,
    );

    let sellerPricing: Pick<
      GamivoEditOfferRequest,
      'seller_price' | 'tier_one_seller_price' | 'tier_two_seller_price'
    >;
    let omitPricingFromOverrides = false;

    if (isGamivoPricingSafeOverrides(overrides)) {
      const fromCalc = await this.fetchPutPricingFromCalculator(offerId, preUpdate);
      sellerPricing = fromCalc ?? sellerFieldsFromOfferGet(preUpdate);
    } else {
      const hasTierSellerOverride =
        overrides.tier_one_seller_price !== undefined ||
        overrides.tier_two_seller_price !== undefined;
      const hasBaseSellerOverride = overrides.seller_price !== undefined;

      if (hasBaseSellerOverride && !hasTierSellerOverride) {
        const baseNet = Number(overrides.seller_price);
        const aligned = await this.fetchAlignedSellerNetsFromBaseSellerNet(offerId, baseNet);
        if (aligned) {
          sellerPricing = aligned;
          omitPricingFromOverrides = true;
        } else {
          sellerPricing = {
            ...sellerFieldsFromOfferGet(preUpdate),
            seller_price: baseNet,
          };
        }
      } else {
        sellerPricing = sellerFieldsFromOfferGet(preUpdate);
      }
    }

    const restOverrides: Partial<GamivoEditOfferRequest> = omitPricingFromOverrides
      ? (() => {
          const {
            seller_price: _sp,
            tier_one_seller_price: _t1,
            tier_two_seller_price: _t2,
            ...rest
          } = overrides;
          return rest;
        })()
      : overrides;

    const { keys: keysOverride, ...restWithoutKeys } = restOverrides;
    const keys = keysOverride !== undefined ? keysOverride : preUpdate.stock_available;

    const body: GamivoEditOfferRequest = {
      ...sellerPricing,
      wholesale_mode: preUpdate.wholesale_mode ?? 1,
      status: preUpdate.status ?? GAMIVO_OFFER_STATUS_ACTIVE,
      is_preorder: preUpdate.is_preorder,
      ...restWithoutKeys,
      keys,
    };

    await this.httpClient.put(`/api/public/v1/offers/${offerId}`, body);
    this.invalidateOwnOffersCache();
    return preUpdate;
  }

  /**
   * Fetch all competitor offers for a Gamivo product. `GET /products/{id}/offers`
   * returns every active offer regardless of seller.
   */
  private async fetchProductOffers(externalProductId: string): Promise<GamivoOfferDetail[]> {
    try {
      const offers = await this.httpClient.get<GamivoOfferDetail[]>(
        `/api/public/v1/products/${encodeURIComponent(externalProductId)}/offers`,
      );
      return offers ?? [];
    } catch (err) {
      logger.error('Gamivo fetchProductOffers failed', err as Error, { externalProductId });
      return [];
    }
  }

  /**
   * Find our own offer for a product by listing our authenticated offers and
   * filtering by product_id. GET /offers returns only our own offers. Cached
   * for 30s to avoid redundant identical API calls within the same pricing
   * cycle.
   */
  private async findOwnOfferForProduct(productId: string): Promise<GamivoOfferDetail | null> {
    try {
      const myOffers = await this.getOwnOffersCached();
      const numericId = Number(productId);
      return myOffers.find((o) => o.product_id === numericId) ?? null;
    } catch (err) {
      logger.warn('Gamivo findOwnOfferForProduct failed', err as Error, { productId });
      return null;
    }
  }

  private async getOwnOffersCached(): Promise<GamivoOfferDetail[]> {
    const now = Date.now();
    if (this.ownOffersCache && now < this.ownOffersCache.expiresAt) {
      return this.ownOffersCache.offers;
    }
    const offers = await this.httpClient.get<GamivoOfferDetail[]>(
      '/api/public/v1/offers',
    );
    const result = offers ?? [];
    this.ownOffersCache = { offers: result, expiresAt: now + OWN_OFFERS_CACHE_TTL_MS };
    return result;
  }

  private invalidateOwnOffersCache(): void {
    this.ownOffersCache = null;
  }
}
