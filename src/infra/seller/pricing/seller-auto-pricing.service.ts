/**
 * Seller auto-pricing service — cron-driven price refresh orchestrator.
 *
 * Queries all active listings with auto_sync_price=true, computes cost
 * basis, fetches competitor prices, applies strategy, and batch-updates
 * marketplace prices. Fee-aware with budget/quota tracking.
 *
 * Ported from supabase/functions/provider-procurement/services/seller-auto-pricing.service.ts
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
import {
  readsBypassProfitabilityGuard,
  shouldSkipForProfitabilityNoCost,
  computeRelaxedEffectiveMinCentsForAutoPricing,
} from '../../../core/use-cases/seller/auto-pricing-profitability-guard.js';
import { resolveProfitabilityFloorCentsForAutoPricing } from './auto-pricing-floor-resolution.js';
import { mergeSellerListingPricingOverrides } from '../../../core/use-cases/seller/listing-pricing-overrides-merge.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-auto-pricing');

// ─── Seller listing shape from DB ────────────────────────────────────

interface SellerListingRow {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_listing_id: string | null;
  external_product_id: string | null;
  listing_type: string;
  status: string;
  currency: string;
  price_cents: number;
  min_price_cents: number;
  min_price_mode: string;
  min_price_override_cents: number;
  cost_basis_cents: number;
  declared_stock: number;
  auto_sync_stock: boolean;
  auto_sync_price: boolean;
  provider_metadata: Record<string, unknown>;
  pricing_overrides: Record<string, unknown> | null;
  provider_code: string;
}

// ─── Fee-aware budget helpers ────────────────────────────────────────

interface BudgetResult {
  allowed: boolean;
  isFree: boolean;
  feeCents: number;
}

function getPriceChangeTimestamps(metadata: Record<string, unknown>): string[] {
  const ts = metadata?.price_change_timestamps;
  if (!Array.isArray(ts)) return [];
  return ts.filter((v): v is string => typeof v === 'string');
}

function countRecentChanges(timestamps: string[], windowHours: number): number {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  return timestamps.filter((t) => new Date(t).getTime() > cutoff).length;
}

function pruneOldTimestamps(timestamps: string[], windowHours: number): string[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  return timestamps.filter((t) => new Date(t).getTime() > cutoff);
}

function evaluatePriceChangeBudget(
  listing: SellerListingRow,
  config: SellerProviderConfig,
): BudgetResult {
  if (config.price_change_fee_cents === 0 || config.price_change_free_quota === -1) {
    return { allowed: true, isFree: true, feeCents: 0 };
  }

  const timestamps = getPriceChangeTimestamps(listing.provider_metadata);
  const recentChanges = countRecentChanges(timestamps, config.price_change_window_hours);

  if (recentChanges < config.price_change_free_quota) {
    return { allowed: true, isFree: true, feeCents: 0 };
  }

  const paidChangesSoFar = recentChanges - config.price_change_free_quota;
  if (config.price_change_max_paid_per_window > 0 && paidChangesSoFar < config.price_change_max_paid_per_window) {
    return { allowed: true, isFree: false, feeCents: config.price_change_fee_cents };
  }

  return { allowed: false, isFree: false, feeCents: 0 };
}

function buildUpdatedMetadata(
  existing: Record<string, unknown>,
  windowHours: number,
): Record<string, unknown> {
  const timestamps = getPriceChangeTimestamps(existing);
  const pruned = pruneOldTimestamps(timestamps, windowHours);
  pruned.push(new Date().toISOString());
  return { ...existing, price_change_timestamps: pruned };
}

// ─── Decision recording ──────────────────────────────────────────────

interface PricingDecision {
  seller_listing_id: string;
  action: 'pushed' | 'skipped' | 'no_change';
  reason_code: string;
  reason_detail: string | null;
  price_before_cents: number;
  target_price_cents: number;
  price_after_cents: number | null;
  effective_floor_cents: number;
  competitor_count: number;
  lowest_competitor_cents: number | null;
  our_position_before: number | null;
  our_position_after: number | null;
  estimated_fee_cents: number;
  estimated_payout_cents: number | null;
  config_snapshot: Record<string, unknown>;
  proposed_price_cents: number | null;
  second_lowest_competitor_cents: number | null;
  decision_context: Record<string, unknown>;
}

function buildConfigSnapshot(config: SellerProviderConfig): Record<string, unknown> {
  return {
    price_strategy: config.price_strategy,
    smart_pricing_enabled: config.smart_pricing_enabled,
    min_change_delta_cents: config.min_change_delta_cents,
    dampening_snapshots: config.dampening_snapshots,
    max_position_target: config.max_position_target,
    position_gap_threshold_pct: config.position_gap_threshold_pct,
    oscillation_threshold: config.oscillation_threshold,
    min_price_floor_cents: config.min_price_floor_cents,
    auto_price_free_only: config.auto_price_free_only,
    min_profit_margin_pct: config.min_profit_margin_pct,
    fixed_fee_cents: config.fixed_fee_cents,
  };
}

function mergeListingOverrides(
  baseConfig: SellerProviderConfig,
  listing: SellerListingRow,
): SellerProviderConfig {
  return mergeSellerListingPricingOverrides(baseConfig, listing.pricing_overrides);
}

// ─── Service ─────────────────────────────────────────────────────────

@injectable()
export class SellerAutoPricingService implements ISellerAutoPricingService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.SellerPricingService) private pricingService: SellerPricingService,
    @inject(TOKENS.SellerPriceIntelligenceService) private intelligenceService: SellerPriceIntelligenceService,
    @inject(TOKENS.SellerCostBasisService) private costBasisService: SellerCostBasisService,
  ) {}

  // ─── Cost-basis refresh (runs for ALL active listings) ────────────

  async refreshAllCostBases(requestId: string): Promise<RefreshCostBasesResult> {
    const listings = await this.getActiveListings();
    if (!listings.length) {
      return { listingsProcessed: 0, costBasisUpdated: 0, errors: 0 };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const costBasisMap = await this.costBasisService.computeBatchCostBasis(variantIds);
    const currencies = [...new Set(listings.map((l) => l.currency))];
    const rateMap = await this.costBasisService.loadCurrencyRates(currencies);

    const result: RefreshCostBasesResult = { listingsProcessed: 0, costBasisUpdated: 0, errors: 0 };

    for (const listing of listings) {
      result.listingsProcessed++;
      try {
        const costEntry = costBasisMap.get(listing.variant_id);
        const medianUsdCents = costEntry?.median_cost_cents ?? 0;
        const rate = rateMap.get(listing.currency.toUpperCase()) ?? 1;
        const costInListingCurrency = this.costBasisService.convertWithRate(medianUsdCents, rate);

        if (costInListingCurrency !== listing.cost_basis_cents) {
          await this.db.update('seller_listings', { id: listing.id }, {
            cost_basis_cents: costInListingCurrency,
            updated_at: new Date().toISOString(),
          });
          result.costBasisUpdated++;
        }
      } catch (err) {
        result.errors++;
        logger.error('Failed to update cost basis', {
          requestId, listingId: listing.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Cost basis refresh complete', { requestId, ...result });
    return result;
  }

  // ─── Main auto-pricing orchestration ──────────────────────────────

  async refreshAllPrices(requestId: string): Promise<RefreshPricesResult> {
    const listings = await this.getAutoSyncPriceListings();
    if (!listings.length) {
      logger.info('No active auto-sync-price listings', { requestId });
      return {
        listingsProcessed: 0, pricesUpdated: 0, pricesSkippedRateLimit: 0,
        pricesSkippedIntelligence: 0, pricesSkippedOscillation: 0,
        paidPriceChanges: 0, estimatedFeeCents: 0, costBasisUpdated: 0,
        decisionsRecorded: 0, errors: 0, providers: 0,
      };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const costBasisMap = await this.costBasisService.computeBatchCostBasis(variantIds);
    const currencies = [...new Set(listings.map((l) => l.currency))];
    const rateMap = await this.costBasisService.loadCurrencyRates(currencies);

    const byProvider = new Map<string, SellerListingRow[]>();
    for (const listing of listings) {
      const group = byProvider.get(listing.provider_code) ?? [];
      group.push(listing);
      byProvider.set(listing.provider_code, group);
    }

    const result: RefreshPricesResult = {
      listingsProcessed: 0, pricesUpdated: 0, pricesSkippedRateLimit: 0,
      pricesSkippedIntelligence: 0, pricesSkippedOscillation: 0,
      paidPriceChanges: 0, estimatedFeeCents: 0, costBasisUpdated: 0,
      decisionsRecorded: 0, errors: 0, providers: byProvider.size,
    };

    for (const [providerCode, providerListings] of byProvider) {
      const hasPricing = this.registry.hasCapability(providerCode, 'pricing');
      const hasCompetition = this.registry.hasCapability(providerCode, 'competition');
      const hasBatchPrice = this.registry.hasCapability(providerCode, 'batch_price');
      const listingAdapter = this.registry.getListingAdapter(providerCode);
      const isNetPricingModel = listingAdapter != null && 'pricingModel' in listingAdapter && (listingAdapter as Record<string, unknown>).pricingModel === 'seller_price';

      const providerAccountId = providerListings[0].provider_account_id;
      const baseConfig = await this.pricingService.getProviderConfig(providerAccountId);

      const batchUpdates: Array<{
        listingId: string;
        externalListingId: string;
        externalProductId: string;
        newPriceCents: number;
        currency: string;
        feeCents: number;
        pendingDecision: PricingDecision;
      }> = [];

      const pendingSnapshots: CompetitorSnapshotRow[] = [];

      // Pre-fetch all competitor prices in one or a few batched API calls.
      // Without this, we'd fire one request per listing — ~25 requests for Eneba —
      // exhausting the rate limit and causing the batch price update to fail.
      const competitorCache = new Map<string, CompetitorPrice[]>();
      if (hasCompetition) {
        const competitionAdapter = this.registry.getCompetitionAdapter(providerCode);
        if (competitionAdapter?.batchGetCompetitorPrices) {
          const uniqueProductIds = [
            ...new Set(
              providerListings
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
              requestId, providerCode,
              uniqueProducts: uniqueProductIds.length,
              fetched: fetched.size,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.info('Batch competitor pre-fetch failed; will skip competition for this run', {
              requestId, providerCode, error: errMsg,
            });
          }
        }
      }

      for (const listing of providerListings) {
        result.listingsProcessed++;
        const config = mergeListingOverrides(baseConfig, listing);
        const configSnapshot = buildConfigSnapshot(config);

        try {
          const costEntry = costBasisMap.get(listing.variant_id);
          const medianUsdCents = costEntry?.median_cost_cents ?? 0;
          const rate = rateMap.get(listing.currency.toUpperCase()) ?? 1;
          const costInListingCurrency = this.costBasisService.convertWithRate(medianUsdCents, rate);

          if (costInListingCurrency !== listing.cost_basis_cents) {
            await this.db.update('seller_listings', { id: listing.id }, {
              cost_basis_cents: costInListingCurrency,
              updated_at: new Date().toISOString(),
            });
            result.costBasisUpdated++;
          }

          if (!hasPricing || !listing.external_listing_id || !listing.external_product_id) continue;

          const rawOverrides =
            listing.pricing_overrides != null && typeof listing.pricing_overrides === 'object'
              ? listing.pricing_overrides
              : undefined;
          const bypassProfitabilityGuard = readsBypassProfitabilityGuard(rawOverrides);

          // Profitability floor (read bypass from raw pricing_overrides JSON, not merged config)
          const hasProfitTarget = config.min_profit_margin_pct > 0;
          const hasManualFloor = listing.min_price_mode === 'manual' && listing.min_price_override_cents > 0;
          const effectiveCostCents = costInListingCurrency > 0 ? costInListingCurrency : listing.cost_basis_cents;

          if (
            shouldSkipForProfitabilityNoCost({
              bypassProfitabilityGuard,
              hasProfitTarget,
              effectiveCostCents,
              hasManualFloor,
            })
          ) {
            await this.recordDecision({
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
            continue;
          }

          const profitabilityFloorCents = resolveProfitabilityFloorCentsForAutoPricing({
            bypassProfitabilityGuard,
            hasProfitTarget,
            effectiveCostCents,
            commissionRatePercent: config.commission_rate_percent,
            minProfitMarginPct: config.min_profit_margin_pct,
            fixedFeeCents: config.fixed_fee_cents,
            isNetPricingModel,
          });

          // Budget check
          const budget = evaluatePriceChangeBudget(listing, config);
          if (!budget.allowed) {
            result.pricesSkippedRateLimit++;
            await this.recordDecision({
              seller_listing_id: listing.id, action: 'skipped',
              reason_code: 'budget_exhausted',
              reason_detail: 'Price change budget exhausted for this window',
              price_before_cents: listing.price_cents, target_price_cents: listing.price_cents,
              price_after_cents: null, effective_floor_cents: 0,
              competitor_count: 0, lowest_competitor_cents: null,
              our_position_before: null, our_position_after: null,
              estimated_fee_cents: 0, estimated_payout_cents: null,
              config_snapshot: configSnapshot, proposed_price_cents: null,
              second_lowest_competitor_cents: null,
              decision_context: { block_stage: 'budget_exhausted' },
            });
            result.decisionsRecorded++;
            continue;
          }

          const effectiveMin = bypassProfitabilityGuard
            ? computeRelaxedEffectiveMinCentsForAutoPricing(listing, config.min_price_floor_cents)
            : this.costBasisService.getEffectiveMinPrice(
              { ...listing, cost_basis_cents: effectiveCostCents },
              config.min_price_floor_cents,
              isNetPricingModel ? undefined : config.commission_rate_percent,
              profitabilityFloorCents,
            );

          // Fetch competitors — use pre-fetched cache when available.
          // Falls back to a live API call only when the batch pre-fetch was skipped
          // (e.g. adapter does not implement batchGetCompetitorPrices).
          let competitors: CompetitorPrice[] = [];
          if (hasCompetition) {
            if (listing.external_product_id && competitorCache.has(listing.external_product_id)) {
              competitors = stampCompetitorOwnership(
                competitorCache.get(listing.external_product_id)!,
                listing.external_listing_id,
              );
            } else if (!competitorCache.size) {
              // Batch pre-fetch not supported or skipped — fall back to per-listing call.
              try {
                competitors = await this.pricingService.getCompetitors(providerCode, listing.external_product_id);
                competitors = stampCompetitorOwnership(competitors, listing.external_listing_id);
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                const errName = err instanceof Error ? err.name : '';
                const isTransient =
                  errName === 'CircuitOpenError' ||
                  errName === 'RateLimitExceededError' ||
                  /^Circuit breaker open for /.test(errMsg) ||
                  /^Rate limit exceeded for /.test(errMsg);
                const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
                logFn('Failed to fetch competitors', {
                  requestId, listingId: listing.id,
                  error: errMsg,
                  transient: isTransient,
                });
              }
            }
            // If competitorCache.size > 0 but this productId is missing, S_competition simply
            // returned no data for it — treat as no competitors (empty array, already default).
          }

          // Snapshot + floors for smart pricing
          let preparedFloor: CompetitorFloorData | null = null;
          if (config.smart_pricing_enabled && competitors.length > 0) {
            const snapshotRows = await this.intelligenceService.prepareCompetitorSnapshot(
              listing.id, listing.provider_code,
              listing.external_product_id, competitors, listing.variant_id,
            );
            if (snapshotRows.length > 0) pendingSnapshots.push(...snapshotRows);

            preparedFloor = await this.intelligenceService.computeCompetitorFloors(listing.id, competitors);

            // Oscillation check
            const oscWindowHours = config.oscillation_window_hours > 0
              ? config.oscillation_window_hours
              : config.price_change_window_hours;
            const oscillation = await this.intelligenceService.detectOscillation(
              listing.id, oscWindowHours, config.oscillation_threshold,
            );
            if (oscillation.isOscillating && !budget.isFree) {
              result.pricesSkippedOscillation++;
              const liveForOsc = summarizeLiveCompetition(competitors);
              await this.recordDecision({
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
              continue;
            }
          }

          // Resolve target price
          const target = await this.resolvePriceTarget(
            listing, competitors, config, effectiveMin,
            providerCode, providerAccountId, requestId,
            hasCompetition, hasPricing, isNetPricingModel,
            effectiveCostCents, preparedFloor,
          );

          if (!target.shouldChange) {
            if (target.reasonCode !== 'no_competitors' && target.reasonCode !== 'dampening') {
              result.pricesSkippedIntelligence++;
              await this.recordDecision({
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
            continue;
          }

          // Worth-it check
          const worthIt = this.intelligenceService.isPriceChangeWorthIt(
            listing.price_cents, target.targetCents, budget.feeCents, config.min_change_delta_cents,
          );
          if (!worthIt.worthIt) {
            result.pricesSkippedIntelligence++;
            await this.recordDecision({
              seller_listing_id: listing.id, action: 'skipped',
              reason_code: 'not_worth_it', reason_detail: worthIt.reason ?? 'Price change not profitable enough',
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
            continue;
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
        } catch (err) {
          result.errors++;
          logger.error('Failed to compute price for listing', {
            requestId, listingId: listing.id, providerCode,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Flush accumulated snapshots
      if (pendingSnapshots.length > 0) {
        const flush = await this.intelligenceService.flushCompetitorSnapshots(pendingSnapshots);
        logger.info('Flushed competitor snapshots batch', {
          requestId, providerCode, rowCount: flush.inserted,
        });
      }

      // Batch update prices on marketplace
      if (batchUpdates.length > 0 && hasBatchPrice) {
        try {
          const mapped = batchUpdates.map((u) => ({
            externalListingId: u.externalListingId,
            priceCents: u.newPriceCents,
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

            await this.recordDecision(update.pendingDecision);
            result.decisionsRecorded++;

            if (update.feeCents > 0) {
              result.paidPriceChanges++;
              result.estimatedFeeCents += update.feeCents;
            }
          }

          result.pricesUpdated += batchResult.updated;
        } catch (err) {
          result.errors++;
          logger.error('Batch price update failed', {
            requestId, providerCode,
            error: err instanceof Error ? err.message : String(err),
          });
          for (const update of batchUpdates) {
            await this.recordDecision({
              ...update.pendingDecision,
              action: 'skipped', reason_code: 'batch_failed',
              reason_detail: `Batch update failed: ${err instanceof Error ? err.message : 'unknown'}`,
              price_after_cents: null,
            });
            result.decisionsRecorded++;
          }
        }
      }
    }

    logger.info('Auto-pricing refresh complete', { requestId, ...result });
    return result;
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
    const live = summarizeLiveCompetition(competitors);

    if (config.smart_pricing_enabled && competitors.length > 0) {
      const floorData: CompetitorFloorData = preparedFloor
        ? preparedFloor
        : await this.intelligenceService.computeCompetitorFloors(listing.id, competitors);

      let listingCompareGross = listing.price_cents;
      let effectiveMinGross = effectiveMin;

      if (isNetPricingModel && listing.external_listing_id) {
        listingCompareGross = await this.pricingService.reverseNetToGross(
          providerCode, providerAccountId,
          listing.price_cents, listing.currency, listing.listing_type as 'key_upload' | 'declared_stock',
          config.commission_rate_percent,
          listing.external_listing_id, listing.external_product_id ?? undefined,
        );
        effectiveMinGross = await this.pricingService.reverseNetToGross(
          providerCode, providerAccountId,
          effectiveMin, listing.currency, listing.listing_type as 'key_upload' | 'declared_stock',
          config.commission_rate_percent,
          listing.external_listing_id, listing.external_product_id ?? undefined,
        );
      }

      const analysis = await this.intelligenceService.analyzeOptimalPosition(
        { id: listing.id, price_cents: listing.price_cents },
        competitors, floorData, effectiveMinGross, config,
        listingCompareGross,
      );

      const convertGross = async (gross: number): Promise<number> => {
        if (isNetPricingModel && listing.external_listing_id) {
          return this.pricingService.reverseGrossToSellerPrice(
            providerCode, providerAccountId,
            gross, listing.currency, listing.listing_type as 'key_upload' | 'declared_stock',
            config.commission_rate_percent,
            listing.external_listing_id, listing.external_product_id ?? undefined,
          );
        }
        return gross;
      };

      return {
        targetCents: await convertGross(analysis.suggestedPriceCents),
        reasonCode: analysis.reasonCode,
        reasonDetail: analysis.skipReason ?? analysis.reason,
        shouldChange: analysis.shouldChange,
        competitorCount: live.nonOwnCount,
        lowestCompetitorCents: live.lowestNonOwnCents,
        ourPositionBefore: live.ourPositionBefore,
        proposedPriceCents: analysis.proposedPriceCents != null ? await convertGross(analysis.proposedPriceCents) : null,
        secondLowestCompetitorCents: live.secondLowestNonOwnCents ?? floorData.second_lowest_cents,
      };
    }

    // Fallback to simple strategy-based suggestion
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

  // ─── Private: DB queries ──────────────────────────────────────────

  private async getAutoSyncPriceListings(): Promise<SellerListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [
        ['status', 'active'],
        ['auto_sync_price', true],
      ],
    });

    const enriched: SellerListingRow[] = [];
    const accountIds = [...new Set(rows.map((r) => r.provider_account_id as string))];
    const accountMap = new Map<string, string>();

    for (const accountId of accountIds) {
      const account = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
        filter: { id: accountId },
      });
      if (account) accountMap.set(accountId, account.provider_code);
    }

    for (const row of rows) {
      const providerCode = accountMap.get(row.provider_account_id as string);
      if (!providerCode) continue;
      enriched.push({
        ...row as unknown as Omit<SellerListingRow, 'provider_code'>,
        provider_code: providerCode,
        provider_metadata: (row.provider_metadata as Record<string, unknown>) ?? {},
        pricing_overrides: (row.pricing_overrides as Record<string, unknown>) ?? null,
      } as SellerListingRow);
    }

    return enriched;
  }

  private async getActiveListings(): Promise<SellerListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [['status', 'active']],
    });

    const enriched: SellerListingRow[] = [];
    const accountIds = [...new Set(rows.map((r) => r.provider_account_id as string))];
    const accountMap = new Map<string, string>();

    for (const accountId of accountIds) {
      const account = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
        filter: { id: accountId },
      });
      if (account) accountMap.set(accountId, account.provider_code);
    }

    for (const row of rows) {
      const providerCode = accountMap.get(row.provider_account_id as string);
      if (!providerCode) continue;
      enriched.push({
        ...row as unknown as Omit<SellerListingRow, 'provider_code'>,
        provider_code: providerCode,
        provider_metadata: (row.provider_metadata as Record<string, unknown>) ?? {},
        pricing_overrides: (row.pricing_overrides as Record<string, unknown>) ?? null,
      } as SellerListingRow);
    }

    return enriched;
  }

  private async recordDecision(decision: PricingDecision): Promise<void> {
    try {
      await this.db.insert('seller_pricing_decisions', decision as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error('Failed to record pricing decision', {
        listingId: decision.seller_listing_id,
        action: decision.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
