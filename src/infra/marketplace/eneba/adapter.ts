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
} from '../../../core/ports/marketplace-adapter.port.js';
import type { EnebaGraphQLClient } from './graphql-client.js';
import type {
  EnebaSearchProductsData,
  EnebaGetProductData,
  EnebaCompetitionData,
  EnebaCreateAuctionData,
  EnebaUpdateAuctionData,
  EnebaRemoveAuctionData,
  EnebaGetStockData,
  EnebaRegisterCallbackData,
  EnebaGetCallbacksData,
  EnebaEnableDeclaredStockData,
  EnebaUpdateDeclaredStockData,
  EnebaUpdateAuctionPriceData,
  EnebaUpdateStockStatusData,
  EnebaCalculatePriceData,
} from './types.js';
import {
  SEARCH_PRODUCTS_QUERY,
  GET_COMPETITION_QUERY,
  GET_STOCK_QUERY,
  CALCULATE_PRICE_QUERY,
  buildCreateAuctionMutation,
  UPDATE_AUCTION_MUTATION,
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
    ISellerGlobalStockAdapter
{
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
      autoRenew: true,
      price: { amount: params.priceCents, currency: params.currency },
    };

    if (isDeclaredStock) {
      variables.declaredStock = params.quantity ?? 0;
    } else {
      variables.keys = [];
    }

    const mutation = buildCreateAuctionMutation(shape);

    logger.info('S_createAuction', {
      productId: params.externalProductId,
      listingType: params.listingType,
      isSandbox: this.isSandbox,
    });

    const data = await this.gqlClient.execute<EnebaCreateAuctionData>(mutation, variables);
    const result = data.S_createAuction;

    return {
      externalListingId: result.auctionId,
      status: result.success ? 'active' : 'pending',
    };
  }

  async updateListing(params: UpdateListingParams): Promise<UpdateListingResult> {
    const variables: Record<string, unknown> = {
      auctionId: params.externalListingId,
    };

    if (params.priceCents != null) {
      variables.price = { amount: params.priceCents, currency: 'EUR' };
    }
    if (params.quantity != null) {
      variables.declaredStock = params.quantity === 0 ? null : params.quantity;
    }

    const data = await this.gqlClient.execute<EnebaUpdateAuctionData>(
      UPDATE_AUCTION_MUTATION,
      variables,
    );

    return {
      success: data.S_updateAuction.success,
      error: data.S_updateAuction.success ? undefined : 'S_updateAuction returned success: false',
    };
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
    if (quantity === 0) {
      const data = await this.gqlClient.execute<EnebaUpdateAuctionData>(
        UPDATE_AUCTION_MUTATION,
        { auctionId: externalListingId, declaredStock: null },
      );
      return {
        success: data.S_updateAuction.success,
        declaredQuantity: 0,
      };
    }

    const data = await this.gqlClient.execute<EnebaUpdateDeclaredStockData>(
      UPDATE_DECLARED_STOCK_MUTATION,
      {
        statuses: [{ auctionId: externalListingId, declaredStock: quantity }],
      },
    );

    return {
      success: data.P_updateDeclaredStock.success,
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
    if (this.isSandbox) {
      logger.warn('Eneba sandbox does not support S_competition');
      return [];
    }

    const data = await this.gqlClient.execute<EnebaCompetitionData>(
      GET_COMPETITION_QUERY,
      { productIds: [externalProductId] },
    );

    const comp = (data.S_competition ?? []).find(
      (c) => c.productId === externalProductId,
    );
    if (!comp?.competition?.edges?.length) return [];

    const sorted = comp.competition.edges
      .map((e) => e.node)
      .sort((a, b) => a.price.amount - b.price.amount);

    return sorted.map((node) => ({
      merchantName: node.merchantName,
      priceCents: node.price.amount,
      currency: node.price.currency,
      inStock: true,
      isOwnOffer: node.belongsToYou,
    }));
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

    const items = updates.map((u) => ({
      auctionId: u.externalListingId,
      price: { amount: u.priceCents, currency: 'EUR' },
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

    for (const u of nullUpdates) {
      try {
        const data = await this.gqlClient.execute<EnebaUpdateAuctionData>(
          UPDATE_AUCTION_MUTATION,
          { auctionId: u.externalListingId, declaredStock: null },
        );
        if (data.S_updateAuction.success) updated++;
        else failed++;
      } catch (err) {
        logger.warn('Failed to clear declared stock', {
          auctionId: u.externalListingId,
          error: err instanceof Error ? err.message : String(err),
        });
        failed++;
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

  // ─── Queries (exposed for routes that need raw data) ──────────────

  async searchProducts(
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
}
