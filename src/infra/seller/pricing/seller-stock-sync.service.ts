/**
 * Seller stock sync service — cron-driven stock refresh.
 *
 * Queries all active listings with auto_sync_stock=true, computes
 * available key count per variant, and calls marketplace adapter
 * declareStock() or syncStockLevel().
 *
 * Listings with listing_type=declared_stock and auto_sync_stock_follows_provider=true
 * use the same credit-aware selector + per-marketplace disable dispatcher
 * as `ProcurementDeclaredStockReconcileService`. This keeps the two crons
 * in lock-step: stock-sync (every 5 min on minute 2) and
 * declared-stock-reconcile (procurement-driven) cannot disagree on which
 * buyer to lean on.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type {
  IMarketplaceAdapterRegistry,
  BatchDeclaredStockUpdate,
} from '../../../core/ports/marketplace-adapter.port.js';
import type { ISellerStockSyncService, RefreshStockResult } from '../../../core/ports/seller-pricing.port.js';
import type { IBuyerWalletSnapshotter } from '../../../core/ports/buyer-wallet-snapshot.port.js';
import type { IProcurementFxConverter } from '../../../core/ports/procurement-fx-converter.port.js';
import {
  CreditAwareDeclaredStockSelectorUseCase,
  type DeclaredStockOfferRow,
  type DeclaredStockPricingConfig,
} from '../../../core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';
import { parseSellerConfig, type SellerProviderConfig } from '../../../core/use-cases/seller/seller.types.js';
import { mergeSellerListingPricingOverrides } from '../../../core/use-cases/seller/listing-pricing-overrides-merge.js';
import { loadBuyerCapableOffersByVariant } from '../load-procurement-offer-supply.js';
import { dispatchListingDisable } from '../dispatch-listing-disable.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-stock-sync');

interface PendingSyncUpdate {
  readonly listingId: string;
  readonly externalId: string;
  readonly qty: number; // 0 = disable
  readonly disableReason?: string;
}

interface StockListingRow {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_listing_id: string | null;
  listing_type: string;
  status: string;
  declared_stock: number;
  provider_code: string;
  follows_provider: boolean;
  currency: string;
  price_cents: number;
  min_price_cents: number;
  pricing_overrides: Record<string, unknown> | null;
}

@injectable()
export class SellerStockSyncService implements ISellerStockSyncService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.BuyerWalletSnapshotter) private walletSnapshotter: IBuyerWalletSnapshotter,
    @inject(TOKENS.ProcurementFxConverter) private fx: IProcurementFxConverter,
    @inject(TOKENS.CreditAwareDeclaredStockSelector)
    private selector: CreditAwareDeclaredStockSelectorUseCase,
  ) {}

  async refreshAllStock(requestId: string): Promise<RefreshStockResult> {
    const listings = await this.getAutoSyncStockListings();
    if (!listings.length) {
      logger.info('No active auto-sync-stock listings', { requestId });
      return { listingsProcessed: 0, stockUpdated: 0, errors: 0 };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const stockMap = await this.computeAvailableStock(variantIds);

    // Cache provider seller_config so we don't refetch per listing.
    const providerConfigByAccount = await this.loadProviderSellerConfigs(
      [...new Set(listings.map((l) => l.provider_account_id))],
    );

    // ── Credit-gated declared-stock branch ───────────────────────────
    // Build a single wallet snapshot for the whole run + load buyer-capable
    // offers for every variant that has a declared_stock listing whose
    // internal stock is empty.
    const declaredStockListings = listings.filter(
      (l) => l.listing_type === 'declared_stock' && l.follows_provider,
    );
    const variantsNeedingBuyer = [
      ...new Set(
        declaredStockListings
          .filter((l) => (stockMap.get(l.variant_id) ?? 0) === 0)
          .map((l) => l.variant_id),
      ),
    ];
    const walletSnapshot =
      variantsNeedingBuyer.length > 0
        ? await this.walletSnapshotter.snapshot()
        : new Map();
    const offersByVariant = variantsNeedingBuyer.length > 0
      ? await loadBuyerCapableOffersByVariant(this.db, variantsNeedingBuyer)
      : new Map<string, DeclaredStockOfferRow[]>();

    const result: RefreshStockResult = { listingsProcessed: 0, stockUpdated: 0, errors: 0 };

    // Phase 1: Compute decisions. Declared-stock updates are buffered by provider
    // for batch flush in Phase 2. Non-declared-stock listings are handled inline
    // (they use syncStockLevel, which is always individual).
    const pendingDeclaredByProvider = new Map<string, PendingSyncUpdate[]>();

    for (const listing of listings) {
      result.listingsProcessed++;
      if (!listing.external_listing_id) continue;

      try {
        const internalQty = stockMap.get(listing.variant_id) ?? 0;

        if (listing.listing_type === 'declared_stock') {
          await this.collectDeclaredStockDecision(
            requestId,
            listing,
            internalQty,
            offersByVariant.get(listing.variant_id) ?? [],
            walletSnapshot,
            providerConfigByAccount.get(listing.provider_account_id) ?? null,
            pendingDeclaredByProvider,
          );
          continue;
        }

        const adapter = this.registry.getStockSyncAdapter(listing.provider_code);
        if (!adapter) continue;

        const syncResult = await adapter.syncStockLevel(listing.external_listing_id, internalQty);
        if (syncResult.success) {
          await this.db.update('seller_listings', { id: listing.id }, {
            declared_stock: internalQty,
            last_synced_at: new Date().toISOString(),
            error_message: null,
          });
          result.stockUpdated++;
        }
      } catch (err) {
        result.errors++;
        const errMsg = err instanceof Error ? err.message : String(err);
        const errName = err instanceof Error ? err.name : '';
        const isTransient =
          errName === 'CircuitOpenError' ||
          errName === 'RateLimitExceededError' ||
          /^Circuit breaker open for /.test(errMsg) ||
          /^Rate limit exceeded for /.test(errMsg);
        const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
        logFn('Failed to sync stock for listing', {
          requestId, listingId: listing.id, error: errMsg, transient: isTransient,
        });
        try {
          await this.db.update('seller_listings', { id: listing.id }, {
            error_message: `Stock sync failed: ${errMsg || 'unknown'}`,
            last_synced_at: new Date().toISOString(),
          });
        } catch { /* swallow */ }
      }
    }

    // Phase 2: Flush all buffered declared-stock updates — batch for providers
    // that support it (Eneba P_updateDeclaredStock), individual otherwise.
    for (const [providerCode, updates] of pendingDeclaredByProvider) {
      await this.flushDeclaredStockUpdates(requestId, providerCode, updates, result);
    }

    logger.info('Stock sync refresh complete', { requestId, ...result });
    return result;
  }

  /**
   * Flush declared-stock updates for a single provider.
   * Uses batch API when available; falls back to individual calls.
   */
  private async flushDeclaredStockUpdates(
    requestId: string,
    providerCode: string,
    updates: PendingSyncUpdate[],
    result: RefreshStockResult,
  ): Promise<void> {
    const batchAdapter = this.registry.getBatchDeclaredStockAdapter(providerCode);

    if (batchAdapter) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const chunk = updates.slice(i, i + BATCH_SIZE);
        const batchItems: BatchDeclaredStockUpdate[] = chunk.map((u) => ({
          externalListingId: u.externalId,
          quantity: u.qty,
        }));
        try {
          const batchResult = await batchAdapter.batchUpdateDeclaredStock(batchItems);
          if (batchResult.failed === 0) {
            // All succeeded.
            for (const u of chunk) {
              await this.persistSyncUpdate(u);
              result.stockUpdated++;
            }
            logger.info('Stock-sync: batch declared stock flush succeeded', {
              requestId, providerCode, count: chunk.length,
            });
          } else {
            // Partial failure — retry individually.
            logger.info('Stock-sync: batch declared stock had failures, retrying individually', {
              requestId, providerCode, updated: batchResult.updated, failed: batchResult.failed,
            });
            for (const u of chunk) {
              await this.flushSingleDeclaredStock(requestId, providerCode, u, result);
            }
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errName = err instanceof Error ? err.name : '';
          const isTransient =
            errName === 'CircuitOpenError' || errName === 'RateLimitExceededError' ||
            /^Circuit breaker open for /.test(errMsg) || /^Rate limit exceeded for /.test(errMsg);
          const logFn = isTransient ? logger.info.bind(logger) : logger.warn.bind(logger);
          logFn('Stock-sync: batch declared stock threw, retrying individually', {
            requestId, providerCode, count: chunk.length, error: errMsg, transient: isTransient,
          });
          for (const u of chunk) {
            await this.flushSingleDeclaredStock(requestId, providerCode, u, result);
          }
        }
      }
      return;
    }

    for (const u of updates) {
      await this.flushSingleDeclaredStock(requestId, providerCode, u, result);
    }
  }

  private async flushSingleDeclaredStock(
    requestId: string,
    providerCode: string,
    update: PendingSyncUpdate,
    result: RefreshStockResult,
  ): Promise<void> {
    try {
      if (update.qty === 0) {
        await dispatchListingDisable(this.registry, providerCode, update.externalId);
        await this.db.update('seller_listings', { id: update.listingId }, {
          declared_stock: 0,
          last_synced_at: new Date().toISOString(),
          error_message: update.disableReason ?? null,
        });
        result.stockUpdated++;
      } else {
        const adapter = this.registry.getDeclaredStockAdapter(providerCode);
        if (!adapter) return;
        const r = await adapter.declareStock(update.externalId, update.qty);
        if (r.success) {
          await this.persistSyncUpdate(update);
          result.stockUpdated++;
        }
      }
    } catch (err) {
      result.errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : '';
      const isTransient =
        errName === 'CircuitOpenError' || errName === 'RateLimitExceededError' ||
        /^Circuit breaker open for /.test(errMsg) || /^Rate limit exceeded for /.test(errMsg);
      const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
      logFn('Failed to sync stock for listing', {
        requestId, listingId: update.listingId, error: errMsg, transient: isTransient,
      });
      try {
        await this.db.update('seller_listings', { id: update.listingId }, {
          error_message: `Stock sync failed: ${errMsg || 'unknown'}`,
          last_synced_at: new Date().toISOString(),
        });
      } catch { /* swallow */ }
    }
  }

  private async persistSyncUpdate(update: PendingSyncUpdate): Promise<void> {
    await this.db.update('seller_listings', { id: update.listingId }, {
      declared_stock: update.qty,
      last_synced_at: new Date().toISOString(),
      error_message: null,
    });
  }

  // ─── Declared-stock branch (credit-aware, decision-only) ────────────────

  /**
   * Compute the desired declared quantity for this listing and push the
   * decision into `pendingByProvider` for batching. No marketplace API
   * calls are made here — all calls happen in Phase 2 (flushDeclaredStockUpdates).
   */
  private async collectDeclaredStockDecision(
    requestId: string,
    listing: StockListingRow,
    internalQty: number,
    offers: DeclaredStockOfferRow[],
    walletSnapshot: Awaited<ReturnType<IBuyerWalletSnapshotter['snapshot']>>,
    providerSellerConfig: SellerProviderConfig | null,
    pendingByProvider: Map<string, PendingSyncUpdate[]>,
  ): Promise<void> {
    const externalId = listing.external_listing_id;
    if (!externalId) return;

    const push = (update: PendingSyncUpdate) => {
      const bucket = pendingByProvider.get(listing.provider_code) ?? [];
      bucket.push(update);
      pendingByProvider.set(listing.provider_code, bucket);
    };

    // Internal keys cover the listing — declare directly.
    if (internalQty > 0 || !listing.follows_provider) {
      const targetQty = internalQty;
      if (targetQty === listing.declared_stock) return;
      push({ listingId: listing.id, externalId, qty: targetQty });
      return;
    }

    // No internal keys + follows_provider — consult buyer credit.
    const baseConfig = providerSellerConfig ?? parseSellerConfig({});
    const merged = mergeSellerListingPricingOverrides(baseConfig, listing.pricing_overrides);

    const salePriceUsd =
      (await this.fx.toUsdCents(listing.price_cents, listing.currency)) ?? 0;
    const listingMinUsd =
      (await this.fx.toUsdCents(listing.min_price_cents, listing.currency)) ?? 0;
    const minFloorUsd =
      (await this.fx.toUsdCents(merged.min_price_floor_cents, baseConfig.default_currency))
      ?? merged.min_price_floor_cents;

    const cfg: DeclaredStockPricingConfig = {
      sellerSalePriceUsdCents: salePriceUsd,
      minProfitMarginPct: merged.min_profit_margin_pct,
      commissionRatePercent: merged.commission_rate_percent,
      minPriceFloorUsdCents: minFloorUsd,
      listingMinUsdCents: listingMinUsd,
      requestedQty: 1,
    };

    const decision = await this.selector.execute({ offers, snapshot: walletSnapshot, config: cfg });

    if (decision.kind === 'declare') {
      logger.info('Stock-sync: declaring stock from credited buyer', {
        requestId, listingId: listing.id,
        buyerProviderCode: decision.offer.provider_code,
        buyerProviderAccountId: decision.offer.provider_account_id,
        declaredQty: decision.declaredQty,
      });
      push({ listingId: listing.id, externalId, qty: decision.declaredQty });
      return;
    }

    // Disable — skip if already at 0 to avoid burning marketplace rate limits.
    if (listing.declared_stock === 0) {
      await this.db.update('seller_listings', { id: listing.id }, {
        last_synced_at: new Date().toISOString(),
        error_message: null,
      });
      return;
    }

    logger.info('Stock-sync: dispatching marketplace disable', {
      requestId, listingId: listing.id, providerCode: listing.provider_code,
      reason: decision.reason,
    });
    push({ listingId: listing.id, externalId, qty: 0, disableReason: decision.reason });
  }

  private async computeAvailableStock(variantIds: string[]): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();
    if (variantIds.length === 0) return stockMap;

    try {
      const data = await this.db.rpc<Array<{ variant_id: string; available_count: number }>>(
        'get_batch_available_keys_count',
        { variant_uuids: variantIds },
      );

      for (const row of data ?? []) {
        stockMap.set(row.variant_id, row.available_count);
      }
    } catch (err) {
      logger.error('Failed to compute available stock', {
        variantCount: variantIds.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return stockMap;
  }

  private async loadProviderSellerConfigs(
    accountIds: string[],
  ): Promise<Map<string, SellerProviderConfig>> {
    const out = new Map<string, SellerProviderConfig>();
    if (accountIds.length === 0) return out;

    const rows = await this.db.query<{
      id: string;
      seller_config: Record<string, unknown> | null;
    }>('provider_accounts', {
      select: 'id, seller_config',
      in: [['id', accountIds]],
    });
    for (const r of rows) {
      out.set(r.id, parseSellerConfig(r.seller_config ?? {}));
    }
    return out;
  }

  private async getAutoSyncStockListings(): Promise<StockListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [
        ['auto_sync_stock', true],
      ],
    });

    const activeOrPaused = rows.filter((r) =>
      r.status === 'active' || r.status === 'paused',
    );

    const accountIds = [...new Set(activeOrPaused.map((r) => r.provider_account_id as string))];
    const accountMap = new Map<string, string>();

    for (const accountId of accountIds) {
      const account = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
        filter: { id: accountId },
      });
      if (account) accountMap.set(accountId, account.provider_code);
    }

    const enriched: StockListingRow[] = [];
    for (const row of activeOrPaused) {
      const providerCode = accountMap.get(row.provider_account_id as string);
      if (!providerCode) continue;
      enriched.push({
        id: row.id as string,
        variant_id: row.variant_id as string,
        provider_account_id: row.provider_account_id as string,
        external_listing_id: (row.external_listing_id as string) ?? null,
        listing_type: row.listing_type as string,
        status: row.status as string,
        declared_stock: (row.declared_stock as number) ?? 0,
        provider_code: providerCode,
        follows_provider: row.auto_sync_stock_follows_provider === true,
        currency: typeof row.currency === 'string' ? (row.currency as string) : 'USD',
        price_cents: typeof row.price_cents === 'number' ? (row.price_cents as number) : 0,
        min_price_cents:
          typeof row.min_price_cents === 'number' ? (row.min_price_cents as number) : 0,
        pricing_overrides:
          row.pricing_overrides && typeof row.pricing_overrides === 'object' && !Array.isArray(row.pricing_overrides)
            ? (row.pricing_overrides as Record<string, unknown>)
            : null,
      });
    }

    return enriched;
  }
}
