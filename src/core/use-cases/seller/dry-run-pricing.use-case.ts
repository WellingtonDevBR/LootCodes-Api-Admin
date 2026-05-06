import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerPricingService } from '../../ports/seller-pricing.port.js';
import type { DryRunPricingDto, DryRunPricingResult } from './seller-pricing.types.js';
import { parseSellerConfig } from './seller.types.js';
import type { SellerPriceIntelligenceService } from '../../../infra/seller/pricing/seller-price-intelligence.service.js';
import type { SellerCostBasisService } from '../../../infra/seller/pricing/seller-cost-basis.service.js';
import { mergeSellerListingPricingOverrides } from './listing-pricing-overrides-merge.js';
import {
  readsBypassProfitabilityGuard,
  computeRelaxedEffectiveMinCentsForAutoPricing,
} from './auto-pricing-profitability-guard.js';

@injectable()
export class DryRunPricingUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.SellerPricingService) private pricingService: ISellerPricingService,
    @inject(TOKENS.SellerPriceIntelligenceService) private intelligence: SellerPriceIntelligenceService,
    @inject(TOKENS.SellerCostBasisService) private costBasis: SellerCostBasisService,
  ) {}

  async execute(dto: DryRunPricingDto): Promise<DryRunPricingResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });
    const parsedConfig = parseSellerConfig((account?.seller_config as Record<string, unknown>) ?? {});
    const overrides = (listing.pricing_overrides ?? {}) as Record<string, unknown>;

    const mergedConfig = mergeSellerListingPricingOverrides(parsedConfig, overrides);

    const commissionPercent = (overrides.commission_override_percent as number)
      ?? parsedConfig.commission_rate_percent;

    const currentPriceCents = (listing.price_cents as number) ?? 0;

    let costBasisCents = (overrides.cost_basis_override_cents as number)
      ?? (listing.cost_basis_cents as number)
      ?? null;

    if (costBasisCents == null && listing.variant_id) {
      const computed = await this.costBasis.computeCostBasis(listing.variant_id as string);
      costBasisCents = computed;
    }

    const bypass = readsBypassProfitabilityGuard(overrides);
    const effectiveFloor = bypass
      ? computeRelaxedEffectiveMinCentsForAutoPricing(
          {
            min_price_mode: String(listing.min_price_mode ?? 'auto'),
            min_price_override_cents: Number(listing.min_price_override_cents ?? 0),
          },
          mergedConfig.min_price_floor_cents,
        )
      : ((listing.min_price_cents as number) || costBasisCents || 0);

    const floor = await this.db.queryOne<Record<string, unknown>>('seller_competitor_floors', {
      eq: [['seller_listing_id', dto.listing_id]],
    });

    const lowestCompetitor = (floor?.lowest_competitor_cents as number) ?? null;
    const competitorCount = (floor?.competitor_count as number) ?? 0;
    const ourPosition = (floor?.our_current_position as number) ?? null;

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

      const worthItCheck = this.intelligence.isPriceChangeWorthIt(
        currentPriceCents,
        targetPriceCents,
        Math.round(targetPriceCents * commissionPercent / 100),
        10,
      );
      if (!worthItCheck.worthIt) {
        isDampened = true;
        skipReason = worthItCheck.reason ?? 'Price difference too small to justify change';
        worthIt = false;
      } else {
        wouldChange = true;
      }
    }

    const oscillation = await this.intelligence.detectOscillation(dto.listing_id, 2, 4);
    oscillationDetected = oscillation.isOscillating;
    if (oscillationDetected && wouldChange) {
      skipReason = oscillation.reason ?? 'Oscillation detected';
    }

    const profitability = costBasisCents != null
      ? {
        cost_basis_cents: costBasisCents,
        net_payout_cents: targetPriceCents - Math.round(targetPriceCents * commissionPercent / 100),
        profit_cents: targetPriceCents - Math.round(targetPriceCents * commissionPercent / 100) - costBasisCents,
      }
      : null;

    return {
      listing_id: dto.listing_id,
      dry_run: {
        current_price_cents: currentPriceCents,
        target_price_cents: targetPriceCents,
        would_change: wouldChange,
        effective_floor_cents: effectiveFloor,
        cost_basis_cents: costBasisCents,
        competitor_count: competitorCount,
        lowest_competitor_cents: lowestCompetitor,
        our_position: ourPosition,
        is_dampened: isDampened,
        oscillation_detected: oscillationDetected,
        worth_it: worthIt,
        skip_reason: skipReason,
        floor_data: floor ? { ...(floor as object) } : null,
        config: {
          commission_percent: commissionPercent,
          strategy: mergedConfig.price_strategy,
          strategy_value: mergedConfig.price_strategy_value,
        },
        profitability,
      },
    };
  }
}
