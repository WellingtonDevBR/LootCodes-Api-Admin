import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSellerPricingRepository } from '../../core/ports/admin-seller-pricing-repository.port.js';
import type {
  CalculatePayoutDto,
  CalculatePayoutResult,
  CompetitorItem,
  GetCompetitorsDto,
  GetCompetitorsResult,
  SuggestPriceDto,
  SuggestPriceResult,
  DryRunPricingDto,
  DryRunPricingResult,
  GetDecisionHistoryDto,
  GetDecisionHistoryResult,
  GetLatestDecisionDto,
  GetLatestDecisionResult,
  GetProviderDefaultsDto,
  GetProviderDefaultsResult,
  PricingDecisionItem,
  ProviderSellerDefaults,
} from '../../core/use-cases/seller/seller-pricing.types.js';
import { parseSellerConfig } from '../../core/use-cases/seller/seller.types.js';
import { mergeSellerListingPricingOverrides } from '../../core/use-cases/seller/listing-pricing-overrides-merge.js';
import {
  readsBypassProfitabilityGuard,
  readsBypassFloorPct,
  computeRelaxedEffectiveMinCentsForAutoPricing,
} from '../../core/use-cases/seller/auto-pricing-profitability-guard.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSellerPricingRepository');

function resolveSellerConfigFromAccount(account: Record<string, unknown> | null) {
  return parseSellerConfig((account?.seller_config as Record<string, unknown>) ?? {});
}

function toPricingDecisionItem(r: Record<string, unknown>): PricingDecisionItem {
  return {
    id: r.id as string,
    listing_id: r.seller_listing_id as string,
    action: r.action as string,
    reason_code: r.reason_code as string,
    price_before_cents: r.price_before_cents as number,
    target_price_cents: r.target_price_cents as number,
    lowest_competitor_cents: (r.lowest_competitor_cents as number) ?? null,
    our_position_before: (r.our_position_before as number) ?? null,
    estimated_fee_cents: (r.estimated_fee_cents as number) ?? null,
    config_snapshot: (r.config_snapshot as Record<string, unknown>) ?? null,
    decision_context: (r.decision_context as Record<string, unknown>) ?? null,
    created_at: (r.decided_at as string) ?? (r.created_at as string),
  };
}

@injectable()
export class SupabaseAdminSellerPricingRepository implements IAdminSellerPricingRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async calculatePayout(dto: CalculatePayoutDto): Promise<CalculatePayoutResult> {
    logger.info('Calculating payout', { listingId: dto.listing_id, priceCents: dto.price_cents });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });

    const parsedConfig = resolveSellerConfigFromAccount(account);
    const overrides = (listing.pricing_overrides ?? {}) as Record<string, unknown>;

    const commissionPercent = (overrides.commission_override_percent as number)
      ?? parsedConfig.commission_rate_percent;

    const grossPrice = dto.price_cents;
    const feeCents = Math.round(grossPrice * commissionPercent / 100);
    const netPayout = grossPrice - feeCents;

    const costBasis = (overrides.cost_basis_override_cents as number)
      ?? (listing.cost_basis_cents as number)
      ?? null;

    const effectiveFloor = (listing.min_price_cents as number) || costBasis || 0;

    const profitCents = costBasis != null ? netPayout - costBasis : null;
    const profitPercent = costBasis != null && costBasis > 0
      ? Math.round((profitCents! / costBasis) * 10000) / 100
      : null;

    return {
      listing_id: dto.listing_id,
      payout: {
        gross_price_cents: grossPrice,
        marketplace_fee_cents: feeCents,
        marketplace_fee_percent: commissionPercent,
        net_payout_cents: netPayout,
        effective_floor_cents: effectiveFloor,
        cost_basis_cents: costBasis,
        profit_cents: profitCents,
        profit_percent: profitPercent,
      },
    };
  }

  async getCompetitors(dto: GetCompetitorsDto): Promise<GetCompetitorsResult> {
    logger.info('Getting competitors', { listingId: dto.listing_id });

    const snapshots = await this.db.query<Record<string, unknown>>('seller_competitor_snapshots', {
      eq: [['seller_listing_id', dto.listing_id]],
      order: { column: 'price_cents', ascending: true },
    });

    const competitors: CompetitorItem[] = snapshots.map(s => ({
      merchant_name: (s.merchant_name as string) ?? 'Unknown',
      price_cents: (s.price_cents as number) ?? 0,
      currency: (s.currency as string) ?? 'EUR',
      in_stock: (s.in_stock as boolean) ?? false,
      is_own_offer: (s.is_own_offer as boolean) ?? false,
    }));

    const ownOffer = competitors.find(c => c.is_own_offer);
    let ownPosition: number | null = null;
    if (ownOffer) {
      ownPosition = competitors.filter(c => c.in_stock).findIndex(c => c.is_own_offer) + 1;
      if (ownPosition === 0) ownPosition = null;
    }

    return {
      listing_id: dto.listing_id,
      competitors,
      own_position: ownPosition,
      own_price_cents: ownOffer?.price_cents ?? null,
    };
  }

  async suggestPrice(dto: SuggestPriceDto): Promise<SuggestPriceResult> {
    logger.info('Suggesting price', { listingId: dto.listing_id });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });
    const parsedConfig = resolveSellerConfigFromAccount(account);
    const overrides = (listing.pricing_overrides ?? {}) as Record<string, unknown>;

    const strategy = (overrides.price_strategy as string)
      ?? parsedConfig.price_strategy;
    const strategyValue = (overrides.price_strategy_value as number)
      ?? parsedConfig.price_strategy_value;
    const commissionPercent = (overrides.commission_override_percent as number)
      ?? parsedConfig.commission_rate_percent;

    const floor = await this.db.queryOne<Record<string, unknown>>('seller_competitor_floors', {
      eq: [['seller_listing_id', dto.listing_id]],
    });

    const lowestCompetitor = (floor?.lowest_competitor_cents as number) ?? null;
    const competitorCount = (floor?.competitor_count as number) ?? 0;

    let suggestedCents: number;
    let reasoning: string;

    if (lowestCompetitor == null || competitorCount === 0) {
      const markup = Math.round(dto.effective_cost_cents * 0.3);
      suggestedCents = dto.effective_cost_cents + markup;
      reasoning = 'No competitor data available. Using 30% markup over cost basis.';
    } else if (strategy === 'undercut_percent' && strategyValue != null) {
      suggestedCents = Math.round(lowestCompetitor * (1 - strategyValue / 100));
      reasoning = `Undercut lowest competitor (${lowestCompetitor}) by ${strategyValue}%.`;
    } else if (strategy === 'margin_target' && strategyValue != null) {
      suggestedCents = Math.round(dto.effective_cost_cents * (1 + strategyValue / 100));
      reasoning = `Target ${strategyValue}% margin over cost.`;
    } else if (strategy === 'fixed' && strategyValue != null) {
      suggestedCents = strategyValue;
      reasoning = `Fixed price strategy.`;
    } else {
      suggestedCents = lowestCompetitor;
      reasoning = `Match lowest competitor at ${lowestCompetitor}.`;
    }

    const bypassSuggest = readsBypassProfitabilityGuard(overrides);
    if (!bypassSuggest && dto.effective_cost_cents > 0) {
      const minFloor = dto.effective_cost_cents + Math.round(dto.effective_cost_cents * 0.05);
      if (suggestedCents < minFloor) {
        suggestedCents = minFloor;
        reasoning += ' Adjusted up to maintain 5% minimum margin.';
      }
    }

    const feeCents = Math.round(suggestedCents * commissionPercent / 100);
    const estimatedPayout = suggestedCents - feeCents;

    return {
      listing_id: dto.listing_id,
      suggestion: {
        suggested_price_cents: suggestedCents,
        strategy,
        strategy_value: strategyValue,
        estimated_payout_cents: estimatedPayout,
        reasoning,
      },
    };
  }

  async dryRunPricing(dto: DryRunPricingDto): Promise<DryRunPricingResult> {
    logger.info('Running pricing dry-run', { listingId: dto.listing_id });

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });
    const parsedConfig = resolveSellerConfigFromAccount(account);
    const overrides = (listing.pricing_overrides ?? {}) as Record<string, unknown>;
    const mergedConfig = mergeSellerListingPricingOverrides(parsedConfig, overrides);

    const commissionPercent = (overrides.commission_override_percent as number)
      ?? parsedConfig.commission_rate_percent;
    const costBasis = (overrides.cost_basis_override_cents as number)
      ?? (listing.cost_basis_cents as number)
      ?? null;

    const currentPriceCents = (listing.price_cents as number) ?? 0;
    const bypassDryRun = readsBypassProfitabilityGuard(overrides);
    const bypassFloorPctDryRun = readsBypassFloorPct(overrides);
    const effectiveFloor = bypassDryRun
      ? computeRelaxedEffectiveMinCentsForAutoPricing(
          {
            min_price_mode: String(listing.min_price_mode ?? 'auto'),
            min_price_override_cents: Number(listing.min_price_override_cents ?? 0),
          },
          mergedConfig.min_price_floor_cents,
          costBasis ?? 0,
          bypassFloorPctDryRun,
        )
      : ((listing.min_price_cents as number) || costBasis || 0);

    const floor = await this.db.queryOne<Record<string, unknown>>('seller_competitor_floors', {
      eq: [['seller_listing_id', dto.listing_id]],
    });

    const lowestCompetitor = (floor?.lowest_competitor_cents as number) ?? null;
    const competitorCount = (floor?.competitor_count as number) ?? 0;
    const ourPosition = (floor?.our_current_position as number) ?? null;
    const priceStableSince = floor?.price_stable_since as string | null;

    let targetPriceCents = currentPriceCents;
    let wouldChange = false;
    let isDampened = false;
    let oscillationDetected = false;
    let worthIt = true;
    let skipReason: string | null = null;

    if (lowestCompetitor != null && lowestCompetitor < currentPriceCents) {
      targetPriceCents = lowestCompetitor;

      if (targetPriceCents < effectiveFloor) {
        targetPriceCents = effectiveFloor;
        skipReason = 'Target price below floor';
        worthIt = false;
      }

      const diff = Math.abs(targetPriceCents - currentPriceCents);
      if (diff < 10) {
        isDampened = true;
        skipReason = 'Price difference too small to justify change';
        worthIt = false;
      } else {
        wouldChange = true;
      }
    }

    if (priceStableSince) {
      const stableDuration = Date.now() - new Date(priceStableSince).getTime();
      if (stableDuration < 5 * 60_000 && wouldChange) {
        oscillationDetected = true;
      }
    }

    const profitability = costBasis != null
      ? {
        cost_basis_cents: costBasis,
        net_payout_cents: targetPriceCents - Math.round(targetPriceCents * commissionPercent / 100),
        profit_cents: targetPriceCents - Math.round(targetPriceCents * commissionPercent / 100) - costBasis,
      }
      : null;

    return {
      listing_id: dto.listing_id,
      dry_run: {
        current_price_cents: currentPriceCents,
        target_price_cents: targetPriceCents,
        would_change: wouldChange,
        effective_floor_cents: effectiveFloor,
        cost_basis_cents: costBasis,
        competitor_count: competitorCount,
        lowest_competitor_cents: lowestCompetitor,
        our_position: ourPosition,
        is_dampened: isDampened,
        oscillation_detected: oscillationDetected,
        worth_it: worthIt,
        skip_reason: skipReason,
        floor_data: floor ? { ...(floor as object) } : null,
        config: { commission_percent: commissionPercent, strategy: parsedConfig.price_strategy },
        profitability,
      },
    };
  }

  async getDecisionHistory(dto: GetDecisionHistoryDto): Promise<GetDecisionHistoryResult> {
    const limit = dto.limit ?? 15;
    const offset = dto.offset ?? 0;

    const { data, total } = await this.db.queryPaginated<Record<string, unknown>>('seller_pricing_decisions', {
      eq: [['seller_listing_id', dto.listing_id]],
      order: { column: 'decided_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    return {
      listing_id: dto.listing_id,
      decisions: data.map(toPricingDecisionItem),
      total,
    };
  }

  async getLatestDecision(dto: GetLatestDecisionDto): Promise<GetLatestDecisionResult> {
    const row = await this.db.queryOne<Record<string, unknown>>('seller_pricing_decisions', {
      eq: [['seller_listing_id', dto.listing_id]],
      order: { column: 'decided_at', ascending: false },
      limit: 1,
    });

    return {
      listing_id: dto.listing_id,
      decision: row ? toPricingDecisionItem(row) : null,
    };
  }

  async getProviderDefaults(dto: GetProviderDefaultsDto): Promise<GetProviderDefaultsResult> {
    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: dto.provider_account_id },
    });

    if (!account) throw new Error(`Provider account ${dto.provider_account_id} not found`);

    const parsedConfig = resolveSellerConfigFromAccount(account);
    const defaults: ProviderSellerDefaults = {
      commission_rate_percent: parsedConfig.commission_rate_percent,
      min_price_floor_cents: parsedConfig.min_price_floor_cents,
      price_strategy: parsedConfig.price_strategy,
      price_strategy_value: parsedConfig.price_strategy_value,
      default_listing_type: parsedConfig.default_listing_type,
      default_currency: parsedConfig.default_currency,
      auto_list_new_stock: parsedConfig.auto_list_new_stock,
    };

    return { provider_account_id: dto.provider_account_id, defaults };
  }
}
