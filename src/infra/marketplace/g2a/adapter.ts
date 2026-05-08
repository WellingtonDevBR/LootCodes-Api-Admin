/**
 * G2A marketplace adapter.
 *
 * Implements seller capability interfaces for G2A's Import/Export REST APIs.
 *
 * G2A specifics:
 *   - Prices are gross EUR floats ("5.98"), not cents.
 *   - Create/update operations are ASYNC: POST/PATCH return a jobId that must
 *     be polled via GET /v3/jobs/{jobId} until terminal status.
 *   - Declared stock is managed via inventory.size on the offer (no separate
 *     declared-stock API). provisionKeys and cancelReservation are no-ops.
 *   - Default offer type for declared_stock = "dropshipping".
 *   - Seller endpoints use /v3/sales/... path prefix.
 */
import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import { MarketplaceApiError } from '../_shared/marketplace-http.js';
import { createLogger, type LogContext } from '../../../shared/logger.js';
import type {
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  ISellerStockSyncAdapter,
  ISellerCompetitionAdapter,
  ISellerPricingAdapter,
  ISellerBatchPriceAdapter,
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
  CompetitorPrice,
  PricingContext,
  SellerPayoutResult,
  BatchPriceUpdate,
  BatchPriceUpdateResult,
} from '../../../core/ports/marketplace-adapter.port.js';
import type {
  G2AOfferDetail,
  G2AOfferDetailResponse,
  G2AJobResponse,
  G2AJobStatusResponse,
  G2AJobPollResult,
  G2APricingSimulation,
  G2AProductOffersResponse,
  G2AProductListResponse,
  G2AVisibility,
  G2ACreateOfferRequest,
  G2AUpdateOfferRequest,
} from './types.js';
import {
  capG2ADeclaredSize,
  validateG2APrice,
  pickIncomeValue,
  floatToCents,
  centsToEurString,
} from './helpers.js';

const logger = createLogger('g2a-adapter');

const JOB_POLL_INTERVAL_MS = 2_000;
const JOB_POLL_MAX_ATTEMPTS = 10;

export class G2AAdapter
  implements
    ISellerListingAdapter,
    ISellerDeclaredStockAdapter,
    ISellerStockSyncAdapter,
    ISellerCompetitionAdapter,
    ISellerPricingAdapter,
    ISellerBatchPriceAdapter,
    IProductSearchAdapter
{
  readonly pricingModel = 'gross' as const;

  private readonly offerCache = new Map<string, G2AOfferDetail>();

  constructor(private readonly http: MarketplaceHttpClient) {}

  // ─── ISellerListingAdapter ───────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const { externalProductId, priceCents, currency: _currency, listingType, quantity } = params;
    const priceEur = centsToEurString(priceCents);
    const visibility: G2AVisibility = 'all';

    const body: G2ACreateOfferRequest = {
      offerType: this.resolveOfferType(listingType),
      variants: [
        {
          productId: externalProductId,
          price: this.buildPriceField(priceEur, visibility),
          active: true,
          inventory: { size: capG2ADeclaredSize(quantity ?? 0) },
          visibility,
        },
      ],
    };

    const jobRes = await this.httpRequest<G2AJobResponse>({
      method: 'POST',
      path: '/v3/sales/offers',
      body,
    });

    const jobId = jobRes.data?.jobId;
    if (!jobId) {
      throw new MarketplaceApiError(
        'G2A createListing: no jobId in response',
        'g2a',
      );
    }

    const pollResult = await this.pollJob(jobId);
    if (!pollResult.ok) {
      throw new MarketplaceApiError(
        `G2A createListing job failed: ${pollResult.message ?? pollResult.code ?? 'unknown'}`,
        'g2a',
      );
    }

    return {
      externalListingId: pollResult.resourceId ?? jobId,
      status: pollResult.status,
    };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const { externalListingId, priceCents, quantity } = params;

    const offer = await this.getOffer(externalListingId);
    if (!offer) {
      return { success: false, error: `Offer ${externalListingId} not found` };
    }

    if (priceCents !== undefined) {
      const validation = validateG2APrice(priceCents, offer.priceLimit);
      if (!validation.ok) {
        return { success: false, error: validation.detail ?? validation.reason };
      }
    }

    const visibility = (offer.visibility as G2AVisibility | undefined) ?? 'all';
    const variant: G2AUpdateOfferRequest['variant'] = {};

    if (priceCents !== undefined) {
      variant.price = this.buildPriceField(centsToEurString(priceCents), visibility);
    }

    if (quantity !== undefined) {
      variant.inventory = { size: capG2ADeclaredSize(quantity) };
    }

    const body: G2AUpdateOfferRequest = {
      offerType: offer.type as G2ACreateOfferRequest['offerType'],
      variant,
    };

    const jobRes = await this.httpRequest<G2AJobResponse>({
      method: 'PATCH',
      path: `/v3/sales/offers/${externalListingId}`,
      body,
    });

    const jobId = jobRes.data?.jobId;
    if (!jobId) {
      return { success: true };
    }

    const pollResult = await this.pollJob(jobId);
    if (!pollResult.ok) {
      return {
        success: false,
        error: `Job failed: ${pollResult.message ?? pollResult.code ?? 'unknown'}`,
      };
    }

    this.offerCache.delete(externalListingId);
    return { success: true };
  }

  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    const offer = await this.getOffer(externalListingId);
    if (!offer) {
      return { success: false };
    }

    const body: G2AUpdateOfferRequest = {
      offerType: offer.type as G2ACreateOfferRequest['offerType'],
      variant: { active: false },
    };

    const jobRes = await this.httpRequest<G2AJobResponse>({
      method: 'PATCH',
      path: `/v3/sales/offers/${externalListingId}`,
      body,
    });

    const jobId = jobRes.data?.jobId;
    if (jobId) {
      await this.pollJob(jobId);
    }

    this.offerCache.delete(externalListingId);
    return { success: true };
  }

  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    const offer = await this.getOffer(externalListingId, true);
    if (!offer) {
      return { status: 'not_found', externalListingId };
    }

    const retailPrice = offer.price?.retail?.base?.value;
    const priceCents = retailPrice ? floatToCents(parseFloat(retailPrice)) : undefined;

    return {
      status: offer.active ? 'active' : 'inactive',
      externalListingId: offer.id,
      stock: offer.inventory?.size,
      priceCents,
    };
  }

  // ─── ISellerDeclaredStockAdapter ────────────────────────────────────

  async declareStock(
    externalListingId: string,
    quantity: number,
  ): Promise<DeclareStockResult> {
    const result = await this.syncStockLevel(externalListingId, quantity);
    return {
      success: result.success,
      declaredQuantity: result.syncedQuantity,
      error: result.error,
    };
  }

  async provisionKeys(_params: KeyProvisionParams): Promise<KeyProvisionResult> {
    // G2A uses key_upload model — keys are uploaded directly.
    // Declared stock callbacks are not used; this is a no-op.
    return { success: true, provisioned: 0 };
  }

  async cancelReservation(
    _reservationId: string,
    _reason: string,
  ): Promise<{ success: boolean }> {
    // G2A has no reservation/cancellation flow for declared stock.
    return { success: true };
  }

  // ─── ISellerStockSyncAdapter ────────────────────────────────────────

  async syncStockLevel(
    externalListingId: string,
    availableQuantity: number,
  ): Promise<SyncStockLevelResult> {
    const clampedQty = capG2ADeclaredSize(availableQuantity);
    const shouldActivate = clampedQty > 0;

    const offer = await this.getOffer(externalListingId);
    if (!offer) {
      return { success: false, error: `Offer ${externalListingId} not found` };
    }

    const variant: G2AUpdateOfferRequest['variant'] = {
      inventory: { size: clampedQty },
    };

    if (offer.active !== shouldActivate) {
      variant.active = shouldActivate;
    }

    const body: G2AUpdateOfferRequest = {
      offerType: offer.type as G2ACreateOfferRequest['offerType'],
      variant,
    };

    const jobRes = await this.httpRequest<G2AJobResponse>({
      method: 'PATCH',
      path: `/v3/sales/offers/${externalListingId}`,
      body,
    });

    const jobId = jobRes.data?.jobId;
    if (jobId) {
      const poll = await this.pollJob(jobId);
      if (!poll.ok) {
        return {
          success: false,
          error: `Sync job failed: ${poll.message ?? poll.code ?? 'unknown'}`,
        };
      }
    }

    this.offerCache.delete(externalListingId);
    return { success: true, syncedQuantity: clampedQty };
  }

  // ─── ISellerCompetitionAdapter ──────────────────────────────────────

  async getCompetitorPrices(externalProductId: string): Promise<CompetitorPrice[]> {
    try {
      const res = await this.httpRequest<G2AProductOffersResponse>({
        method: 'GET',
        path: `/v3/sales/products/${externalProductId}/offers`,
      });

      if (!res.data?.length) return [];

      return res.data.map((o) => {
        const priceStr = o.price?.retail?.base?.value;
        return {
          merchantName: o.seller?.name ?? 'Unknown',
          priceCents: priceStr ? floatToCents(parseFloat(priceStr)) : 0,
          currency: o.price?.retail?.base?.currencyCode ?? 'EUR',
          inStock: o.inventory?.range !== '0',
          isOwnOffer: false,
        };
      });
    } catch (err) {
      // 404 means the product has no Import API offer listing — return empty so
      // pricing continues without competitor data. Any other status (auth, 5xx,
      // network) is a real integration failure and must propagate so the caller's
      // error handler surfaces it to Sentry.
      if (err instanceof MarketplaceApiError && err.statusCode === 404) return [];
      throw err;
    }
  }

  // ─── ISellerPricingAdapter ──────────────────────────────────────────

  async calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult> {
    const priceEur = centsToEurString(ctx.priceCents);

    const sim = await this.httpRequest<G2APricingSimulation>({
      method: 'GET',
      path: `/v3/pricing/simulations?price=${priceEur}&currency=${ctx.currency}`,
    });

    const visibility = (ctx.listingType === 'business' ? 'business' : 'retail') as G2AVisibility;
    const incomeEur = pickIncomeValue(sim, visibility);
    const netPayoutCents = floatToCents(incomeEur);
    const feeCents = ctx.priceCents - netPayoutCents;

    return {
      grossPriceCents: ctx.priceCents,
      feeCents: Math.max(0, feeCents),
      netPayoutCents: Math.max(0, netPayoutCents),
    };
  }

  // ─── ISellerBatchPriceAdapter ───────────────────────────────────────

  async batchUpdatePrices(updates: BatchPriceUpdate[]): Promise<BatchPriceUpdateResult> {
    let updated = 0;
    let failed = 0;
    const errors: Array<{ externalListingId: string; error: string }> = [];

    for (const update of updates) {
      try {
        const result = await this.updateListing({
          externalListingId: update.externalListingId,
          priceCents: update.priceCents,
        });

        if (result.success) {
          updated++;
        } else {
          failed++;
          errors.push({
            externalListingId: update.externalListingId,
            error: result.error ?? 'Unknown error',
          });
        }
      } catch (err) {
        failed++;
        errors.push({
          externalListingId: update.externalListingId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ─── IProductSearchAdapter ──────────────────────────────────────────

  async searchProducts(query: string, limit = 20): Promise<ProductSearchResult[]> {
    try {
      const res = await this.httpRequest<G2AProductListResponse>({
        method: 'GET',
        path: `/v1/products?search=${encodeURIComponent(query)}&limit=${limit}`,
      });

      return (res.docs ?? []).map((p) => ({
        externalProductId: String(p.id),
        productName: p.name,
        platform: p.platform ?? null,
        region: null,
        priceCents: floatToCents(p.minPrice),
        currency: 'EUR',
        available: p.availableToBuy && p.qty > 0,
      }));
    } catch (err) {
      logger.warn('G2A product search failed', err as Error);
      return [];
    }
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  private async httpRequest<T>(opts: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
  }): Promise<T> {
    const { method, path, body } = opts;

    switch (method) {
      case 'GET':
        return this.http.get<T>(path);
      case 'POST':
        return this.http.post<T>(path, body);
      case 'PUT':
        return this.http.put<T>(path, body);
      case 'PATCH':
        return this.http.patch<T>(path, body);
      case 'DELETE':
        return this.http.delete<T>(path);
    }
  }

  /**
   * Poll a G2A async job until it reaches a terminal status.
   * Jobs are created by POST/PATCH on offers and return a jobId.
   */
  private async pollJob(jobId: string): Promise<G2AJobPollResult> {
    for (let attempt = 0; attempt < JOB_POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(JOB_POLL_INTERVAL_MS);
      }

      const res = await this.httpRequest<G2AJobStatusResponse>({
        method: 'GET',
        path: `/v3/jobs/${jobId}`,
      });

      const { status, elements } = res.data;

      if (status === 'completed' || status === 'done') {
        const first = elements?.[0];
        return {
          ok: true,
          resourceId: first?.resourceId,
          status,
        };
      }

      if (status === 'failed' || status === 'error') {
        const first = elements?.[0];
        return {
          ok: false,
          resourceId: first?.resourceId,
          code: first?.code,
          message: first?.message,
          status,
        };
      }

      logger.info('Polling G2A job', {
        jobId,
        status,
        attempt: attempt + 1,
        maxAttempts: JOB_POLL_MAX_ATTEMPTS,
      } as LogContext);
    }

    return {
      ok: false,
      message: `Job ${jobId} did not complete within ${JOB_POLL_MAX_ATTEMPTS} attempts`,
      status: 'timeout',
    };
  }

  /**
   * Fetch an offer by ID, using per-request cache to avoid redundant GETs.
   */
  private async getOffer(
    offerId: string,
    skipCache = false,
  ): Promise<G2AOfferDetail | null> {
    if (!skipCache) {
      const cached = this.offerCache.get(offerId);
      if (cached) return cached;
    }

    try {
      const res = await this.httpRequest<G2AOfferDetailResponse>({
        method: 'GET',
        path: `/v3/sales/offers/${offerId}`,
      });
      this.offerCache.set(offerId, res.data);
      return res.data;
    } catch (err) {
      if (err instanceof MarketplaceApiError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Build the price field scoped by visibility.
   * G2A accepts `{ retail?: string; business?: string }` on offer mutations.
   */
  private buildPriceField(
    priceEur: string,
    visibility: G2AVisibility,
  ): { retail?: string; business?: string } {
    switch (visibility) {
      case 'retail':
        return { retail: priceEur };
      case 'business':
        return { business: priceEur };
      case 'all':
      default:
        return { retail: priceEur, business: priceEur };
    }
  }

  /**
   * Map internal listing type strings to G2A offer types.
   */
  private resolveOfferType(listingType: string): G2ACreateOfferRequest['offerType'] {
    const mapping: Record<string, G2ACreateOfferRequest['offerType']> = {
      declared_stock: 'dropshipping',
      key_upload: 'game',
      game: 'game',
      dropshipping: 'dropshipping',
      promo: 'promo',
      preorder: 'preorder',
      physical: 'physical',
      steamgift: 'steamgift',
    };
    return mapping[listingType] ?? 'dropshipping';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
