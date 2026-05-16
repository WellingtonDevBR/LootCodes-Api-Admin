/**
 * HTTP cron entry: reconcile declared_stock on seller listings that mirror procurement supply.
 *
 * Credit-aware variant: snapshots every buyer-capable provider's wallet ONCE
 * per run, then for each listing picks the cheapest USD-normalized buyer
 * that has credit AND respects the listing's pricing-strategy floor. When
 * none qualify, dispatches the per-marketplace "stop selling" signal
 * (Eneba `declaredStock=null`, Kinguin `status=INACTIVE`, …) — see
 * `docs/declared-stock-disable.md`.
 *
 * The DB `seller_listings.status` stays `active` so next cycle (5 min) the
 * listing auto-recovers the moment a buyer wallet refills or pricing turns
 * favorable.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase, QueryOptions } from '../../core/ports/database.port.js';
import type {
  IMarketplaceAdapterRegistry,
  BatchDeclaredStockUpdate,
  BatchPriceUpdate,
  ISellerBatchDeclaredStockAdapter,
} from '../../core/ports/marketplace-adapter.port.js';
import type {
  IProcurementDeclaredStockReconcileService,
  ProcurementDeclaredStockReconcileDto,
  ProcurementDeclaredStockReconcileFailure,
  ProcurementDeclaredStockReconcileResult,
} from '../../core/ports/procurement-declared-stock-reconcile.port.js';
import type { IBuyerWalletSnapshotter, WalletSnapshot } from '../../core/ports/buyer-wallet-snapshot.port.js';
import { getSpendableCentsFromSnapshot } from '../../core/ports/buyer-wallet-snapshot.port.js';
import type { IProcurementFxConverter } from '../../core/ports/procurement-fx-converter.port.js';
import {
  CreditAwareDeclaredStockSelectorUseCase,
  type DeclaredStockOfferRow,
  type DeclaredStockPricingConfig,
  type DeclaredStockSelectorResult,
} from '../../core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';
import { parseSellerConfig, type SellerProviderConfig } from '../../core/use-cases/seller/seller.types.js';
import { mergeSellerListingPricingOverrides } from '../../core/use-cases/seller/listing-pricing-overrides-merge.js';
import {
  pessimisticSaleCents,
  readLastRealizedNet,
} from '../../core/shared/last-realized-net.js';
import { MAX_PROCUREMENT_DECLARED_STOCK } from '../../core/shared/procurement-declared-stock.js';
import { computeStrategyAwareCorrectedPrice } from './compute-strategy-aware-correction.js';
import { loadBuyerCapableOffersByVariant } from './load-procurement-offer-supply.js';
import { dispatchListingDisable } from './dispatch-listing-disable.js';
import { isTransientMarketplaceError } from './recognize-transient-marketplace-error.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('procurement-declared-stock-reconcile');

const DEFAULT_BATCH_LIMIT = 500;

/** A resolved stock-declare/disable intent buffered before flushing to marketplace APIs. */
interface PendingStockUpdate {
  readonly listingId: string;
  readonly externalId: string;
  /** qty > 0 = declare; qty === 0 = disable */
  readonly qty: number;
  readonly disableReason?: 'no_offer' | 'no_credit' | 'uneconomic';
  /**
   * When set, the listing price was below the procurement cost floor and must
   * be corrected on the marketplace BEFORE declaring stock. The flush phase
   * calls the batch-price or updateListing adapter first, then declares stock.
   * This guarantees we never block stock declaration due to a stale/low price —
   * we simply raise the price to floor and declare.
   */
  readonly correctedPriceCents?: number;
  readonly correctedPriceCurrency?: string;
}

interface ListingRow {
  readonly id: string;
  readonly variant_id: string;
  readonly provider_account_id: string;
  readonly external_listing_id: string | null;
  readonly external_product_id: string | null;
  readonly listing_type: string;
  readonly status: string;
  readonly declared_stock: number;
  readonly auto_sync_stock_follows_provider: boolean;
  readonly currency: string;
  readonly price_cents: number;
  readonly min_price_cents: number;
  readonly pricing_overrides: Record<string, unknown> | null;
  readonly provider_metadata: Record<string, unknown> | null;
}

interface ProviderAccountRow {
  readonly id: string;
  readonly provider_code: string;
  readonly seller_config: SellerProviderConfig;
}

@injectable()
export class ProcurementDeclaredStockReconcileService implements IProcurementDeclaredStockReconcileService {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private readonly registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.BuyerWalletSnapshotter) private readonly walletSnapshotter: IBuyerWalletSnapshotter,
    @inject(TOKENS.ProcurementFxConverter) private readonly fx: IProcurementFxConverter,
    @inject(TOKENS.CreditAwareDeclaredStockSelector)
    private readonly selector: CreditAwareDeclaredStockSelectorUseCase,
  ) {}

  async execute(requestId: string, dto: ProcurementDeclaredStockReconcileDto): Promise<ProcurementDeclaredStockReconcileResult> {
    const batchLimit = Math.min(Math.max(dto.batch_limit ?? DEFAULT_BATCH_LIMIT, 1), 5000);
    const dryRun = dto.dry_run === true;

    const listings = await this.loadEligibleListings(dto.variant_ids, batchLimit);
    if (listings.length === 0) {
      logger.info('No eligible procurement-linked seller listings', { requestId });
      return { dry_run: dryRun, scanned: 0, updated: 0, skipped: 0, failures: [] };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const internalMap = await this.computeAvailableStock(variantIds);
    const accountIds = [...new Set(listings.map((l) => l.provider_account_id))];
    const accountMap = await this.loadProviderAccounts(accountIds);

    // One-shot wallet snapshot — every listing reuses this map. Avoids the
    // N×M live wallet calls that would otherwise hammer Bamboo / AppRoute.
    const walletSnapshot = await this.walletSnapshotter.snapshot();
    const offersByVariant = await loadBuyerCapableOffersByVariant(this.db, variantIds);

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    const failures: ProcurementDeclaredStockReconcileFailure[] = [];

    // Phase 1: Compute decisions for every listing (no marketplace stock API calls).
    // Buffer all intended updates keyed by provider_code so Phase 2 can batch them.
    const pendingByProvider = new Map<string, PendingStockUpdate[]>();

    for (const listing of listings) {
      scanned++;
      const account = accountMap.get(listing.provider_account_id);
      if (!account) { skipped++; continue; }
      if (!listing.external_listing_id) { skipped++; continue; }
      if (listing.listing_type !== 'declared_stock') { skipped++; continue; }

      const internalQty = internalMap.get(listing.variant_id) ?? 0;

      if (internalQty > 0) {
        // Skip the API call when nothing has changed — avoids burning marketplace
        // API quota (e.g. Digiseller's 2000 edits/day limit) on no-op updates.
        if (internalQty === listing.declared_stock) {
          skipped++;
          continue;
        }

        // Internal keys cover this listing — declare directly.
        logger.info('Reconcile: pushing internal stock to marketplace', {
          requestId, listingId: listing.id, providerCode: account.provider_code, qty: internalQty,
          previousDeclaredStock: listing.declared_stock,
        });
        if (!dryRun) {
          const pending = pendingByProvider.get(account.provider_code) ?? [];
          pending.push({ listingId: listing.id, externalId: listing.external_listing_id, qty: internalQty });
          pendingByProvider.set(account.provider_code, pending);
          updated++;
        }
        continue;
      }

      const offers = offersByVariant.get(listing.variant_id) ?? [];
      const decision = await this.runSelector(account, listing, offers, walletSnapshot);

      if (dryRun) {
        if (decision.kind === 'declare') updated++;
        else skipped++;
        continue;
      }

      if (decision.kind === 'declare') {
        // Loss-prevention guard: even when the strict economic gate passes,
        // verify `listing.price_cents` covers the cost+margin floor at THIS
        // very moment. The pricing cron may not have caught up to a recent
        // cost-basis change, smart-compete may have dragged the price down,
        // or the listing may have been edited manually. Any of those leaves
        // a window where we'd declare positive stock at a price that JIT
        // will then refuse — the exact loop documented in
        // `core/shared/last-realized-net.ts`.
        //
        // Compute the strategy-aware floor and, if `listing.price_cents` is
        // below it, augment this declared-stock update with a price
        // correction. Marketplace adapters that support batch updates push
        // both fields in one API call (Eneba batch, Gamivo PUT) — no extra
        // quota burn vs the existing `declare` path.
        const mergedConfig = mergeSellerListingPricingOverrides(account.seller_config, listing.pricing_overrides);
        const pricingModel = this.registry.getPricingAdapter(account.provider_code)?.pricingModel;
        const requiredFloorCents = await computeStrategyAwareCorrectedPrice({
          db: this.db,
          fx: this.fx,
          listingId: listing.id,
          listingCurrency: listing.currency,
          offerCostUsdCents: decision.costBasisUsdCents,
          marginPct: mergedConfig.min_profit_margin_pct,
          commissionPct: mergedConfig.commission_rate_percent,
          fixedFeeCents: mergedConfig.fixed_fee_cents,
          priceStrategy: mergedConfig.price_strategy,
          priceStrategyValue: mergedConfig.price_strategy_value,
          pricingModel,
          competitorCacheMaxAgeMs: mergedConfig.competitor_cache_max_age_ms,
        });
        const needsPriceCorrection = listing.price_cents < requiredFloorCents;

        // Skip the API call entirely when nothing changed (declared_stock
        // already matches AND price is safely above the floor) — preserves
        // marketplace API quota.
        if (decision.declaredQty === listing.declared_stock && !needsPriceCorrection) {
          skipped++;
          continue;
        }

        logger.info('Reconcile: declaring stock from credited buyer', {
          requestId, listingId: listing.id, providerCode: account.provider_code,
          buyerProviderCode: decision.offer.provider_code,
          buyerProviderAccountId: decision.offer.provider_account_id,
          declaredQty: decision.declaredQty,
          previousDeclaredStock: listing.declared_stock,
          costBasisUsdCents: decision.costBasisUsdCents,
          currentPriceCents: listing.price_cents,
          requiredFloorCents,
          needsPriceCorrection,
        });
        const pending = pendingByProvider.get(account.provider_code) ?? [];
        pending.push({
          listingId: listing.id,
          externalId: listing.external_listing_id,
          qty: decision.declaredQty,
          ...(needsPriceCorrection ? {
            correctedPriceCents: requiredFloorCents,
            correctedPriceCurrency: listing.currency,
          } : {}),
        });
        pendingByProvider.set(account.provider_code, pending);
        updated++;
      } else if (decision.reason === 'uneconomic') {
        // The listing price is currently below the procurement cost floor.
        // Rule: never block stock declaration due to price — instead raise the
        // price to floor AND apply the configured pricing strategy on top
        // (e.g. match_lowest competitor). Then declare stock.
        const mergedConfig = mergeSellerListingPricingOverrides(account.seller_config, listing.pricing_overrides);
        const cheapest = await this.findCheapestCreditedOffer(offers, walletSnapshot);
        if (cheapest) {
          const pricingModel = this.registry.getPricingAdapter(account.provider_code)?.pricingModel;
          const correctedPriceCents = await computeStrategyAwareCorrectedPrice({
            db: this.db,
            fx: this.fx,
            listingId: listing.id,
            listingCurrency: listing.currency,
            offerCostUsdCents: cheapest.unitCostUsdCents,
            marginPct: mergedConfig.min_profit_margin_pct,
            commissionPct: mergedConfig.commission_rate_percent,
            fixedFeeCents: mergedConfig.fixed_fee_cents,
            priceStrategy: mergedConfig.price_strategy,
            priceStrategyValue: mergedConfig.price_strategy_value,
            pricingModel,
            competitorCacheMaxAgeMs: mergedConfig.competitor_cache_max_age_ms,
          });
          const declaredQty = Math.min(
            Math.max(1, Math.trunc(cheapest.offer.available_quantity ?? 1)),
            MAX_PROCUREMENT_DECLARED_STOCK,
          );
          logger.info('Reconcile: price below floor — correcting price and declaring', {
            requestId, listingId: listing.id, providerCode: account.provider_code,
            currentPriceCents: listing.price_cents,
            correctedPriceCents,
            currency: listing.currency,
            buyerProviderCode: cheapest.offer.provider_code,
            declaredQty,
          });
          const pending = pendingByProvider.get(account.provider_code) ?? [];
          pending.push({
            listingId: listing.id, externalId: listing.external_listing_id,
            qty: declaredQty,
            correctedPriceCents,
            correctedPriceCurrency: listing.currency,
          });
          pendingByProvider.set(account.provider_code, pending);
          updated++;
        } else {
          // Selector saw credit but then we couldn't find any — treat as no_credit.
          logger.info('Reconcile: dispatching marketplace disable', {
            requestId, listingId: listing.id, providerCode: account.provider_code, reason: 'no_credit',
          });
          const pending = pendingByProvider.get(account.provider_code) ?? [];
          pending.push({ listingId: listing.id, externalId: listing.external_listing_id, qty: 0, disableReason: 'no_credit' });
          pendingByProvider.set(account.provider_code, pending);
          updated++;
        }
      } else {
        logger.info('Reconcile: dispatching marketplace disable', {
          requestId, listingId: listing.id, providerCode: account.provider_code, reason: decision.reason,
        });
        const pending = pendingByProvider.get(account.provider_code) ?? [];
        pending.push({
          listingId: listing.id, externalId: listing.external_listing_id,
          qty: 0, disableReason: decision.reason,
        });
        pendingByProvider.set(account.provider_code, pending);
        updated++;
      }
    }

    // Phase 2: Flush all buffered updates — batch for providers that support it,
    // individual fallback for the rest.
    for (const [providerCode, updates] of pendingByProvider) {
      await this.flushProviderUpdates(requestId, providerCode, updates, failures);
    }

    logger.info('Procurement declared stock reconcile complete', {
      requestId,
      dryRun,
      scanned,
      updated,
      skipped,
      failures: failures.length,
    });

    return { dry_run: dryRun, scanned, updated, skipped, failures };
  }

  // ─── Phase 2: Marketplace flush ───────────────────────────────────────

  /**
   * Flush all buffered stock updates for one provider.
   * Uses batch API when available (e.g. Eneba P_updateDeclaredStock up to 50 items
   * in one GraphQL call) to stay within rate limits; falls back to individual
   * `declareStock` / `dispatchListingDisable` calls for providers without batch support.
   */
  private async flushProviderUpdates(
    requestId: string,
    providerCode: string,
    updates: PendingStockUpdate[],
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    const batchAdapter = this.registry.getBatchDeclaredStockAdapter(providerCode);

    if (batchAdapter) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const chunk = updates.slice(i, i + BATCH_SIZE);
        await this.flushBatch(requestId, providerCode, chunk, batchAdapter, failures);
      }
      return;
    }

    // Individual fallback for providers without batch support.
    for (const update of updates) {
      await this.flushSingle(requestId, providerCode, update, failures);
    }
  }

  private async flushBatch(
    requestId: string,
    providerCode: string,
    chunk: PendingStockUpdate[],
    batchAdapter: ISellerBatchDeclaredStockAdapter,
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    // Price corrections must be pushed BEFORE declaring stock so the listing
    // is never sold below cost. Batch-price-update the corrected items first.
    const priceCorrections = chunk.filter(
      (u) => u.qty > 0 && u.correctedPriceCents != null && u.correctedPriceCents > 0,
    );
    if (priceCorrections.length > 0) {
      await this.flushBatchPriceCorrections(requestId, providerCode, priceCorrections, failures);
    }

    const batchItems: BatchDeclaredStockUpdate[] = chunk.map((u) => ({
      externalListingId: u.externalId,
      quantity: u.qty,
    }));

    try {
      const result = await batchAdapter.batchUpdateDeclaredStock(batchItems);

      if (result.failed === 0) {
        for (const update of chunk) {
          if (update.qty === 0) {
            await this.db.update('seller_listings', { id: update.listingId }, {
              declared_stock: 0,
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              error_message: update.disableReason ?? 'disabled',
            });
          } else {
            await this.persistSuccess(update.listingId, update.qty);
          }
        }
        logger.info('Reconcile: batch stock flush succeeded', {
          requestId, providerCode, count: chunk.length,
        });
      } else {
        logger.info('Reconcile: batch stock flush had failures, retrying individually', {
          requestId, providerCode, updated: result.updated, failed: result.failed,
        });
        for (const update of chunk) {
          await this.flushSingle(requestId, providerCode, update, failures);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = isTransientMarketplaceError(err);
      const logFn = isTransient ? logger.info.bind(logger) : logger.warn.bind(logger);
      logFn('Reconcile: batch stock flush threw, retrying individually', {
        requestId, providerCode, count: chunk.length, error: msg, transient: isTransient,
      });
      for (const update of chunk) {
        await this.flushSingle(requestId, providerCode, update, failures);
      }
    }
  }

  /**
   * Batch-price-update all listings whose price is below procurement floor.
   * Uses the batch-price adapter when available (Eneba P_updateAuctionPrice),
   * falls back to individual updateListing calls. Price updates are best-effort:
   * if they fail we still proceed to declare stock and log the error.
   */
  private async flushBatchPriceCorrections(
    requestId: string,
    providerCode: string,
    corrections: PendingStockUpdate[],
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    const priceUpdates: BatchPriceUpdate[] = corrections.map((u) => ({
      externalListingId: u.externalId,
      priceCents: u.correctedPriceCents!,
      currency: u.correctedPriceCurrency,
    }));

    const batchPriceAdapter = this.registry.getBatchPriceAdapter(providerCode);
    if (batchPriceAdapter) {
      try {
        const result = await batchPriceAdapter.batchUpdatePrices(priceUpdates);
        logger.info('Reconcile: batch price correction applied', {
          requestId, providerCode, updated: result.updated, failed: result.failed,
        });
        if (result.updated > 0) {
          // Persist corrected prices in DB for listings that succeeded.
          for (const correction of corrections) {
            await this.db.update('seller_listings', { id: correction.listingId }, {
              price_cents: correction.correctedPriceCents,
              updated_at: new Date().toISOString(),
            });
          }
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Reconcile: batch price correction failed, trying individually', {
          requestId, providerCode, error: msg,
        });
      }
    }

    // Individual fallback.
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
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Reconcile: individual price correction failed', {
          requestId, providerCode, listingId: correction.listingId,
          correctedPriceCents: correction.correctedPriceCents, error: msg,
        });
        failures.push({ listing_id: correction.listingId, reason: `price_correction_failed: ${msg}` });
      }
    }
  }

  private async flushSingle(
    requestId: string,
    providerCode: string,
    update: PendingStockUpdate,
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    try {
      if (update.qty === 0) {
        const r = await dispatchListingDisable(this.registry, providerCode, update.externalId);
        if (!r.success) {
          failures.push({ listing_id: update.listingId, reason: r.error ?? `disable_${update.disableReason ?? 'unknown'}_failed` });
        }
        await this.db.update('seller_listings', { id: update.listingId }, {
          declared_stock: 0,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: update.disableReason ?? 'disabled',
        });
      } else {
        // If this listing has a price correction, push the price first.
        if (update.correctedPriceCents != null && update.correctedPriceCents > 0) {
          await this.applyPriceCorrection(requestId, providerCode, update, failures);
        }

        const adapter = this.registry.getDeclaredStockAdapter(providerCode);
        if (!adapter) {
          failures.push({ listing_id: update.listingId, reason: `no_declared_stock_adapter:${providerCode}` });
          return;
        }
        const r = await adapter.declareStock(update.externalId, update.qty);
        if (!r.success) {
          failures.push({ listing_id: update.listingId, reason: r.error ?? 'declare_stock_failed' });
          await this.persistError(update.listingId, r.error ?? 'declare_stock_failed');
          return;
        }
        const applied = typeof r.declaredQuantity === 'number' && Number.isFinite(r.declaredQuantity)
          ? r.declaredQuantity : update.qty;
        await this.persistSuccess(update.listingId, applied);
      }
    } catch (err) {
      // For transient errors (rate limits, circuit breakers), optimistically
      // record the intended quantity in the DB so the "skip if unchanged" check
      // fires on the next cron tick. Without this, the listing retries every
      // 5 minutes because declared_stock in the DB never matches the actual
      // stock, burning the daily edit quota in a vicious loop.
      //
      // For declare updates (qty > 0): persistSuccess records the desired qty
      // and clears any stale error_message.
      // For disable updates (qty === 0): we only update declared_stock + synced_at
      // so the skip check fires; error_message is left to recordFailure → persistError.
      //
      // Self-correction: when rate limit resets and actual stock changes by ≥1
      // key (sale or upload), the skip check fails and the listing resyncs correctly.
      if (isTransientMarketplaceError(err)) {
        if (update.qty > 0) {
          void this.persistSuccess(update.listingId, update.qty).catch(() => {});
        } else {
          void this.db.update('seller_listings', { id: update.listingId }, {
            declared_stock: 0,
            last_synced_at: new Date().toISOString(),
          }).catch(() => {});
        }
      }
      this.recordFailure(requestId, update.listingId, err, failures);
    }
  }

  private async applyPriceCorrection(
    requestId: string,
    providerCode: string,
    update: PendingStockUpdate,
    failures: ProcurementDeclaredStockReconcileFailure[],
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
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('Reconcile: price correction failed, will still declare stock', {
        requestId, providerCode, listingId: update.listingId,
        correctedPriceCents: update.correctedPriceCents, error: msg,
      });
      failures.push({ listing_id: update.listingId, reason: `price_correction_failed: ${msg}` });
    }
  }

  // ─── Decision plumbing ────────────────────────────────────────────────

  /**
   * Finds the cheapest buyer offer that has sufficient wallet credit, ignoring
   * the profitability ceiling. Used when the selector returns `uneconomic` so
   * we can raise the price to floor and still declare stock.
   */
  private async findCheapestCreditedOffer(
    offers: DeclaredStockOfferRow[],
    snapshot: WalletSnapshot,
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

  private async runSelector(
    account: ProviderAccountRow,
    listing: ListingRow,
    offers: DeclaredStockOfferRow[],
    snapshot: WalletSnapshot,
  ): Promise<DeclaredStockSelectorResult> {
    const mergedConfig = mergeSellerListingPricingOverrides(
      account.seller_config,
      listing.pricing_overrides,
    );

    // Use the lower of (intended `listing.price_cents`, last observed
    // marketplace realised net) as the effective sale price for the economic
    // gate. This closes the feedback loop documented in
    // `core/shared/last-realized-net.ts`: when our last RESERVE callback shows
    // the auction realising LESS than what we intend (because Eneba/Gamivo are
    // selling stale listings, applying smart-competition discounts, or our
    // price-push hasn't propagated yet), the selector must use that empirical
    // value or it will keep declaring stock that JIT will refuse.
    const realisedNet = readLastRealizedNet(listing.provider_metadata);
    const effectiveSaleCents = pessimisticSaleCents(
      listing.price_cents,
      listing.currency,
      realisedNet,
    );

    const salePriceUsd =
      (await this.fx.toUsdCents(effectiveSaleCents, listing.currency)) ?? 0;
    const listingMinUsd =
      (await this.fx.toUsdCents(listing.min_price_cents, listing.currency)) ?? 0;
    const minFloorUsd =
      (await this.fx.toUsdCents(mergedConfig.min_price_floor_cents, account.seller_config.default_currency))
      ?? mergedConfig.min_price_floor_cents;
    // Per-sale fee follows the same currency convention as min_price_floor_cents:
    // stored in `seller_config.default_currency` (and merged from
    // `pricing_overrides.fixed_fee_override_cents` per listing). FX-convert to
    // USD so the selector can apply it to the USD-normalized profitability
    // ceiling without caring about per-listing currency drift. Used only
    // when the live marketplace calculator is unavailable (e.g. Digiseller).
    const fixedFeeUsd =
      (await this.fx.toUsdCents(mergedConfig.fixed_fee_cents, account.seller_config.default_currency))
      ?? mergedConfig.fixed_fee_cents;

    // Marketplace-authoritative path: ask the marketplace's own fee calculator
    // (Eneba `S_calculatePrice`, G2A `/v3/pricing/simulations`, Kinguin
    // commission API, Gamivo `calculate-customer-price`) what the seller
    // actually receives after fees. This eliminates manual-config drift for
    // tiered or per-product commissions (e.g. Eneba's 6% + €0.25 above €5).
    const netPayoutUsdCents = await this.fetchLiveNetPayoutUsdCents(account, listing);

    const cfg: DeclaredStockPricingConfig = {
      sellerSalePriceUsdCents: salePriceUsd,
      minProfitMarginPct: mergedConfig.min_profit_margin_pct,
      commissionRatePercent: mergedConfig.commission_rate_percent,
      minPriceFloorUsdCents: minFloorUsd,
      listingMinUsdCents: listingMinUsd,
      fixedFeeUsdCents: fixedFeeUsd,
      ...(netPayoutUsdCents != null ? { netPayoutUsdCents } : {}),
      requestedQty: 1,
    };

    return this.selector.execute({ offers, snapshot, config: cfg });
  }

  /**
   * Calls the marketplace's own fee calculator and FX-normalizes the result
   * to USD cents. Returns `null` when no adapter is registered (Digiseller),
   * when the listing lacks identifiers the adapter requires, or when the
   * call throws — in those cases the caller falls back to manual config math.
   *
   * Failures are logged but never rethrown. Transient errors (rate limits,
   * circuit breakers) get an `info` log; unexpected errors get a `warn` so
   * Sentry surfaces them without blocking the rest of the cron run.
   */
  private async fetchLiveNetPayoutUsdCents(
    account: ProviderAccountRow,
    listing: ListingRow,
  ): Promise<number | null> {
    if (listing.price_cents <= 0) return null;

    const adapter = this.registry.getPricingAdapter(account.provider_code);
    if (!adapter) return null;

    // seller_price adapters (e.g. Eneba with priceIWantToGet, Gamivo) store
    // net amounts in listing.price_cents — calling calculateNetPayout() would
    // treat the NET price as a GROSS price and return a lower incorrect value
    // while burning API rate-limit budget per listing. Return directly, but
    // honour the realised-net feedback loop (see core/shared/last-realized-net.ts):
    // if the last RESERVE shows the auction realising LESS than our intended
    // price, use the empirical value so the selector doesn't over-declare.
    if (adapter.pricingModel === 'seller_price') {
      const realised = readLastRealizedNet(listing.provider_metadata);
      const effectiveCents = pessimisticSaleCents(
        listing.price_cents,
        listing.currency,
        realised,
      );
      const usd = await this.fx.toUsdCents(effectiveCents, listing.currency);
      return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : effectiveCents;
    }

    try {
      const payout = await adapter.calculateNetPayout({
        priceCents: listing.price_cents,
        currency: listing.currency,
        listingType: listing.listing_type,
        ...(listing.external_listing_id ? { externalListingId: listing.external_listing_id } : {}),
        ...(listing.external_product_id ? { externalProductId: listing.external_product_id } : {}),
      });
      if (
        typeof payout.netPayoutCents !== 'number'
        || !Number.isFinite(payout.netPayoutCents)
        || payout.netPayoutCents <= 0
      ) {
        return null;
      }
      const usd = await this.fx.toUsdCents(payout.netPayoutCents, listing.currency);
      return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : payout.netPayoutCents;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = isTransientMarketplaceError(err);
      const logFn = isTransient ? logger.info.bind(logger) : logger.warn.bind(logger);
      logFn('Live marketplace pricing call failed; selector falling back to manual config', {
        listingId: listing.id,
        providerCode: account.provider_code,
        error: msg,
        transient: isTransient,
      });
      return null;
    }
  }

  private recordFailure(
    requestId: string,
    listingId: string,
    err: unknown,
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): void {
    const msg = err instanceof Error ? err.message : String(err);
    const isTransient = isTransientMarketplaceError(err);
    failures.push({ listing_id: listingId, reason: msg });
    const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
    logFn('Procurement declared stock reconcile failed', {
      requestId, listingId, error: msg, transient: isTransient,
    });
    void this.persistError(listingId, msg).catch(() => {});
  }

  private async persistSuccess(listingId: string, applied: number): Promise<void> {
    await this.db.update('seller_listings', { id: listingId }, {
      declared_stock: applied,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: null,
    });
  }

  private async persistError(listingId: string, msg: string): Promise<void> {
    await this.db.update('seller_listings', { id: listingId }, {
      error_message: `Procurement stock reconcile failed: ${msg}`,
      last_synced_at: new Date().toISOString(),
    });
  }

  // ─── Loaders ──────────────────────────────────────────────────────────

  private async loadEligibleListings(
    variantIds: readonly string[] | undefined,
    batchLimit: number,
  ): Promise<ListingRow[]> {
    // Include both own-inventory listings (auto_sync_stock_follows_provider=false,
    // synced via internalQty path below) and procurement-backed listings
    // (auto_sync_stock_follows_provider=true, synced via buyer-offer selector).
    const eq: Array<[string, unknown]> = [
      ['auto_sync_stock', true],
      ['listing_type', 'declared_stock'],
    ];

    const baseOpts: QueryOptions = { eq };
    if (variantIds && variantIds.length > 0) {
      baseOpts.in = [['variant_id', [...variantIds]]];
    }

    const rows = await this.db.query<Record<string, unknown>>('seller_listings', baseOpts);

    // `paused` listings are excluded: a paused status carries an explicit
    // "stop advertising" intent (admin or auto-pause from listing-health
    // out-of-stock circuit). Including them here would re-push positive
    // declared_stock the moment the credit-aware selector decided economics
    // looked OK on paper, defeating the pause. Listings auto-paused by the
    // OOS circuit also have declared_stock=0 already pushed to the marketplace
    // by ListingHealthService.tripOutOfStockCircuit, so there's nothing left
    // to reconcile here.
    const activeListings = rows.filter((r) => r.status === 'active');

    const mapped: ListingRow[] = activeListings.map((r) => ({
      id: r.id as string,
      variant_id: r.variant_id as string,
      provider_account_id: r.provider_account_id as string,
      external_listing_id: (r.external_listing_id as string | null) ?? null,
      external_product_id: (r.external_product_id as string | null) ?? null,
      listing_type: r.listing_type as string,
      status: r.status as string,
      declared_stock: typeof r.declared_stock === 'number' ? r.declared_stock : 0,
      auto_sync_stock_follows_provider: r.auto_sync_stock_follows_provider === true,
      currency: typeof r.currency === 'string' ? r.currency : 'USD',
      price_cents: typeof r.price_cents === 'number' ? r.price_cents : 0,
      min_price_cents: typeof r.min_price_cents === 'number' ? r.min_price_cents : 0,
      pricing_overrides:
        r.pricing_overrides && typeof r.pricing_overrides === 'object' && !Array.isArray(r.pricing_overrides)
          ? (r.pricing_overrides as Record<string, unknown>)
          : null,
      provider_metadata:
        r.provider_metadata && typeof r.provider_metadata === 'object' && !Array.isArray(r.provider_metadata)
          ? (r.provider_metadata as Record<string, unknown>)
          : null,
    }));

    return mapped.slice(0, batchLimit);
  }

  private async computeAvailableStock(variantIds: string[]): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();
    if (variantIds.length === 0) return stockMap;

    let data: Array<{ variant_id: string; available_count: number }>;
    try {
      data = await this.db.rpc<Array<{ variant_id: string; available_count: number }>>(
        'get_batch_available_keys_count',
        { variant_uuids: variantIds },
      );
    } catch (err) {
      // Re-throw so the entire reconcile run aborts. Swallowing this error and
      // returning an empty map would cause every listing to appear as having 0
      // internal stock, incorrectly routing them all through JIT procurement.
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(msg);
      if (isTransient) {
        logger.warn('Failed to compute available stock (transient) — aborting reconcile run', {
          variantCount: variantIds.length,
          error: msg,
          transient: true,
        });
      } else {
        logger.error('Failed to compute available stock — aborting reconcile run', err instanceof Error ? err : undefined, {
          variantCount: variantIds.length,
          error: msg,
        });
      }
      throw err;
    }

    for (const row of data ?? []) {
      stockMap.set(row.variant_id, row.available_count);
    }

    return stockMap;
  }

  private async loadProviderAccounts(accountIds: string[]): Promise<Map<string, ProviderAccountRow>> {
    const map = new Map<string, ProviderAccountRow>();
    const unique = [...new Set(accountIds)];
    const BATCH = 100;
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      const rows = await this.db.query<{
        id: string;
        provider_code: string;
        seller_config: Record<string, unknown> | null;
      }>('provider_accounts', {
        select: 'id, provider_code, seller_config',
        in: [['id', chunk]],
      });
      for (const r of rows) {
        map.set(r.id, {
          id: r.id,
          provider_code: r.provider_code,
          seller_config: parseSellerConfig(r.seller_config ?? {}),
        });
      }
    }
    return map;
  }
}
