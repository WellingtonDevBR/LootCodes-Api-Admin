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
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import type {
  IProcurementDeclaredStockReconcileService,
  ProcurementDeclaredStockReconcileDto,
  ProcurementDeclaredStockReconcileFailure,
  ProcurementDeclaredStockReconcileResult,
} from '../../core/ports/procurement-declared-stock-reconcile.port.js';
import type { IBuyerWalletSnapshotter, WalletSnapshot } from '../../core/ports/buyer-wallet-snapshot.port.js';
import type { IProcurementFxConverter } from '../../core/ports/procurement-fx-converter.port.js';
import {
  CreditAwareDeclaredStockSelectorUseCase,
  type DeclaredStockOfferRow,
  type DeclaredStockPricingConfig,
  type DeclaredStockSelectorResult,
} from '../../core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';
import { parseSellerConfig, type SellerProviderConfig } from '../../core/use-cases/seller/seller.types.js';
import { mergeSellerListingPricingOverrides } from '../../core/use-cases/seller/listing-pricing-overrides-merge.js';
import { loadBuyerCapableOffersByVariant } from './load-procurement-offer-supply.js';
import { dispatchListingDisable } from './dispatch-listing-disable.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('procurement-declared-stock-reconcile');

const DEFAULT_BATCH_LIMIT = 500;

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

    for (const listing of listings) {
      scanned++;
      const account = accountMap.get(listing.provider_account_id);
      if (!account) {
        skipped++;
        continue;
      }
      if (!listing.external_listing_id) {
        skipped++;
        continue;
      }
      if (listing.listing_type !== 'declared_stock') {
        skipped++;
        continue;
      }

      const internalQty = internalMap.get(listing.variant_id) ?? 0;

      // Internal keys cover this listing — declare the in-stock count
      // directly without consulting buyer credit.
      if (internalQty > 0) {
        await this.applyDeclareInternal(requestId, listing, account.provider_code, internalQty, dryRun, failures);
        if (!dryRun) updated++;
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
        await this.applyDeclareFromBuyer(requestId, listing, account.provider_code, decision, failures);
        updated++;
      } else {
        await this.applyDisable(requestId, listing, account.provider_code, decision.reason, failures);
        updated++;
      }
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

  // ─── Decision plumbing ────────────────────────────────────────────────

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

    const salePriceUsd =
      (await this.fx.toUsdCents(listing.price_cents, listing.currency)) ?? 0;
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
      const errName = err instanceof Error ? err.name : '';
      const isTransient =
        errName === 'CircuitOpenError'
        || errName === 'RateLimitExceededError'
        || /^Circuit breaker open for /.test(msg)
        || /^Rate limit exceeded for /.test(msg)
        || /Too Many Requests/i.test(msg);
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

  private async applyDeclareInternal(
    requestId: string,
    listing: ListingRow,
    providerCode: string,
    internalQty: number,
    dryRun: boolean,
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    if (dryRun) return;
    const adapter = this.registry.getDeclaredStockAdapter(providerCode);
    if (!adapter) {
      failures.push({ listing_id: listing.id, reason: `no_declared_stock_adapter:${providerCode}` });
      return;
    }
    const externalId = listing.external_listing_id;
    if (!externalId) return;
    try {
      logger.info('Reconcile: pushing internal stock to marketplace', {
        requestId, listingId: listing.id, providerCode, qty: internalQty,
      });
      const r = await adapter.declareStock(externalId, internalQty);
      if (!r.success) {
        failures.push({ listing_id: listing.id, reason: r.error ?? 'declare_stock_failed' });
        await this.persistError(listing.id, r.error ?? 'declare_stock_failed');
        return;
      }
      const applied = typeof r.declaredQuantity === 'number' && Number.isFinite(r.declaredQuantity)
        ? r.declaredQuantity : internalQty;
      await this.persistSuccess(listing.id, applied);
    } catch (err) {
      this.recordFailure(requestId, listing.id, err, failures);
    }
  }

  private async applyDeclareFromBuyer(
    requestId: string,
    listing: ListingRow,
    providerCode: string,
    decision: Extract<DeclaredStockSelectorResult, { kind: 'declare' }>,
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    const adapter = this.registry.getDeclaredStockAdapter(providerCode);
    if (!adapter) {
      failures.push({ listing_id: listing.id, reason: `no_declared_stock_adapter:${providerCode}` });
      return;
    }
    const externalId = listing.external_listing_id;
    if (!externalId) return;
    try {
      logger.info('Reconcile: declaring stock from credited buyer', {
        requestId, listingId: listing.id, providerCode,
        buyerProviderCode: decision.offer.provider_code,
        buyerProviderAccountId: decision.offer.provider_account_id,
        declaredQty: decision.declaredQty,
        costBasisUsdCents: decision.costBasisUsdCents,
      });
      const r = await adapter.declareStock(externalId, decision.declaredQty);
      if (!r.success) {
        failures.push({ listing_id: listing.id, reason: r.error ?? 'declare_stock_failed' });
        await this.persistError(listing.id, r.error ?? 'declare_stock_failed');
        return;
      }
      const applied =
        typeof r.declaredQuantity === 'number' && Number.isFinite(r.declaredQuantity)
          ? r.declaredQuantity
          : decision.declaredQty;
      await this.persistSuccess(listing.id, applied);
    } catch (err) {
      this.recordFailure(requestId, listing.id, err, failures);
    }
  }

  private async applyDisable(
    requestId: string,
    listing: ListingRow,
    providerCode: string,
    reason: 'no_offer' | 'no_credit' | 'uneconomic',
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): Promise<void> {
    const externalId = listing.external_listing_id;
    if (!externalId) return;
    try {
      logger.info('Reconcile: dispatching marketplace disable', {
        requestId, listingId: listing.id, providerCode, reason,
      });
      const r = await dispatchListingDisable(this.registry, providerCode, externalId);
      if (!r.success) {
        failures.push({ listing_id: listing.id, reason: r.error ?? `disable_${reason}_failed` });
      }
      // Persist `error_message=reason` so admin sees WHY this listing went
      // dark, even when the dispatch itself succeeded. `declared_stock=0`
      // mirrors what the marketplace now reflects.
      await this.db.update('seller_listings', { id: listing.id }, {
        declared_stock: 0,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: reason,
      });
    } catch (err) {
      this.recordFailure(requestId, listing.id, err, failures);
    }
  }

  private recordFailure(
    requestId: string,
    listingId: string,
    err: unknown,
    failures: ProcurementDeclaredStockReconcileFailure[],
  ): void {
    const msg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : '';
    const isTransient =
      errName === 'CircuitOpenError' ||
      errName === 'RateLimitExceededError' ||
      /^Circuit breaker open for /.test(msg) ||
      /^Rate limit exceeded for /.test(msg);
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
    const eq: Array<[string, unknown]> = [
      ['auto_sync_stock', true],
      ['listing_type', 'declared_stock'],
      ['auto_sync_stock_follows_provider', true],
    ];

    const baseOpts: QueryOptions = { eq };
    if (variantIds && variantIds.length > 0) {
      baseOpts.in = [['variant_id', [...variantIds]]];
    }

    const rows = await this.db.query<Record<string, unknown>>('seller_listings', baseOpts);

    const activeOrPaused = rows.filter((r) => r.status === 'active' || r.status === 'paused');

    const mapped: ListingRow[] = activeOrPaused.map((r) => ({
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
    }));

    return mapped.slice(0, batchLimit);
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
