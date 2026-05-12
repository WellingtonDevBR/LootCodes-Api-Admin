/**
 * Eneba GraphQL API Adapter for the Admin Backend.
 *
 * Implements seller-side capability interfaces from marketplace-adapter.port.ts:
 *   - ISellerListingAdapter
 *   - ISellerDeclaredStockAdapter
 *   - ISellerCompetitionAdapter
 *   - ISellerPricingAdapter
 *   - ISellerCallbackSetupAdapter
 *   - ISellerBatchPriceAdapter
 *   - ISellerBatchDeclaredStockAdapter
 *   - ISellerGlobalStockAdapter
 *
 * Inbound callbacks (RESERVE/PROVIDE/CANCEL) are handled by the seller-webhook
 * routes, not by this adapter.
 */
import { createLogger } from '../../../shared/logger.js';
import type {
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  ISellerCompetitionAdapter,
  ISellerPricingAdapter,
  ISellerCallbackSetupAdapter,
  ISellerBatchPriceAdapter,
  ISellerBatchDeclaredStockAdapter,
  ISellerGlobalStockAdapter,
  ISellerKeyReconcileAdapter,
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
  CompetitorPrice,
  RegisterCallbacksResult,
  RemoveCallbackResult,
  GetCallbacksResult,
  BatchPriceUpdate,
  BatchPriceUpdateResult,
  BatchDeclaredStockUpdate,
  ProductSearchResult,
  GetStockKeysResult,
  SellerKeyState,
} from '../../../core/ports/marketplace-adapter.port.js';
import type { EnebaGraphQLClient } from './graphql-client.js';
import type {
  EnebaSearchProductsData,
  EnebaGetProductData,
  EnebaCompetitionData,
  EnebaCreateAuctionData,
  EnebaRemoveAuctionData,
  EnebaGetStockData,
  EnebaStockNode,
  EnebaRegisterCallbackData,
  EnebaGetCallbacksData,
  EnebaEnableDeclaredStockData,
  EnebaUpdateDeclaredStockData,
  EnebaUpdateAuctionPriceData,
  EnebaUpdateStockStatusData,
  EnebaCalculatePriceData,
  EnebaGetKeysData,
} from './types.js';
import {
  SEARCH_PRODUCTS_QUERY,
  GET_COMPETITION_QUERY,
  GET_STOCK_QUERY,
  GET_STOCK_KEYS_QUERY,
  CALCULATE_PRICE_QUERY,
  buildCreateAuctionMutation,
  REMOVE_AUCTION_MUTATION,
  buildRegisterCallbackMutation,
  buildRemoveCallbackMutation,
  ENABLE_DECLARED_STOCK_MUTATION,
  GET_CALLBACKS_QUERY,
  UPDATE_DECLARED_STOCK_MUTATION,
  UPDATE_AUCTION_PRICE_MUTATION,
  UPDATE_STOCK_STATUS_MUTATION,
  ENABLE_KEY_REPLACEMENTS_MUTATION,
} from './queries.js';

const logger = createLogger('eneba-adapter');

const ENEBA_SANDBOX_CLIENT_ID = '917611c2-70a5-11e9-00c4-ee691bb8bfaa';

export class EnebaAdapter
  implements
    ISellerListingAdapter,
    ISellerDeclaredStockAdapter,
    ISellerCompetitionAdapter,
    ISellerPricingAdapter,
    ISellerCallbackSetupAdapter,
    ISellerBatchPriceAdapter,
    ISellerBatchDeclaredStockAdapter,
    ISellerGlobalStockAdapter,
    ISellerKeyReconcileAdapter
{
  /**
   * Eneba pricing model: the auto-pricing cron computes prices in NET terms
   * (what the seller receives after commission and fixed fee) and submits them
   * via `priceIWantToGet`. Eneba then calculates the gross buyer-facing price.
   * This prevents us from having to manually mirror Eneba's fee structure in
   * our floor calculation — the Eneba API is the source of truth for fees.
   */
  readonly pricingModel = 'seller_price' as const;
  readonly isSandbox: boolean;

  constructor(
    private readonly gqlClient: EnebaGraphQLClient,
    config: { baseUrl: string; clientId: string },
  ) {
    this.isSandbox =
      config.baseUrl.includes('sandbox') ||
      config.clientId === ENEBA_SANDBOX_CLIENT_ID;
  }

  // ─── ISellerListingAdapter ──────────────────────────────────────────

  async createListing(params: CreateListingParams): Promise<CreateListingResult> {
    const isDeclaredStock = params.listingType === 'declared_stock';
    const shape = {
      hasDeclaredStock: isDeclaredStock,
      hasOnHand: false,
      hasKeys: !isDeclaredStock,
      hasPriceIWantToGet: false,
    };

    const variables: Record<string, unknown> = {
      productId: params.externalProductId,
      enabled: true,
      autoRenew: false,
      price: { amount: params.priceCents, currency: params.currency },
    };

    if (isDeclaredStock) {
      const qty = params.quantity;
      if (qty == null || qty < 1) {
        throw new Error(
          'Eneba declared-stock S_createAuction requires quantity ≥ 1 (matches inventory available keys)',
        );
      }
      variables.declaredStock = qty;
    } else {
      variables.keys = [];
    }

    const mutation = buildCreateAuctionMutation(shape);

    logger.info('S_createAuction', {
      productId: params.externalProductId,
      listingType: params.listingType,
      declaredStock: isDeclaredStock ? params.quantity : undefined,
      priceCents: params.priceCents,
      currency: params.currency,
      isSandbox: this.isSandbox,
    });

    let data: EnebaCreateAuctionData;
    try {
      data = await this.gqlClient.execute<EnebaCreateAuctionData>(mutation, variables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isDeclaredStock) throw err instanceof Error ? err : new Error(msg);

      const env = this.isSandbox ? 'sandbox' : 'production';
      throw new Error(
        `Eneba ${env} declined or failed S_createAuction for declared stock. Upstream: ${msg}. ` +
          `Typical causes: merchant Declared Stock not enabled (${this.isSandbox ? 'sandbox may lack P_enableDeclaredStock — contact Eneba' : 'run Providers → Enable declared stock / P_enableDeclaredStock'}), ` +
          `price below marketplace minimum for product ${params.externalProductId}, ` +
          `or currency mismatch (${params.currency}). declaredStock=${params.quantity ?? 'n/a'}, price=${params.priceCents} ${params.currency}.`,
      );
    }

    const result = data.S_createAuction;

    return {
      externalListingId: result.auctionId,
      status: result.success ? 'active' : 'pending',
    };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const currency = params.currency ?? 'EUR';

    const hasPrice = params.priceCents != null && params.priceCents > 0;
    const hasQuantity = params.quantity != null;

    if (!hasPrice && !hasQuantity) {
      return { success: true };
    }

    // Eneba deprecated listing prices on S_updateAuction; production often returns HTTP 400 if
    // price is sent there. Mirror Edge: P_updateAuctionPrice for money, then stock mutations.
    // Use priceIWantToGet (NET) so Eneba computes the gross buyer price using its own fee
    // schedule — consistent with batchUpdatePrices and the pricingModel='seller_price' contract.
    if (hasPrice) {
      const data = await this.gqlClient.execute<EnebaUpdateAuctionPriceData>(
        UPDATE_AUCTION_PRICE_MUTATION,
        {
          items: [
            {
              auctionId: params.externalListingId,
              priceIWantToGet: { amount: params.priceCents as number, currency },
            },
          ],
        },
      );
      const item = data.P_updateAuctionPrice.items[0];
      if (!item?.success) {
        return {
          success: false,
          error: item?.error ?? 'P_updateAuctionPrice failed',
        };
      }
    }

    if (hasQuantity) {
      const declaredStock = (params.quantity ?? 0) > 0 ? params.quantity : null;
      const stockData = await this.gqlClient.execute<EnebaUpdateDeclaredStockData>(
        UPDATE_DECLARED_STOCK_MUTATION,
        { statuses: [{ auctionId: params.externalListingId, declaredStock }] },
      );
      if (!stockData.P_updateDeclaredStock.success) {
        return { success: false, error: 'P_updateDeclaredStock returned success: false' };
      }

      // When clearing stock also disable the listing so it stops showing on Eneba.
      if (declaredStock === null) {
        const disableData = await this.gqlClient.execute<EnebaUpdateAuctionPriceData>(
          UPDATE_AUCTION_PRICE_MUTATION,
          { items: [{ auctionId: params.externalListingId, enabled: false }] },
        );
        const item = disableData.P_updateAuctionPrice.items[0];
        if (!item?.success) {
          return { success: false, error: item?.error ?? 'P_updateAuctionPrice disable failed' };
        }
      }
    }

    return { success: true };
  }

  /**
   * Matches Edge `discoverExistingListingId`: `S_stock(productId)` returns this merchant's auctions
   * for the catalog product — avoids duplicate `S_createAuction` when CRM lost `external_listing_id`.
   */
  async discoverExistingAuctionId(externalProductId: string): Promise<string | null> {
    let cursor: string | null = null;
    const maxPages = 10;

    for (let page = 0; page < maxPages; page++) {
      const variables: Record<string, unknown> = {
        first: 100,
        productId: externalProductId,
      };
      if (cursor) variables.after = cursor;

      const data = await this.gqlClient.execute<EnebaGetStockData>(GET_STOCK_QUERY, variables);
      const conn = data.S_stock;
      const edges = conn?.edges ?? [];

      if (edges.length > 0) {
        const auctionId = edges[0].node.id;
        logger.info('discoverExistingAuctionId: found auction via S_stock', {
          externalProductId,
          auctionId,
          page,
        });
        return auctionId;
      }

      if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) {
        return null;
      }
      cursor = conn.pageInfo.endCursor;
    }

    return null;
  }

  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    const data = await this.gqlClient.execute<EnebaRemoveAuctionData>(
      REMOVE_AUCTION_MUTATION,
      { auctionId: externalListingId },
    );
    return { success: data.S_removeAuction.success };
  }

  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    const data = await this.gqlClient.execute<EnebaGetStockData>(
      GET_STOCK_QUERY,
      { first: 100 },
    );

    const match = data.S_stock?.edges?.find((e) => e.node.id === externalListingId);
    if (!match) {
      return {
        status: 'not_found',
        externalListingId,
      };
    }

    const node = match.node;
    return {
      status: node.status === 'ACTIVE' ? 'active' : 'paused',
      externalListingId: node.id,
      stock: node.declaredStock ?? node.onHand,
      priceCents: node.price.amount,
    };
  }

  // ─── ISellerDeclaredStockAdapter ────────────────────────────────────

  async declareStock(
    externalListingId: string,
    quantity: number,
  ): Promise<DeclareStockResult> {
    const enabled = quantity > 0;
    const declaredStock = enabled ? quantity : null;

    // P_updateDeclaredStock to set/clear quantity; P_updateAuctionPrice to
    // toggle enabled state. Two calls per listing, but S_updateAuction is
    // deprecated for both price and stock operations.
    const stockData = await this.gqlClient.execute<EnebaUpdateDeclaredStockData>(
      UPDATE_DECLARED_STOCK_MUTATION,
      { statuses: [{ auctionId: externalListingId, declaredStock }] },
    );

    if (!stockData.P_updateDeclaredStock.success) {
      return { success: false, declaredQuantity: quantity };
    }

    const priceData = await this.gqlClient.execute<EnebaUpdateAuctionPriceData>(
      UPDATE_AUCTION_PRICE_MUTATION,
      { items: [{ auctionId: externalListingId, enabled }] },
    );

    const item = priceData.P_updateAuctionPrice.items[0];
    return {
      success: item?.success ?? false,
      declaredQuantity: quantity,
    };
  }

  /**
   * No-op for declared stock: Eneba receives keys in the HTTP callback
   * response, not via an outbound API push.
   */
  async provisionKeys(params: KeyProvisionParams): Promise<KeyProvisionResult> {
    logger.info('provisionKeys no-op for declared stock (keys returned via callback response)', {
      reservationId: params.reservationId,
      keyCount: params.keys.length,
    });
    return { success: true, provisioned: params.keys.length };
  }

  /**
   * No-op: Eneba initiates cancellations via callback, we don't push
   * cancellations to them.
   */
  async cancelReservation(reservationId: string, reason: string): Promise<{ success: boolean }> {
    logger.info('cancelReservation no-op for declared stock (Eneba-initiated)', {
      reservationId,
      reason,
    });
    return { success: true };
  }

  // ─── ISellerCompetitionAdapter ─────────────────────────────────────

  async getCompetitorPrices(externalProductId: string): Promise<CompetitorPrice[]> {
    const result = await this.batchGetCompetitorPrices([externalProductId]);
    return result.get(externalProductId) ?? [];
  }

  /**
   * Batch-fetch full competitor lists for multiple products in chunks of 25.
   * Eneba's `S_competition` accepts an array of productIds, so we reduce N
   * per-listing round-trips to ceil(N/25) requests.
   */
  async batchGetCompetitorPrices(productIds: string[]): Promise<Map<string, CompetitorPrice[]>> {
    const result = new Map<string, CompetitorPrice[]>();
    if (productIds.length === 0 || this.isSandbox) {
      if (this.isSandbox && productIds.length > 0) {
        logger.warn('Eneba sandbox does not support S_competition');
      }
      return result;
    }

    // Eneba docs allow up to 100 product IDs per S_competition call.
    const CHUNK_SIZE = 100;
    for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
      const chunk = productIds.slice(i, i + CHUNK_SIZE);
      const data = await this.gqlClient.execute<EnebaCompetitionData>(
        GET_COMPETITION_QUERY,
        { productIds: chunk },
      );

      for (const entry of data.S_competition ?? []) {
        const edges = entry.competition?.edges ?? [];
        const sorted = edges
          .map((e) => e.node)
          .sort((a, b) => a.price.amount - b.price.amount);

        result.set(
          entry.productId,
          sorted.map((node) => ({
            merchantName: node.merchantName,
            priceCents: node.price.amount,
            currency: node.price.currency,
            inStock: true,
            isOwnOffer: node.belongsToYou,
          })),
        );
      }
    }

    return result;
  }

  // ─── ISellerPricingAdapter ─────────────────────────────────────────

  async calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult> {
    if (this.isSandbox) {
      return {
        grossPriceCents: ctx.priceCents,
        feeCents: 0,
        netPayoutCents: 0,
      };
    }

    if (!ctx.externalProductId) {
      throw new Error('Eneba calculateNetPayout requires externalProductId');
    }

    const data = await this.gqlClient.execute<EnebaCalculatePriceData>(
      CALCULATE_PRICE_QUERY,
      {
        price: { amount: ctx.priceCents, currency: ctx.currency || 'EUR' },
        productId: ctx.externalProductId,
      },
    );

    const result = data.S_calculatePrice;
    return {
      grossPriceCents: ctx.priceCents,
      feeCents: result.commission.rate.amount,
      netPayoutCents: result.priceWithoutCommission.amount,
    };
  }

  // ─── ISellerCallbackSetupAdapter ───────────────────────────────────

  async registerCallback(
    type: string,
    url: string,
    authToken: string,
  ): Promise<RegisterCallbacksResult> {
    const inlineQuery = buildRegisterCallbackMutation(type, url, authToken);
    const data = await this.gqlClient.execute<EnebaRegisterCallbackData>(inlineQuery);
    if (!data.P_registerCallback.success) {
      throw new Error(`Failed to register Eneba callback: ${type}`);
    }

    const callbacksData = await this.gqlClient.execute<EnebaGetCallbacksData>(
      GET_CALLBACKS_QUERY,
    );
    const normalizedUrl = url.replace(/\/$/, '');
    const matched = (callbacksData.P_apiCallbacks ?? []).find((cb) =>
      cb.type === type && cb.url.replace(/\/$/, '') === normalizedUrl,
    );

    return {
      registered: 1,
      callbackIds: matched ? [matched.id] : [],
    };
  }

  async removeCallback(callbackId: string): Promise<RemoveCallbackResult> {
    const mutation = buildRemoveCallbackMutation(callbackId);
    await this.gqlClient.execute<{ P_removeCallback: { success: boolean } }>(mutation);
    return { removed: true };
  }

  async getCallbacks(): Promise<GetCallbacksResult> {
    const data = await this.gqlClient.execute<EnebaGetCallbacksData>(
      GET_CALLBACKS_QUERY,
    );
    return {
      callbacks: (data.P_apiCallbacks ?? []).map((cb) => ({
        id: cb.id,
        type: cb.type,
        url: cb.url,
      })),
    };
  }

  // ─── ISellerBatchPriceAdapter ──────────────────────────────────────

  async batchUpdatePrices(updates: BatchPriceUpdate[]): Promise<BatchPriceUpdateResult> {
    const MAX_BATCH = 200;
    if (updates.length > MAX_BATCH) {
      throw new Error(`P_updateAuctionPrice supports max ${MAX_BATCH} items per mutation`);
    }

    if (updates.length === 0) {
      return { updated: 0, failed: 0 };
    }

    // Include enabled: true on every item so that auctions previously disabled
    // (e.g. after a no-credit/uneconomic cycle) are re-activated when a new
    // price is pushed. P_updateAuctionPrice accepts the enabled field per the
    // Eneba API docs.
    //
    // `priceIWantToGet` is the NET amount the seller wants to receive after
    // Eneba deducts commission and fixed fees. Eneba calculates the gross
    // buyer-facing price from this value using its own fee schedule, which
    // means we don't need to mirror Eneba's exact fee structure on our side.
    // The auto-pricing cron passes NET prices when pricingModel='seller_price'.
    //
    // `preventPaidPriceChange: true` — Eneba skips the update (charges nothing)
    // if the free-update quota is exhausted. We never want silent paid charges
    // from the pricing cron; a skipped update is preferable to an unexpected fee.
    const items = updates.map((u) => ({
      auctionId: u.externalListingId,
      enabled: true,
      priceIWantToGet: { amount: u.priceCents, currency: u.currency ?? 'EUR' },
      preventPaidPriceChange: true,
    }));

    const data = await this.gqlClient.execute<EnebaUpdateAuctionPriceData>(
      UPDATE_AUCTION_PRICE_MUTATION,
      { items },
    );

    let updated = 0;
    let failed = 0;
    const errors: Array<{ externalListingId: string; error: string }> = [];

    for (const item of data.P_updateAuctionPrice.items) {
      if (item.success) {
        updated++;
      } else {
        failed++;
        errors.push({
          externalListingId: item.auctionId,
          error: item.error ?? 'Unknown error',
        });
      }
    }

    return {
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  // ─── ISellerBatchDeclaredStockAdapter ──────────────────────────────

  async batchUpdateDeclaredStock(
    updates: BatchDeclaredStockUpdate[],
  ): Promise<{ updated: number; failed: number }> {
    const MAX_BATCH = 50;
    if (updates.length > MAX_BATCH) {
      throw new Error(`P_updateDeclaredStock supports max ${MAX_BATCH} auctions per mutation`);
    }

    if (updates.length === 0) {
      return { updated: 0, failed: 0 };
    }

    let updated = 0;
    let failed = 0;

    const numericStatuses: Array<{ auctionId: string; declaredStock: number }> = [];
    const nullUpdates: BatchDeclaredStockUpdate[] = [];

    for (const u of updates) {
      if (u.quantity === 0) {
        nullUpdates.push(u);
      } else {
        numericStatuses.push({
          auctionId: u.externalListingId,
          declaredStock: u.quantity,
        });
      }
    }

    // Batch-clear: P_updateDeclaredStock(null) then P_updateAuctionPrice(enabled:false).
    if (nullUpdates.length > 0) {
      const clearStatuses = nullUpdates.map((u) => ({
        auctionId: u.externalListingId,
        declaredStock: null,
      }));
      try {
        const data = await this.gqlClient.execute<EnebaUpdateDeclaredStockData>(
          UPDATE_DECLARED_STOCK_MUTATION,
          { statuses: clearStatuses },
        );
        if (data.P_updateDeclaredStock.success) {
          updated += nullUpdates.length;
        } else {
          failed += nullUpdates.length;
        }
      } catch (err) {
        logger.warn('Batch P_updateDeclaredStock(null) failed', {
          count: nullUpdates.length,
          error: err instanceof Error ? err.message : String(err),
        });
        failed += nullUpdates.length;
      }

      // Disable the auctions so they stop showing on Eneba.
      try {
        const disableItems = nullUpdates.map((u) => ({
          auctionId: u.externalListingId,
          enabled: false,
        }));
        await this.gqlClient.execute<EnebaUpdateAuctionPriceData>(
          UPDATE_AUCTION_PRICE_MUTATION,
          { items: disableItems },
        );
      } catch (err) {
        logger.warn('Batch P_updateAuctionPrice(enabled:false) failed for cleared listings', {
          count: nullUpdates.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (numericStatuses.length > 0) {
      try {
        const data = await this.gqlClient.execute<EnebaUpdateDeclaredStockData>(
          UPDATE_DECLARED_STOCK_MUTATION,
          { statuses: numericStatuses },
        );
        if (data.P_updateDeclaredStock.success) {
          updated += numericStatuses.length;
        } else {
          failed += numericStatuses.length;
        }
      } catch (err) {
        logger.warn('Batch P_updateDeclaredStock failed', {
          count: numericStatuses.length,
          error: err instanceof Error ? err.message : String(err),
        });
        failed += numericStatuses.length;
      }
    }

    return { updated, failed };
  }

  // ─── ISellerGlobalStockAdapter ─────────────────────────────────────

  async updateAllStockStatus(enabled: boolean): Promise<{ success: boolean }> {
    const data = await this.gqlClient.execute<EnebaUpdateStockStatusData>(
      UPDATE_STOCK_STATUS_MUTATION,
      { enabled },
    );
    return { success: data.P_updateStockStatus.success };
  }

  // ─── Setup Helpers (not part of port interfaces) ──────────────────

  async enableDeclaredStock(): Promise<{ success: boolean; failureReason: string | null }> {
    const data = await this.gqlClient.execute<EnebaEnableDeclaredStockData>(
      ENABLE_DECLARED_STOCK_MUTATION,
    );
    return {
      success: data.P_enableDeclaredStock.success,
      failureReason: data.P_enableDeclaredStock.failureReason,
    };
  }

  async enableKeyReplacements(): Promise<boolean> {
    const data = await this.gqlClient.execute<{ P_enableDeclaredStockKeyReplacements: { success: boolean } }>(
      ENABLE_KEY_REPLACEMENTS_MUTATION,
    );
    return data.P_enableDeclaredStockKeyReplacements.success;
  }

  /**
   * Batch-fetch lowest marketplace offer per product from `S_competition`.
   * Delegates to `batchGetCompetitorPrices` so we have a single S_competition call path.
   */
  private async cheapestCompetitionPriceByProductId(
    productIds: string[],
  ): Promise<Map<string, { cents: number; currency: string }>> {
    const result = new Map<string, { cents: number; currency: string }>();
    if (productIds.length === 0) return result;

    const allCompetitors = await this.batchGetCompetitorPrices(productIds);
    for (const [productId, competitors] of allCompetitors) {
      if (competitors.length === 0) continue;
      const cheapest = competitors[0]!;
      result.set(productId, { cents: Math.round(cheapest.priceCents), currency: cheapest.currency });
    }
    return result;
  }

  // ─── IProductSearchAdapter ─────────────────────────────────────────

  async searchProducts(query: string, limit = 20): Promise<ProductSearchResult[]> {
    const data = await this.searchProductsRaw(query, limit);
    const edges = data.S_products?.edges ?? [];
    const ids = edges.map((e) => e.node.id);
    const priceByProduct = await this.cheapestCompetitionPriceByProductId(ids);

    return edges.map((edge) => {
      const p = edge.node;
      const drm = p.drm?.slug ?? null;
      const regionCodes = (p.regions ?? []).map((r) => r.code);
      const hinted = priceByProduct.get(p.id);
      return {
        externalProductId: p.id,
        productName: p.name,
        platform: drm,
        region: regionCodes.length > 0 ? regionCodes.join(', ') : null,
        priceCents: hinted?.cents ?? 0,
        currency: hinted?.currency ?? 'EUR',
        available: true,
      };
    });
  }

  // ─── Queries (exposed for routes that need raw data) ──────────────

  async searchProductsRaw(
    search: string,
    first = 50,
    after?: string,
  ): Promise<EnebaSearchProductsData> {
    const variables: Record<string, unknown> = { search, first };
    if (after) variables.after = after;
    return this.gqlClient.execute<EnebaSearchProductsData>(
      SEARCH_PRODUCTS_QUERY,
      variables,
    );
  }

  async getProduct(productId: string): Promise<EnebaGetProductData> {
    return this.gqlClient.execute<EnebaGetProductData>(
      'query GetProduct($productId: S_Uuid!) { S_product(productId: $productId) { id name slug regions { code } drm { slug } type { value } } }',
      { productId },
    );
  }

  async getRemoteStock(productId?: string): Promise<EnebaGetStockData> {
    const variables: Record<string, unknown> = { first: 100 };
    if (productId) variables.productId = productId;
    return this.gqlClient.execute<EnebaGetStockData>(
      GET_STOCK_QUERY,
      variables,
    );
  }

  // ─── ISellerKeyReconcileAdapter ──────────────────────────────────────

  /**
   * Fetch all keys for a listing by stockId with optional state filter.
   * Paginates automatically (100 per page).
   */
  async getAllStockKeys(stockId: string, state?: SellerKeyState | null): Promise<GetStockKeysResult> {
    const keys: GetStockKeysResult['keys'] = [];
    let after: string | null = null;

    do {
      const variables: Record<string, unknown> = { stockId, first: 100 };
      if (state) variables.state = state;
      if (after) variables.after = after;

      const data = await this.gqlClient.execute<EnebaGetKeysData>(GET_STOCK_KEYS_QUERY, variables);
      const connection = data.S_keys;

      for (const edge of connection.edges) {
        keys.push({
          id: edge.node.id,
          value: edge.node.value,
          state: edge.node.state as SellerKeyState,
          reportReason: edge.node.reportReason ?? null,
        });
      }

      after = connection.pageInfo?.hasNextPage ? (connection.pageInfo.endCursor ?? null) : null;
    } while (after !== null);

    return { keys };
  }

  /**
   * Fetch keys for a batch of Eneba order numbers.
   * Handles pagination automatically.
   */
  async getKeysByOrders(ordersNumbers: string[]): Promise<GetStockKeysResult> {
    if (ordersNumbers.length === 0) return { keys: [] };

    const keys: GetStockKeysResult['keys'] = [];
    let after: string | null = null;

    do {
      const variables: Record<string, unknown> = { ordersNumbers, first: 100 };
      if (after) variables.after = after;

      const data = await this.gqlClient.execute<EnebaGetKeysData>(GET_STOCK_KEYS_QUERY, variables);
      const connection = data.S_keys;

      for (const edge of connection.edges) {
        keys.push({
          id: edge.node.id,
          value: edge.node.value,
          state: edge.node.state as SellerKeyState,
          reportReason: edge.node.reportReason ?? null,
        });
      }

      after = connection.pageInfo?.hasNextPage ? (connection.pageInfo.endCursor ?? null) : null;
    } while (after !== null);

    return { keys };
  }

  /**
   * Fetch all our auctions from Eneba via S_stock with cursor pagination.
   *
   * Returns the raw EnebaStockNode array including priceUpdateQuota per auction,
   * onHand, declaredStock, status, and position. Used by the pricing phase to
   * read the authoritative free-change quota remaining from Eneba instead of
   * relying on our local price_change_timestamps counter.
   *
   * Handles pagination automatically (100 per page) up to 10k auctions.
   * For >10k auctions, S_stockBulkSearch would be needed — not expected here.
   */
  async fetchAllStock(): Promise<EnebaStockNode[]> {
    if (this.isSandbox) return [];

    const nodes: EnebaStockNode[] = [];
    let after: string | null = null;

    do {
      const variables: Record<string, unknown> = { first: 100 };
      if (after) variables.after = after;

      const data = await this.gqlClient.execute<EnebaGetStockData>(
        GET_STOCK_QUERY,
        variables,
      );

      const connection = data.S_stock;
      for (const edge of connection.edges) {
        nodes.push(edge.node);
      }

      after = connection.pageInfo?.hasNextPage
        ? (connection.pageInfo.endCursor ?? null)
        : null;
    } while (after !== null);

    return nodes;
  }
}
