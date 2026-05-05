import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerPricingService } from '../../ports/seller-pricing.port.js';
import type { SuggestPriceDto, SuggestPriceResult } from './seller-pricing.types.js';

@injectable()
export class SuggestPriceUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.SellerPricingService) private pricingService: ISellerPricingService,
  ) {}

  async execute(dto: SuggestPriceDto): Promise<SuggestPriceResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (dto.effective_cost_cents < 0) throw new Error('effective_cost_cents cannot be negative');

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const suggestion = await this.pricingService.suggestPrice({
      listingId: dto.listing_id,
      externalProductId: (listing.external_product_id as string) ?? '',
      costCents: dto.effective_cost_cents,
      listingType: dto.listing_type ?? (listing.listing_type as string),
      listingMinCents: (listing.min_price_cents as number) ?? 0,
      listingCurrency: (listing.currency as string) ?? undefined,
      externalListingId: (listing.external_listing_id as string) ?? undefined,
      providerAccountId: listing.provider_account_id as string,
    });

    return {
      listing_id: dto.listing_id,
      suggestion: {
        suggested_price_cents: suggestion.suggestedPriceCents,
        strategy: suggestion.strategy,
        strategy_value: null,
        estimated_payout_cents: suggestion.estimatedPayoutCents,
        reasoning: suggestion.competitorsUnavailable
          ? `Competitor data unavailable. Using cost-based strategy (${suggestion.strategy}).`
          : `Strategy: ${suggestion.strategy}. Lowest competitor: ${suggestion.lowestCompetitorCents ?? 'N/A'}. Fee: ${suggestion.estimatedFeeCents}.`,
      },
    };
  }
}
