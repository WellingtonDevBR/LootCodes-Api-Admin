import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminSellerPricingRepository } from '../../core/ports/admin-seller-pricing-repository.port.js';
import type {
  CalculatePayoutDto,
  CalculatePayoutResult,
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
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminSellerPricingRepository');

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

    const sellerConfig = (account?.seller_config ?? {}) as Record<string, unknown>;
    const overrides = (listing.pricing_overrides ?? {}) as Record<string, unknown>;

    const commissionPercent = (overrides.commission_override_percent as number)
      ?? (sellerConfig.commission_rate_percent as number)
      ?? 10;

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

    const result = await this.db.invokeFunction<GetCompetitorsResult>('provider-procurement', {
      action: 'seller-pricing',
      sub_action: 'get-competitors',
      listing_id: dto.listing_id,
    });

    return {
      listing_id: dto.listing_id,
      competitors: result.competitors ?? [],
      own_position: result.own_position ?? null,
      own_price_cents: result.own_price_cents ?? null,
    };
  }

  async suggestPrice(dto: SuggestPriceDto): Promise<SuggestPriceResult> {
    logger.info('Suggesting price', { listingId: dto.listing_id });

    const result = await this.db.invokeFunction<SuggestPriceResult>('provider-procurement', {
      action: 'seller-pricing',
      sub_action: 'suggest-price',
      listing_id: dto.listing_id,
      effective_cost_cents: dto.effective_cost_cents,
      listing_type: dto.listing_type,
    });

    return {
      listing_id: dto.listing_id,
      suggestion: result.suggestion ?? null,
    };
  }

  async dryRunPricing(dto: DryRunPricingDto): Promise<DryRunPricingResult> {
    logger.info('Running pricing dry-run', { listingId: dto.listing_id });

    const result = await this.db.invokeFunction<{ dry_run: DryRunPricingResult['dry_run'] }>('provider-procurement', {
      action: 'seller-pricing',
      sub_action: 'dry-run',
      listing_id: dto.listing_id,
    });

    return {
      listing_id: dto.listing_id,
      dry_run: result.dry_run,
    };
  }

  async getDecisionHistory(dto: GetDecisionHistoryDto): Promise<GetDecisionHistoryResult> {
    const limit = dto.limit ?? 15;
    const offset = dto.offset ?? 0;

    const { data, total } = await this.db.queryPaginated<Record<string, unknown>>('seller_pricing_decisions', {
      eq: [['seller_listing_id', dto.listing_id]],
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    });

    const decisions: PricingDecisionItem[] = data.map((r) => ({
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
      created_at: r.created_at as string,
    }));

    return { listing_id: dto.listing_id, decisions, total };
  }

  async getLatestDecision(dto: GetLatestDecisionDto): Promise<GetLatestDecisionResult> {
    const row = await this.db.queryOne<Record<string, unknown>>('seller_pricing_decisions', {
      eq: [['seller_listing_id', dto.listing_id]],
      order: { column: 'created_at', ascending: false },
      limit: 1,
    });

    if (!row) {
      return { listing_id: dto.listing_id, decision: null };
    }

    return {
      listing_id: dto.listing_id,
      decision: {
        id: row.id as string,
        listing_id: row.seller_listing_id as string,
        action: row.action as string,
        reason_code: row.reason_code as string,
        price_before_cents: row.price_before_cents as number,
        target_price_cents: row.target_price_cents as number,
        lowest_competitor_cents: (row.lowest_competitor_cents as number) ?? null,
        our_position_before: (row.our_position_before as number) ?? null,
        estimated_fee_cents: (row.estimated_fee_cents as number) ?? null,
        config_snapshot: (row.config_snapshot as Record<string, unknown>) ?? null,
        decision_context: (row.decision_context as Record<string, unknown>) ?? null,
        created_at: row.created_at as string,
      },
    };
  }

  async getProviderDefaults(dto: GetProviderDefaultsDto): Promise<GetProviderDefaultsResult> {
    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: dto.provider_account_id },
    });

    if (!account) throw new Error(`Provider account ${dto.provider_account_id} not found`);

    const config = (account.seller_config ?? {}) as Record<string, unknown>;
    const defaults: ProviderSellerDefaults = {
      commission_rate_percent: (config.commission_rate_percent as number) ?? null,
      min_price_floor_cents: (config.min_price_floor_cents as number) ?? null,
      price_strategy: (config.price_strategy as string) ?? null,
      price_strategy_value: (config.price_strategy_value as number) ?? null,
      default_listing_type: (config.default_listing_type as string) ?? null,
      default_currency: (config.default_currency as string) ?? null,
      auto_list_new_stock: (config.auto_list_new_stock as boolean) ?? false,
    };

    return { provider_account_id: dto.provider_account_id, defaults };
  }
}
