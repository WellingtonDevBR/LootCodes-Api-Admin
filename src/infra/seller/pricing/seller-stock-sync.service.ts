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
  BatchPriceUpdate,
} from '../../../core/ports/marketplace-adapter.port.js';
import type { ISellerStockSyncService, RefreshStockResult } from '../../../core/ports/seller-pricing.port.js';
import type { IBuyerWalletSnapshotter } from '../../../core/ports/buyer-wallet-snapshot.port.js';
import { getSpendableCentsFromSnapshot } from '../../../core/ports/buyer-wallet-snapshot.port.js';
import type { IProcurementFxConverter } from '../../../core/ports/procurement-fx-converter.port.js';
import { MAX_PROCUREMENT_DECLARED_STOCK } from '../../../core/shared/procurement-declared-stock.js';
import { computeStrategyAwareCorrectedPrice } from '../compute-strategy-aware-correction.js';
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
  /** When set, push this corrected price to the marketplace before declaring stock. */
  readonly correctedPriceCents?: number;
  readonly correctedPriceCurrency?: string;
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
    return this.processListings(requestId, listings);
  }

  async refreshOneListing(requestId: string, listingId: string): Promise<RefreshStockResult> {
    const listings = await this.getAutoSyncStockListingById(listingId);
    if (!listings.length) {
      logger.info('refreshOneListing: listing not eligible (missing or auto_sync_stock=false)', {
        requestId, listingId,
      });
      return { listingsProcessed: 0, stockUpdated: 0, errors: 0 };
    }
    return this.processListings(requestId, listings);
  }

  /**
   * Shared processing pipeline used by both the cron (`refreshAllStock`) and
   * the operator-driven manual sync (`refreshOneListing`). Builds the wallet
   * snapshot ONCE per call, batches declared-stock updates per provider, and
   * inlines non-declared-stock (`syncStockLevel`) updates.
   */
  private async processListings(
    requestId: string,
    listings: StockListingRow[],
  ): Promise<RefreshStockResult> {
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

        // Apply price corrections before declaring stock.
        const priceCorrections = chunk.filter(
          (u) => u.qty > 0 && u.correctedPriceCents != null && u.correctedPriceCents > 0,
        );
        if (priceCorrections.length > 0) {
          await this.flushBatchPriceCorrections(requestId, providerCode, priceCorrections, result);
        }

        const batchItems: BatchDeclaredStockUpdate[] = chunk.map((u) => ({
          externalListingId: u.externalId,
          quantity: u.qty,
        }));
        try {
          const batchResult = await batchAdapter.batchUpdateDeclaredStock(batchItems);
          if (batchResult.failed === 0) {
            for (const u of chunk) {
              await this.persistSyncUpdate(u);
              result.stockUpdated++;
            }
            logger.info('Stock-sync: batch declared stock flush succeeded', {
              requestId, providerCode, count: chunk.length,
            });
          } else {
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
        // Apply price correction first if needed.
        if (update.correctedPriceCents != null && update.correctedPriceCents > 0) {
          await this.applyPriceCorrection(requestId, providerCode, update, result);
        }
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

  private async flushBatchPriceCorrections(
    requestId: string,
    providerCode: string,
    corrections: PendingSyncUpdate[],
    result: RefreshStockResult,
  ): Promise<void> {
    const priceUpdates: BatchPriceUpdate[] = corrections.map((u) => ({
      externalListingId: u.externalId,
      priceCents: u.correctedPriceCents!,
      currency: u.correctedPriceCurrency,
    }));

    const batchPriceAdapter = this.registry.getBatchPriceAdapter(providerCode);
    if (batchPriceAdapter) {
      try {
        const r = await batchPriceAdapter.batchUpdatePrices(priceUpdates);
        logger.info('Stock-sync: batch price correction applied', {
          requestId, providerCode, updated: r.updated, failed: r.failed,
        });
        for (const correction of corrections) {
          await this.db.update('seller_listings', { id: correction.listingId }, {
            price_cents: correction.correctedPriceCents,
            updated_at: new Date().toISOString(),
          });
        }
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn('Stock-sync: batch price correction failed, trying individually', {
          requestId, providerCode, error: errMsg,
        });
      }
    }

    const listingAdapter = this.registry.getListingAdapter(providerCode);
    for (const correction of corrections) {
      try {
        if (listingAdapter) {
          await listingAdapter.updateListing({
            externalListingId: correction.externalId,
            priceCents: correction.correctedPriceCents!,
            currency: correction.correctedPriceCurrency,
          });
        }
        await this.db.update('seller_listings', { id: correction.listingId }, {
          price_cents: correction.correctedPriceCents,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        result.errors++;
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn('Stock-sync: individual price correction failed', {
          requestId, listingId: correction.listingId,
          correctedPriceCents: correction.correctedPriceCents, error: errMsg,
        });
      }
    }
  }

  private async applyPriceCorrection(
    requestId: string,
    providerCode: string,
    update: PendingSyncUpdate,
    result: RefreshStockResult,
  ): Promise<void> {
    try {
      const batchPriceAdapter = this.registry.getBatchPriceAdapter(providerCode);
      if (batchPriceAdapter) {
        await batchPriceAdapter.batchUpdatePrices([{
          externalListingId: update.externalId,
          priceCents: update.correctedPriceCents!,
          currency: update.correctedPriceCurrency,
        }]);
      } else {
        const listingAdapter = this.registry.getListingAdapter(providerCode);
        if (listingAdapter) {
          await listingAdapter.updateListing({
            externalListingId: update.externalId,
            priceCents: update.correctedPriceCents!,
            currency: update.correctedPriceCurrency,
          });
        }
      }
      await this.db.update('seller_listings', { id: update.listingId }, {
        price_cents: update.correctedPriceCents,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      result.errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn('Stock-sync: price correction failed, will still declare stock', {
        requestId, listingId: update.listingId,
        correctedPriceCents: update.correctedPriceCents, error: errMsg,
      });
    }
  }

  private async persistSyncUpdate(update: PendingSyncUpdate): Promise<void> {
    await this.db.update('seller_listings', { id: update.listingId }, {
      declared_stock: update.qty,
      last_synced_at: new Date().toISOString(),
      error_message: null,
    });
  }

  private async findCheapestCreditedOffer(
    offers: DeclaredStockOfferRow[],
    snapshot: Awaited<ReturnType<IBuyerWalletSnapshotter['snapshot']>>,
  ): Promise<{ offer: DeclaredStockOfferRow; unitCostUsdCents: number } | null> {
    const ranked: Array<{ offer: DeclaredStockOfferRow; unitCostUsdCents: number }> = [];
    for (const offer of offers) {
      if (offer.last_price_cents == null || offer.last_price_cents <= 0) continue;
      const usd = await this.fx.toUsdCents(offer.last_price_cents, offer.currency);
      if (usd == null || !Number.isFinite(usd) || usd <= 0) continue;
      ranked.push({ offer, unitCostUsdCents: usd });
    }
    ranked.sort((a, b) => a.unitCostUsdCents - b.unitCostUsdCents);
    for (const candidate of ranked) {
      const spendable = getSpendableCentsFromSnapshot(
        snapshot,
        candidate.offer.provider_account_id,
        candidate.offer.currency,
      );
      if (spendable >= (candidate.offer.last_price_cents ?? 0)) {
        return candidate;
      }
    }
    return null;
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
    // Pricing cron is responsible for ensuring the price is profitable before
    // this point; stock cron only decides whether supply exists.
    const baseConfig = providerSellerConfig ?? parseSellerConfig({});
    const merged = mergeSellerListingPricingOverrides(baseConfig, listing.pricing_overrides);

    const salePriceUsd =
      (await this.fx.toUsdCents(listing.price_cents, listing.currency)) ?? 0;
    const listingMinUsd =
      (await this.fx.toUsdCents(listing.min_price_cents, listing.currency)) ?? 0;
    const minFloorUsd =
      (await this.fx.toUsdCents(merged.min_price_floor_cents, baseConfig.default_currency))
      ?? merged.min_price_floor_cents;
    // FX-convert per-sale fixed fee so the selector can apply it correctly.
    const fixedFeeUsd =
      (await this.fx.toUsdCents(merged.fixed_fee_cents, baseConfig.default_currency))
      ?? merged.fixed_fee_cents;

    // For seller_price adapters (e.g. Eneba with priceIWantToGet), listing.price_cents
    // already stores the NET payout. Pass it directly as netPayoutUsdCents to avoid
    // the selector double-deducting commission on an already-net value.
    const pricingModel = this.registry.getPricingAdapter(listing.provider_code)?.pricingModel;
    const netPayoutUsdCents =
      pricingModel === 'seller_price' && salePriceUsd > 0 ? salePriceUsd : undefined;

    const cfg: DeclaredStockPricingConfig = {
      sellerSalePriceUsdCents: salePriceUsd,
      minProfitMarginPct: merged.min_profit_margin_pct,
      commissionRatePercent: merged.commission_rate_percent,
      minPriceFloorUsdCents: minFloorUsd,
      listingMinUsdCents: listingMinUsd,
      fixedFeeUsdCents: fixedFeeUsd,
      ...(netPayoutUsdCents != null ? { netPayoutUsdCents } : {}),
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

    if (decision.reason === 'uneconomic') {
      // Price below procurement cost floor — find cheapest credited offer,
      // correct the price to floor + strategy, and declare stock. Never block
      // declaration due to stale/wrong price; fix the price and sell.
      const cheapest = await this.findCheapestCreditedOffer(offers, walletSnapshot);
      if (cheapest) {
        const correctedPriceCents = await computeStrategyAwareCorrectedPrice({
          db: this.db,
          fx: this.fx,
          listingId: listing.id,
          listingCurrency: listing.currency,
          offerCostUsdCents: cheapest.unitCostUsdCents,
          marginPct: merged.min_profit_margin_pct,
          commissionPct: merged.commission_rate_percent,
          fixedFeeCents: merged.fixed_fee_cents,
          priceStrategy: merged.price_strategy,
          priceStrategyValue: merged.price_strategy_value,
          pricingModel,
          competitorCacheMaxAgeMs: merged.competitor_cache_max_age_ms,
        });
        const declaredQty = Math.min(
          Math.max(1, Math.trunc(cheapest.offer.available_quantity ?? 1)),
          MAX_PROCUREMENT_DECLARED_STOCK,
        );
        logger.info('Stock-sync: price below floor — correcting price and declaring', {
          requestId, listingId: listing.id, providerCode: listing.provider_code,
          currentPriceCents: listing.price_cents,
          correctedPriceCents,
          currency: listing.currency,
          buyerProviderCode: cheapest.offer.provider_code,
          declaredQty,
        });
        push({ listingId: listing.id, externalId, qty: declaredQty, correctedPriceCents, correctedPriceCurrency: listing.currency });
        return;
      }
      // No credited offer found after all — treat as no_credit.
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
    return this.enrichListingRows(rows);
  }

  /**
   * Single-listing variant of {@link getAutoSyncStockListings}. Returns an
   * empty array when the listing is missing, has `auto_sync_stock=false`,
   * or is not in an `active`/`paused` state — callers treat that as "skip".
   */
  private async getAutoSyncStockListingById(listingId: string): Promise<StockListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [
        ['id', listingId],
        ['auto_sync_stock', true],
      ],
    });
    return this.enrichListingRows(rows);
  }

  private async enrichListingRows(
    rows: Record<string, unknown>[],
  ): Promise<StockListingRow[]> {
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
