/**
 * Gamivo marketplace adapter for LootCodes Admin API.
 *
 * Capabilities:
 *   - ISellerListingAdapter
 *   - ISellerDeclaredStockAdapter (Import API — keys delivered on-demand)
 *   - ISellerPricingAdapter (pricingModel = 'seller_price')
 *   - ISellerCallbackSetupAdapter
 *
 * NOTE: SellerKeyUploadProvider is intentionally NOT implemented.
 * Gamivo uses the Import API (declared_stock + on-demand callbacks).
 * Pre-uploading keys causes orphan provisions and double-delivery.
 *
 * Prices are floats (EUR) in Gamivo's API — converted to/from cents here.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import type {
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  ISellerPricingAdapter,
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
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('gamivo-adapter');

function floatToCents(value: number | undefined | null): number {
  if (value == null || isNaN(value)) return 0;
  return Math.round(value * 100);
}

export class GamivoMarketplaceAdapter
  implements
    ISellerListingAdapter,
    ISellerDeclaredStockAdapter,
    ISellerPricingAdapter,
    ISellerCallbackSetupAdapter,
    IProductSearchAdapter
{
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
   * GET current offer, merge overrides, PUT the result.
   * Always sends wholesale_mode, is_preorder, status, and keys.
   */
  private async patchOffer(
    offerId: string,
    overrides: Partial<GamivoEditOfferRequest>,
  ): Promise<GamivoOfferDetail> {
    const preUpdate = await this.httpClient.get<GamivoOfferDetail>(
      `/api/public/v1/offers/${offerId}`,
    );

    const body: GamivoEditOfferRequest = {
      seller_price: overrides.seller_price ?? preUpdate.seller_price,
      tier_one_seller_price: overrides.tier_one_seller_price ?? preUpdate.wholesale_seller_price_tier_one,
      tier_two_seller_price: overrides.tier_two_seller_price ?? preUpdate.wholesale_seller_price_tier_two,
      wholesale_mode: preUpdate.wholesale_mode ?? 1,
      status: overrides.status ?? preUpdate.status ?? GAMIVO_OFFER_STATUS_ACTIVE,
      is_preorder: preUpdate.is_preorder,
      keys: overrides.keys ?? preUpdate.stock_available,
    };

    await this.httpClient.put(`/api/public/v1/offers/${offerId}`, body);
    return preUpdate;
  }
}
