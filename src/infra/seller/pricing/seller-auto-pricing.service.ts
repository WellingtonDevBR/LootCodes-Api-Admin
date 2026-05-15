/**
 * Seller auto-pricing orchestrator — cron-driven price refresh.
 *
 * Behaviour, in order:
 *
 *   1. Fetch every active listing with `auto_sync_price = true`
 *      ({@link SellerListingFetcher}).
 *   2. Compute cost basis in the listing's currency for each variant. For
 *      `declared_stock` listings with no physical keys, fall back first to the
 *      linked source variant's actual purchase cost, then to the cheapest
 *      provider quote — the floor needs a real number to defend against
 *      under-cost pricing.
 *   3. Group listings by `provider_code` so we make one batched pull of
 *      competitor prices and one batched push of new prices per marketplace.
 *   4. For each listing: evaluate the price-change budget
 *      ({@link evaluatePriceChangeBudget}), short-circuit if below the cost
 *      floor (the "floor correction" path that bypasses oscillation and
 *      dampening), otherwise consult the smart-pricing engine and decide.
 *   5. Push the batch and record one `seller_pricing_decisions` row per
 *      listing — `pushed`, `skipped`, or `no_change`
 *      ({@link SellerPriceDecisionRecorder}).
 *
 * This class is intentionally an orchestrator: it composes
 * {@link SellerListingFetcher}, {@link SellerCostBasisService},
 * {@link SellerPricingService}, {@link SellerPriceIntelligenceService},
 * {@link SellerPriceDecisionRecorder}, {@link evaluatePriceChangeBudget}, and
 * {@link resolveNetGrossRatio}. Each collaborator owns one concern; the
 * orchestrator owns the order of operations and the cron-level error
 * isolation.
 *
 * Ported from the now-archived `supabase/functions/provider-procurement`
 * service. Split into focused services on 2026-05-16 (see the plan file
 * `seller-pricing-fix-and-cleanup` for the why).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry, CompetitorPrice } from '../../../core/ports/marketplace-adapter.port.js';
import type {
  ISellerAutoPricingService,
  RefreshPricesResult,
  RefreshCostBasesResult,
} from '../../../core/ports/seller-pricing.port.js';
import type { SellerProviderConfig } from '../../../core/use-cases/seller/seller.types.js';
import { SellerPricingService } from './seller-pricing.service.js';
import {
  SellerPriceIntelligenceService,
  stampCompetitorOwnership,
  summarizeLiveCompetition,
  type CompetitorFloorData,
  type CompetitorSnapshotRow,
} from './seller-price-intelligence.service.js';
import { SellerCostBasisService } from './seller-cost-basis.service.js';
import { SellerListingFetcher, type SellerListingRow } from './seller-listing-fetcher.js';
import { evaluatePriceChangeBudget } from './seller-price-budget.js';
import {
  SellerPriceDecisionRecorder,
  buildConfigSnapshot,
  type PricingDecision,
} from './seller-price-decision-recorder.js';
import { resolveNetGrossRatio, convertGrossToNet } from './seller-net-gross-model.js';
import {
  readsBypassProfitabilityGuard,
  readsBypassFloorPct,
  shouldSkipForProfitabilityNoCost,
  computeRelaxedEffectiveMinCentsForAutoPricing,
} from '../../../core/use-cases/seller/auto-pricing-profitability-guard.js';
import { resolveProfitabilityFloorCentsForAutoPricing } from './auto-pricing-floor-resolution.js';
import { mergeSellerListingPricingOverrides } from '../../../core/use-cases/seller/listing-pricing-overrides-merge.js';
import { buildUpdatedMetadata } from './seller-price-change-quota.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-auto-pricing');

function mergeListingOverrides(
  baseConfig: SellerProviderConfig,
  listing: SellerListingRow,
): SellerProviderConfig {
  return mergeSellerListingPricingOverrides(baseConfig, listing.pricing_overrides);
}

@injectable()
export class SellerAutoPricingService implements ISellerAutoPricingService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.SellerPricingService) private pricingService: SellerPricingService,
    @inject(TOKENS.SellerPriceIntelligenceService) private intelligenceService: SellerPriceIntelligenceService,
    @inject(TOKENS.SellerCostBasisService) private costBasisService: SellerCostBasisService,
    @inject(TOKENS.SellerListingFetcher) private listingFetcher: SellerListingFetcher,
    @inject(TOKENS.SellerPriceDecisionRecorder) private decisionRecorder: SellerPriceDecisionRecorder,
  ) {}

  // ─── Cost-basis refresh (runs for ALL active listings) ────────────

  async refreshAllCostBases(requestId: string): Promise<RefreshCostBasesResult> {
    const listings = await this.listingFetcher.getActiveListings();
    if (!listings.length) {
      return { listingsProcessed: 0, costBasisUpdated: 0, errors: 0 };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const costBasisMap = await this.costBasisService.computeBatchCostBasis(variantIds);

    // For declared_stock listings with no physical key inventory the key-cost RPC
    // returns 0. Fall back to the cheapest active buyer offer price so that these
    // JIT listings still get a meaningful cost_basis_cents.
    const declaredStockZeroCostVariantIds = [
      ...new Set(
        listings
          .filter(
            (l) =>
              l.listing_type === 'declared_stock'
              && (costBasisMap.get(l.variant_id)?.avg_cost_cents ?? 0) === 0,
          )
          .map((l) => l.variant_id),
      ),
    ];
    // Source-variant cost is preferred over JIT: it reflects the actual paid
    // price for the physical keys in the linked variant's pool, while the JIT
    // map can only see live buyer offer prices (always at-or-above market).
    const sourceVariantCostMap = await this.costBasisService.computeSourceVariantCosts(
      declaredStockZeroCostVariantIds,
    );
    if (sourceVariantCostMap.size > 0) {
      logger.info('Loaded source-variant cost for declared_stock listings', {
        requestId, variantCount: sourceVariantCostMap.size,
      });
    }

    // JIT offer map is the final fallback for variants with no source-variant keys at all.
    const jitFallbackVariantIds = declaredStockZeroCostVariantIds.filter(
      (id) => !sourceVariantCostMap.has(id),
    );
    const offerCostMap = await this.costBasisService.computeBatchProviderOfferCosts(
      jitFallbackVariantIds,
    );
    if (offerCostMap.size > 0) {
      logger.info('Loaded buyer-offer cost fallback for declared_stock listings', {
        requestId, variantCount: offerCostMap.size,
      });
    }

    const currencies = [...new Set(listings.map((l) => l.currency))];
    const rateMap = await this.costBasisService.loadCurrencyRates(currencies);

    const result: RefreshCostBasesResult = { listingsProcessed: 0, costBasisUpdated: 0, errors: 0 };

    for (const listing of listings) {
      result.listingsProcessed++;
      try {
        const costEntry = costBasisMap.get(listing.variant_id);
        let avgUsdCents = costEntry?.avg_cost_cents ?? 0;
        if (avgUsdCents === 0 && listing.listing_type === 'declared_stock') {
          avgUsdCents = sourceVariantCostMap.get(listing.variant_id) ?? 0;
        }
        if (avgUsdCents === 0 && listing.listing_type === 'declared_stock') {
          avgUsdCents = offerCostMap.get(listing.variant_id) ?? 0;
        }

        const rate = rateMap.get(listing.currency.toUpperCase()) ?? 1;
        const costInListingCurrency = this.costBasisService.convertWithRate(avgUsdCents, rate);

        if (costInListingCurrency !== listing.cost_basis_cents) {
          await this.db.update('seller_listings', { id: listing.id }, {
            cost_basis_cents: costInListingCurrency,
            updated_at: new Date().toISOString(),
          });
          result.costBasisUpdated++;
        }
      } catch (err) {
        result.errors++;
        logger.error('Failed to update cost basis', err as Error, {
          requestId, listingId: listing.id,
        });
      }
    }

    logger.info('Cost basis refresh complete', { requestId, ...result });
    return result;
  }

  // ─── Main auto-pricing orchestration ──────────────────────────────

  async refreshAllPrices(requestId: string): Promise<RefreshPricesResult> {
    const listings = await this.listingFetcher.getAutoSyncPriceListings();
    if (!listings.length) {
      logger.info('No active auto-sync-price listings', { requestId });
      return this.emptyRefreshResult();
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const costBasisMap = await this.costBasisService.computeBatchCostBasis(variantIds);

    const declaredStockZeroCostVariantIds = [
      ...new Set(
        listings
          .filter(
            (l) =>
              l.listing_type === 'declared_stock'
              && (costBasisMap.get(l.variant_id)?.avg_cost_cents ?? 0) === 0,
          )
          .map((l) => l.variant_id),
      ),
    ];

    const sourceVariantCostMap = await this.costBasisService.computeSourceVariantCosts(
      declaredStockZeroCostVariantIds,
    );

    const jitFallbackVariantIds = declaredStockZeroCostVariantIds.filter(
      (id) => !sourceVariantCostMap.has(id),
    );
    const offerCostMap = await this.costBasisService.computeBatchProviderOfferCosts(
      jitFallbackVariantIds,
    );

    const currencies = [...new Set(listings.map((l) => l.currency))];
    const rateMap = await this.costBasisService.loadCurrencyRates(currencies);

    const byProvider = new Map<string, SellerListingRow[]>();
    for (const listing of listings) {
      const group = byProvider.get(listing.provider_code) ?? [];
      group.push(listing);
      byProvider.set(listing.provider_code, group);
    }

    const result: RefreshPricesResult = {
      ...this.emptyRefreshResult(),
      providers: byProvider.size,
    };

    for (const [providerCode, providerListings] of byProvider) {
      await this.refreshProviderGroup({
        providerCode, providerListings, costBasisMap,
        sourceVariantCostMap, offerCostMap, rateMap,
        result, requestId,
      });
    }

    logger.info('Auto-pricing refresh complete', { requestId, ...result });
    return result;
  }

  // ─── Per-provider orchestration ───────────────────────────────────

  private async refreshProviderGroup(args: {
    providerCode: string;
    providerListings: SellerListingRow[];
    costBasisMap: Map<string, { avg_cost_cents: number }>;
    sourceVariantCostMap: Map<string, number>;
    offerCostMap: Map<string, number>;
    rateMap: Map<string, number>;
    result: RefreshPricesResult;
    requestId: string;
  }): Promise<void> {
    const { providerCode, providerListings, costBasisMap, sourceVariantCostMap,
      offerCostMap, rateMap, result, requestId } = args;

    const hasPricing = this.registry.hasCapability(providerCode, 'pricing');
    const hasCompetition = this.registry.hasCapability(providerCode, 'competition');
    const hasBatchPrice = this.registry.hasCapability(providerCode, 'batch_price');
    const listingAdapter = this.registry.getListingAdapter(providerCode);
    const isNetPricingModel = listingAdapter != null
      && 'pricingModel' in listingAdapter
      && (listingAdapter as Record<string, unknown>).pricingModel === 'seller_price';

    const providerAccountId = providerListings[0].provider_account_id;
    const baseConfig = await this.pricingService.getProviderConfig(providerAccountId);

    // Live quota + GROSS prices from S_stock (Eneba only today; the adapter
    // exposes `fetchAllStock` only when the marketplace provides one).
    const { realQuotaByListing, grossPriceByListing } = await this.fetchProviderStockSnapshot({
      providerCode, listingAdapter, requestId,
    });

    // For providers with auto_price_free_only, send preventPaidPriceChange=true
    // even when our local counter thinks we still have free slots — the
    // marketplace's own counter is the source of truth, and a "paid" push that
    // we billed as free will be silently rejected.
    const preventPaid = baseConfig.auto_price_free_only;

    const batchUpdates: BatchUpdateEntry[] = [];
    const pendingSnapshots: CompetitorSnapshotRow[] = [];

    const competitorCache = await this.preFetchCompetitors({
      providerCode, hasCompetition, providerListings, requestId,
    });

    for (const listing of providerListings) {
      result.listingsProcessed++;
      const config = mergeListingOverrides(baseConfig, listing);
      const configSnapshot = buildConfigSnapshot(config);

      try {
        await this.processListing({
          listing, config, configSnapshot, providerCode, providerAccountId,
          requestId, hasPricing, hasCompetition, isNetPricingModel,
          costBasisMap, sourceVariantCostMap, offerCostMap, rateMap,
          realQuotaByListing, grossPriceByListing,
          competitorCache, batchUpdates, pendingSnapshots, result,
        });
      } catch (err) {
        result.errors++;
        logger.error('Failed to compute price for listing', err as Error, {
          requestId, listingId: listing.id, providerCode,
        });
      }
    }

    if (pendingSnapshots.length > 0) {
      const flush = await this.intelligenceService.flushCompetitorSnapshots(pendingSnapshots);
      logger.info('Flushed competitor snapshots batch', {
        requestId, providerCode, rowCount: flush.inserted,
      });
    }

    if (batchUpdates.length > 0) {
      if (hasBatchPrice) {
        await this.flushBatchUpdates({
          providerCode, providerAccountId, providerListings, batchUpdates,
          baseConfig, preventPaid, result, requestId,
        });
      } else {
        // No batch_price adapter on this provider — the decisions would be
        // silently dropped. Record each as a `skipped/no_batch_price_adapter`
        // row so the gap is observable in `seller_pricing_decisions` and the
        // admin alert path can pick it up. This was the source of the Gamivo
        // "auto-pricing on but nothing ever happens" symptom.
        logger.warn('Provider has no batch_price adapter — recording skipped decisions instead', {
          requestId, providerCode, queuedUpdates: batchUpdates.length,
        });
        for (const update of batchUpdates) {
          await this.decisionRecorder.record({
            ...update.pendingDecision,
            action: 'skipped',
            reason_code: 'no_batch_price_adapter',
            reason_detail: `Provider ${providerCode} has no batch_price adapter capability`,
            price_after_cents: null,
            decision_context: {
              ...(update.pendingDecision.decision_context ?? {}),
              block_stage: 'no_batch_price_adapter',
            },
          });
          result.decisionsRecorded++;
        }
      }
    }
  }

  // ─── Per-listing decision ─────────────────────────────────────────

  private async processListing(args: {
    listing: SellerListingRow;
    config: SellerProviderConfig;
    configSnapshot: Record<string, unknown>;
    providerCode: string;
    providerAccountId: string;
    requestId: string;
    hasPricing: boolean;
    hasCompetition: boolean;
    isNetPricingModel: boolean;
    costBasisMap: Map<string, { avg_cost_cents: number }>;
    sourceVariantCostMap: Map<string, number>;
    offerCostMap: Map<string, number>;
    rateMap: Map<string, number>;
    realQuotaByListing: Map<string, number>;
    grossPriceByListing: Map<string, number>;
    competitorCache: Map<string, CompetitorPrice[]>;
    batchUpdates: BatchUpdateEntry[];
    pendingSnapshots: CompetitorSnapshotRow[];
    result: RefreshPricesResult;
  }): Promise<void> {
    const { listing, config, configSnapshot, providerCode, providerAccountId,
      requestId, hasPricing, hasCompetition, isNetPricingModel,
      costBasisMap, sourceVariantCostMap, offerCostMap, rateMap,
      realQuotaByListing, grossPriceByListing,
      competitorCache, batchUpdates, pendingSnapshots, result } = args;

    // Cost basis in the listing currency.
    const costEntry = costBasisMap.get(listing.variant_id);
    let avgUsdCents = costEntry?.avg_cost_cents ?? 0;
    const isInternalStockOnly = listing.pricing_overrides?.disable_jit_on_stockout === true;

    if (avgUsdCents === 0 && listing.listing_type === 'declared_stock') {
      avgUsdCents = sourceVariantCostMap.get(listing.variant_id) ?? 0;
    }
    if (avgUsdCents === 0 && listing.listing_type === 'declared_stock' && !isInternalStockOnly) {
      avgUsdCents = offerCostMap.get(listing.variant_id) ?? 0;
    }

    const rate = rateMap.get(listing.currency.toUpperCase()) ?? 1;
    const costInListingCurrency = this.costBasisService.convertWithRate(avgUsdCents, rate);

    if (costInListingCurrency !== listing.cost_basis_cents) {
      await this.db.update('seller_listings', { id: listing.id }, {
        cost_basis_cents: costInListingCurrency,
        updated_at: new Date().toISOString(),
      });
      result.costBasisUpdated++;
    }

    if (!hasPricing || !listing.external_listing_id || !listing.external_product_id) return;

    // Profitability floor — derived from raw overrides (not merged config) so
    // bypass flags don't accidentally come from baseConfig.
    const rawOverrides =
      listing.pricing_overrides != null && typeof listing.pricing_overrides === 'object'
        ? listing.pricing_overrides
        : undefined;
    const bypassProfitabilityGuard = readsBypassProfitabilityGuard(rawOverrides);
    const bypassFloorPct = readsBypassFloorPct(rawOverrides);

    const hasProfitTarget = config.min_profit_margin_pct > 0;
    const hasManualFloor = listing.min_price_mode === 'manual' && listing.min_price_override_cents > 0;
    const effectiveCostCents = costInListingCurrency > 0 ? costInListingCurrency : listing.cost_basis_cents;

    if (
      shouldSkipForProfitabilityNoCost({
        bypassProfitabilityGuard, hasProfitTarget, effectiveCostCents, hasManualFloor,
      })
    ) {
      await this.decisionRecorder.record({
        seller_listing_id: listing.id,
        action: 'skipped', reason_code: 'profitability_no_cost',
        reason_detail: `Profitability target ${config.min_profit_margin_pct}% set but no cost basis available`,
        price_before_cents: listing.price_cents, target_price_cents: listing.price_cents,
        price_after_cents: null, effective_floor_cents: 0,
        competitor_count: 0, lowest_competitor_cents: null,
        our_position_before: null, our_position_after: null,
        estimated_fee_cents: 0, estimated_payout_cents: null,
        config_snapshot: configSnapshot, proposed_price_cents: null,
        second_lowest_competitor_cents: null,
        decision_context: { block_stage: 'profitability_no_cost' },
      });
      result.decisionsRecorded++;
      return;
    }

    const profitabilityFloorCents = resolveProfitabilityFloorCentsForAutoPricing({
      bypassProfitabilityGuard, hasProfitTarget, effectiveCostCents,
      commissionRatePercent: config.commission_rate_percent,
      minProfitMarginPct: config.min_profit_margin_pct,
      fixedFeeCents: config.fixed_fee_cents,
      isNetPricingModel,
    });

    // Compute the cost-basis floor BEFORE the budget check so we can detect a
    // below-cost listing price and grant the budget evaluator permission to
    // use a paid slot. Never-sell-below-cost outranks never-pay-a-fee.
    const effectiveMin = bypassProfitabilityGuard
      ? computeRelaxedEffectiveMinCentsForAutoPricing(
        listing, config.min_price_floor_cents, effectiveCostCents, bypassFloorPct,
      )
      : this.costBasisService.getEffectiveMinPrice(
        { ...listing, cost_basis_cents: effectiveCostCents },
        config.min_price_floor_cents,
        isNetPricingModel ? undefined : config.commission_rate_percent,
        profitabilityFloorCents,
        isNetPricingModel ? 0 : config.fixed_fee_cents,
      );

    const isBelowCostFloor =
      effectiveMin > 0
      && listing.price_cents > 0
      && listing.price_cents < effectiveMin
      && Boolean(listing.external_listing_id);

    const realQuota = listing.external_listing_id
      ? (realQuotaByListing.get(listing.external_listing_id) ?? null)
      : null;
    const budget = evaluatePriceChangeBudget(
      { providerMetadata: listing.provider_metadata },
      config,
      realQuota,
      { allowPaidWhenBelowFloor: isBelowCostFloor },
    );
    if (!budget.allowed) {
      result.pricesSkippedRateLimit++;
      await this.decisionRecorder.record({
        seller_listing_id: listing.id, action: 'skipped',
        reason_code: 'budget_exhausted',
        reason_detail: isBelowCostFloor
          ? `Price change budget exhausted for this window (listing is below cost floor ${effectiveMin}; admin should clear paid-slot config or raise floor)`
          : 'Price change budget exhausted for this window',
        price_before_cents: listing.price_cents, target_price_cents: listing.price_cents,
        price_after_cents: null, effective_floor_cents: effectiveMin,
        competitor_count: 0, lowest_competitor_cents: null,
        our_position_before: null, our_position_after: null,
        estimated_fee_cents: 0, estimated_payout_cents: null,
        config_snapshot: configSnapshot, proposed_price_cents: null,
        second_lowest_competitor_cents: null,
        decision_context: {
          block_stage: 'budget_exhausted',
          below_cost_floor: isBelowCostFloor,
        },
      });
      result.decisionsRecorded++;
      return;
    }

    // Floor-correction shortcut — must be applied unconditionally on every
    // tick, bypassing competition, dampening, and worth-it. A below-cost
    // listing is a system invariant violation.
    if (isBelowCostFloor && listing.external_listing_id) {
      batchUpdates.push({
        listingId: listing.id,
        externalListingId: listing.external_listing_id,
        externalProductId: listing.external_product_id,
        newPriceCents: effectiveMin,
        currency: listing.currency,
        feeCents: 0,
        pendingDecision: {
          seller_listing_id: listing.id, action: 'pushed',
          reason_code: 'floor_correction',
          reason_detail: `Price ${listing.price_cents} is below cost floor ${effectiveMin}; correcting immediately`,
          price_before_cents: listing.price_cents, target_price_cents: effectiveMin,
          price_after_cents: effectiveMin, effective_floor_cents: effectiveMin,
          competitor_count: 0, lowest_competitor_cents: null,
          second_lowest_competitor_cents: null,
          our_position_before: null, our_position_after: null,
          estimated_fee_cents: 0, estimated_payout_cents: null,
          config_snapshot: configSnapshot, proposed_price_cents: effectiveMin,
          decision_context: { block_stage: 'floor_correction' },
        },
      });
      return;
    }

    // Competitors — pre-fetched cache when available; per-listing live call
    // only when the batch pre-fetch was skipped (adapter missing the batched
    // capability) or returned empty.
    let competitors: CompetitorPrice[] = [];
    if (hasCompetition) {
      if (listing.external_product_id && competitorCache.has(listing.external_product_id)) {
        competitors = stampCompetitorOwnership(
          competitorCache.get(listing.external_product_id)!,
          listing.external_listing_id,
        );
      } else if (!competitorCache.size) {
        try {
          competitors = await this.pricingService.getCompetitors(providerCode, listing.external_product_id);
          competitors = stampCompetitorOwnership(competitors, listing.external_listing_id);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errName = err instanceof Error ? err.name : '';
          const isTransient =
            errName === 'CircuitOpenError'
            || errName === 'RateLimitExceededError'
            || /^Circuit breaker open for /.test(errMsg)
            || /^Rate limit exceeded for /.test(errMsg);
          const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
          logFn('Failed to fetch competitors', {
            requestId, listingId: listing.id,
            error: errMsg,
            transient: isTransient,
          });
        }
      }
    }

    // Snapshot + competitor-floor data for smart pricing.
    let preparedFloor: CompetitorFloorData | null = null;
    if (config.smart_pricing_enabled && competitors.length > 0) {
      const snapshotRows = await this.intelligenceService.prepareCompetitorSnapshot(
        listing.id, listing.provider_code,
        listing.external_product_id, competitors, listing.variant_id,
      );
      if (snapshotRows.length > 0) pendingSnapshots.push(...snapshotRows);

      preparedFloor = await this.intelligenceService.computeCompetitorFloors(listing.id, competitors);

      const oscWindowHours = config.oscillation_window_hours > 0
        ? config.oscillation_window_hours
        : config.price_change_window_hours;
      const oscillation = await this.intelligenceService.detectOscillation(
        listing.id, oscWindowHours, config.oscillation_threshold,
      );
      if (oscillation.isOscillating && !budget.isFree) {
        result.pricesSkippedOscillation++;
        const liveForOsc = summarizeLiveCompetition(competitors);
        await this.decisionRecorder.record({
          seller_listing_id: listing.id, action: 'skipped',
          reason_code: 'oscillation',
          reason_detail: oscillation.reason ?? `${oscillation.changeCount} oscillations detected`,
          price_before_cents: listing.price_cents, target_price_cents: listing.price_cents,
          price_after_cents: null, effective_floor_cents: effectiveMin,
          competitor_count: liveForOsc.nonOwnCount,
          lowest_competitor_cents: liveForOsc.lowestNonOwnCents,
          second_lowest_competitor_cents: liveForOsc.secondLowestNonOwnCents,
          our_position_before: liveForOsc.ourPositionBefore,
          our_position_after: null, estimated_fee_cents: 0, estimated_payout_cents: null,
          config_snapshot: configSnapshot, proposed_price_cents: null,
          decision_context: { block_stage: 'oscillation' },
        });
        result.decisionsRecorded++;
        return;
      }
    }

    // NET/GROSS ratio for marketplaces that publish a buyer-facing GROSS price
    // but accept a seller-facing NET price (Eneba). See seller-net-gross-model.ts.
    let netModelGrossNetRatio: number | null = null;
    if (isNetPricingModel && listing.external_listing_id && config.smart_pricing_enabled) {
      netModelGrossNetRatio = resolveNetGrossRatio({
        listingId: listing.id,
        externalListingId: listing.external_listing_id,
        providerCode,
        storedNetPriceCents: listing.price_cents,
      }, {
        competitors,
        grossPriceByListing,
        requestId,
      });
      if (netModelGrossNetRatio === null) {
        result.errors++;
        return;
      }
    }

    // Target price resolution
    const target = await this.resolvePriceTarget(
      listing, competitors, config, effectiveMin,
      providerCode, providerAccountId, requestId,
      hasCompetition, hasPricing, isNetPricingModel,
      effectiveCostCents, preparedFloor, netModelGrossNetRatio,
    );

    if (!target.shouldChange) {
      if (target.reasonCode !== 'no_competitors' && target.reasonCode !== 'dampening') {
        result.pricesSkippedIntelligence++;
        await this.decisionRecorder.record({
          seller_listing_id: listing.id, action: 'no_change',
          reason_code: target.reasonCode, reason_detail: target.reasonDetail,
          price_before_cents: listing.price_cents, target_price_cents: target.targetCents,
          price_after_cents: null, effective_floor_cents: effectiveMin,
          competitor_count: target.competitorCount,
          lowest_competitor_cents: target.lowestCompetitorCents,
          second_lowest_competitor_cents: target.secondLowestCompetitorCents,
          our_position_before: target.ourPositionBefore,
          our_position_after: null, estimated_fee_cents: 0, estimated_payout_cents: null,
          config_snapshot: configSnapshot, proposed_price_cents: target.proposedPriceCents,
          decision_context: { block_stage: target.reasonCode },
        });
        result.decisionsRecorded++;
      }
      return;
    }

    // Worth-it gate — protects against burning the marketplace fee for a
    // change that doesn't recoup it (delta < min_change_delta_cents).
    const worthIt = this.intelligenceService.isPriceChangeWorthIt(
      listing.price_cents, target.targetCents, budget.feeCents, config.min_change_delta_cents,
    );
    if (!worthIt.worthIt) {
      result.pricesSkippedIntelligence++;
      await this.decisionRecorder.record({
        seller_listing_id: listing.id, action: 'skipped',
        reason_code: 'not_worth_it',
        reason_detail: worthIt.reason ?? 'Price change not profitable enough',
        price_before_cents: listing.price_cents, target_price_cents: target.targetCents,
        price_after_cents: null, effective_floor_cents: effectiveMin,
        competitor_count: target.competitorCount,
        lowest_competitor_cents: target.lowestCompetitorCents,
        second_lowest_competitor_cents: target.secondLowestCompetitorCents,
        our_position_before: target.ourPositionBefore,
        our_position_after: null, estimated_fee_cents: budget.feeCents, estimated_payout_cents: null,
        config_snapshot: configSnapshot, proposed_price_cents: target.proposedPriceCents,
        decision_context: { block_stage: 'worth_it', worth_it_reason: worthIt.reason ?? null },
      });
      result.decisionsRecorded++;
      return;
    }

    if (listing.external_listing_id) {
      batchUpdates.push({
        listingId: listing.id,
        externalListingId: listing.external_listing_id,
        externalProductId: listing.external_product_id,
        newPriceCents: target.targetCents,
        currency: listing.currency,
        feeCents: budget.feeCents,
        pendingDecision: {
          seller_listing_id: listing.id, action: 'pushed',
          reason_code: target.reasonCode, reason_detail: target.reasonDetail,
          price_before_cents: listing.price_cents, target_price_cents: target.targetCents,
          price_after_cents: target.targetCents, effective_floor_cents: effectiveMin,
          competitor_count: target.competitorCount,
          lowest_competitor_cents: target.lowestCompetitorCents,
          second_lowest_competitor_cents: target.secondLowestCompetitorCents,
          our_position_before: target.ourPositionBefore,
          our_position_after: null,
          estimated_fee_cents: budget.feeCents, estimated_payout_cents: null,
          config_snapshot: configSnapshot, proposed_price_cents: target.proposedPriceCents,
          decision_context: { block_stage: 'pushed' },
        },
      });
    }
  }

  // ─── Per-provider helpers ─────────────────────────────────────────

  private async fetchProviderStockSnapshot(args: {
    providerCode: string;
    listingAdapter: unknown;
    requestId: string;
  }): Promise<{
    realQuotaByListing: Map<string, number>;
    grossPriceByListing: Map<string, number>;
  }> {
    const realQuotaByListing = new Map<string, number>();
    const grossPriceByListing = new Map<string, number>();

    const adapterAsUnknown = args.listingAdapter as unknown as Record<string, unknown>;
    if (typeof adapterAsUnknown?.fetchAllStock !== 'function') {
      return { realQuotaByListing, grossPriceByListing };
    }

    try {
      const stockNodes = await (adapterAsUnknown as unknown as {
        fetchAllStock(): Promise<Array<{
          id: string;
          price?: { amount: number; currency: string } | null;
          priceUpdateQuota?: { quota: number } | null;
        }>>;
      }).fetchAllStock();
      for (const node of stockNodes) {
        const quota = node.priceUpdateQuota?.quota;
        if (quota != null) realQuotaByListing.set(node.id, quota);
        const grossCents = node.price?.amount;
        if (grossCents != null && grossCents > 0) grossPriceByListing.set(node.id, grossCents);
      }
      logger.info('Synced real price quota and gross prices from S_stock', {
        requestId: args.requestId, providerCode: args.providerCode,
        quotaCount: realQuotaByListing.size,
        grossPriceCount: grossPriceByListing.size,
      });
    } catch (err) {
      logger.warn('Failed to fetch S_stock for quota/gross-price sync; falling back to timestamp counter',
        err as Error,
        { requestId: args.requestId, providerCode: args.providerCode });
    }

    return { realQuotaByListing, grossPriceByListing };
  }

  private async preFetchCompetitors(args: {
    providerCode: string;
    hasCompetition: boolean;
    providerListings: SellerListingRow[];
    requestId: string;
  }): Promise<Map<string, CompetitorPrice[]>> {
    const competitorCache = new Map<string, CompetitorPrice[]>();
    if (!args.hasCompetition) return competitorCache;

    const competitionAdapter = this.registry.getCompetitionAdapter(args.providerCode);
    if (!competitionAdapter?.batchGetCompetitorPrices) return competitorCache;

    const uniqueProductIds = [
      ...new Set(
        args.providerListings
          .filter((l) => Boolean(l.external_product_id))
          .map((l) => l.external_product_id!),
      ),
    ];
    try {
      const fetched = await competitionAdapter.batchGetCompetitorPrices(uniqueProductIds);
      for (const [pid, prices] of fetched) {
        competitorCache.set(pid, prices);
      }
      logger.info('Pre-fetched competitor prices', {
        requestId: args.requestId, providerCode: args.providerCode,
        uniqueProducts: uniqueProductIds.length,
        fetched: fetched.size,
      });
    } catch (err) {
      logger.info('Batch competitor pre-fetch failed; will skip competition for this run', {
        requestId: args.requestId, providerCode: args.providerCode,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return competitorCache;
  }

  private async flushBatchUpdates(args: {
    providerCode: string;
    providerAccountId: string;
    providerListings: SellerListingRow[];
    batchUpdates: BatchUpdateEntry[];
    baseConfig: SellerProviderConfig;
    preventPaid: boolean;
    result: RefreshPricesResult;
    requestId: string;
  }): Promise<void> {
    const { providerCode, providerAccountId, providerListings, batchUpdates,
      baseConfig, preventPaid, result, requestId } = args;

    try {
      const mapped = batchUpdates.map((u) => ({
        externalListingId: u.externalListingId,
        priceCents: u.newPriceCents,
        ...(preventPaid ? { preventPaidPriceChange: true } : {}),
      }));

      const batchResult = await this.pricingService.batchUpdateListingPrices(
        providerCode, providerAccountId, mapped,
      );

      for (const update of batchUpdates) {
        const listing = providerListings.find((l) => l.id === update.listingId);
        const updatedMetadata = listing
          ? buildUpdatedMetadata(listing.provider_metadata, baseConfig.price_change_window_hours)
          : undefined;

        await this.db.update('seller_listings', { id: update.listingId }, {
          price_cents: update.newPriceCents,
          last_synced_at: new Date().toISOString(),
          error_message: null,
          ...(updatedMetadata && { provider_metadata: updatedMetadata }),
        });

        await this.decisionRecorder.record(update.pendingDecision);
        result.decisionsRecorded++;

        if (update.feeCents > 0) {
          result.paidPriceChanges++;
          result.estimatedFeeCents += update.feeCents;
        }
      }

      result.pricesUpdated += batchResult.updated;
    } catch (err) {
      result.errors++;
      logger.error('Batch price update failed', err as Error, {
        requestId, providerCode,
      });
      for (const update of batchUpdates) {
        await this.decisionRecorder.record({
          ...update.pendingDecision,
          action: 'skipped', reason_code: 'batch_failed',
          reason_detail: `Batch update failed: ${err instanceof Error ? err.message : 'unknown'}`,
          price_after_cents: null,
        });
        result.decisionsRecorded++;
      }
    }
  }

  // ─── Private: Price target resolution ─────────────────────────────

  private async resolvePriceTarget(
    listing: SellerListingRow,
    competitors: CompetitorPrice[],
    config: SellerProviderConfig,
    effectiveMin: number,
    providerCode: string,
    providerAccountId: string,
    requestId: string,
    hasCompetition: boolean,
    hasPricing: boolean,
    isNetPricingModel: boolean,
    costInListingCurrency: number,
    preparedFloor: CompetitorFloorData | null,
    netModelGrossNetRatio: number | null = null,
  ): Promise<{
    targetCents: number;
    reasonCode: string;
    reasonDetail: string;
    shouldChange: boolean;
    competitorCount: number;
    lowestCompetitorCents: number | null;
    ourPositionBefore: number | null;
    proposedPriceCents: number | null;
    secondLowestCompetitorCents: number | null;
  }> {
    void hasCompetition; void hasPricing; void providerCode; void requestId;
    const live = summarizeLiveCompetition(competitors);

    if (config.smart_pricing_enabled && competitors.length > 0) {
      const floorData: CompetitorFloorData = preparedFloor
        ? preparedFloor
        : await this.intelligenceService.computeCompetitorFloors(listing.id, competitors);

      let listingCompareGross = listing.price_cents;
      let effectiveMinGross = effectiveMin;
      if (isNetPricingModel && listing.external_listing_id && netModelGrossNetRatio !== null) {
        listingCompareGross = Math.round(listing.price_cents * netModelGrossNetRatio);
        effectiveMinGross = Math.round(effectiveMin * netModelGrossNetRatio);
      }

      const analysis = await this.intelligenceService.analyzeOptimalPosition(
        { id: listing.id, price_cents: listing.price_cents },
        competitors, floorData, effectiveMinGross, config,
        listingCompareGross,
      );

      // GROSS → NET conversion via the observed gross/NET ratio. See
      // seller-net-gross-model.ts for why we cannot use S_calculatePrice here
      // (it is asymmetric vs priceIWantToGet for Eneba).
      const targetCentsNet = isNetPricingModel && netModelGrossNetRatio !== null
        ? convertGrossToNet(analysis.suggestedPriceCents, netModelGrossNetRatio, listing.id)
        : analysis.suggestedPriceCents;
      const proposedCentsNet = analysis.proposedPriceCents != null
        ? (isNetPricingModel && netModelGrossNetRatio !== null
          ? convertGrossToNet(analysis.proposedPriceCents, netModelGrossNetRatio, listing.id)
          : analysis.proposedPriceCents)
        : null;

      // For NET pricing models the round-trip NET → GROSS → NET introduces
      // small rounding drift. Suppress the push when the computed NET equals
      // the stored NET — otherwise we burn free quota on no-op updates.
      const netShouldChange = analysis.shouldChange && targetCentsNet !== listing.price_cents;

      return {
        targetCents: targetCentsNet,
        reasonCode: netShouldChange ? analysis.reasonCode : 'no_change',
        reasonDetail: netShouldChange
          ? (analysis.skipReason ?? analysis.reason)
          : 'Target NET price equals current (rounding-stable)',
        shouldChange: netShouldChange,
        competitorCount: live.nonOwnCount,
        lowestCompetitorCents: live.lowestNonOwnCents,
        ourPositionBefore: live.ourPositionBefore,
        proposedPriceCents: proposedCentsNet,
        secondLowestCompetitorCents: live.secondLowestNonOwnCents ?? floorData.second_lowest_cents,
      };
    }

    // Fallback to simple strategy-based suggestion (no smart pricing or no competitors).
    const suggestion = await this.pricingService.suggestPrice({
      listingId: listing.id,
      externalProductId: listing.external_product_id ?? '',
      costCents: costInListingCurrency,
      listingType: listing.listing_type as 'key_upload' | 'declared_stock',
      listingMinCents: effectiveMin,
      listingCurrency: listing.currency,
      externalListingId: listing.external_listing_id ?? undefined,
      providerAccountId,
    });

    const changed = suggestion.suggestedPriceCents !== listing.price_cents;
    return {
      targetCents: suggestion.suggestedPriceCents,
      reasonCode: changed ? `strategy_${config.price_strategy}` : 'no_change',
      reasonDetail: changed
        ? `Strategy ${config.price_strategy}: suggested ${suggestion.suggestedPriceCents}c`
        : 'Target price equals current price',
      shouldChange: changed,
      competitorCount: live.nonOwnCount,
      lowestCompetitorCents: suggestion.lowestCompetitorCents,
      ourPositionBefore: live.ourPositionBefore,
      proposedPriceCents: changed ? suggestion.suggestedPriceCents : null,
      secondLowestCompetitorCents: live.secondLowestNonOwnCents,
    };
  }

  // ─── Private: result scaffolds ────────────────────────────────────

  private emptyRefreshResult(): RefreshPricesResult {
    return {
      listingsProcessed: 0, pricesUpdated: 0, pricesSkippedRateLimit: 0,
      pricesSkippedIntelligence: 0, pricesSkippedOscillation: 0,
      paidPriceChanges: 0, estimatedFeeCents: 0, costBasisUpdated: 0,
      decisionsRecorded: 0, errors: 0, providers: 0,
    };
  }
}

// ─── Local types ────────────────────────────────────────────────────

interface BatchUpdateEntry {
  listingId: string;
  externalListingId: string;
  externalProductId: string;
  newPriceCents: number;
  currency: string;
  feeCents: number;
  pendingDecision: PricingDecision;
}
