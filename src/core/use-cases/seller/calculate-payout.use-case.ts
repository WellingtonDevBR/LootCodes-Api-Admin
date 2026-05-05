import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerPricingService } from '../../ports/seller-pricing.port.js';
import type { CalculatePayoutDto, CalculatePayoutResult } from './seller-pricing.types.js';
import { parseSellerConfig } from './seller.types.js';

@injectable()
export class CalculatePayoutUseCase {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.SellerPricingService) private pricingService: ISellerPricingService,
  ) {}

  async execute(dto: CalculatePayoutDto): Promise<CalculatePayoutResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (!dto.price_cents || dto.price_cents <= 0) throw new Error('price_cents must be positive');

    const listing = await this.db.queryOne<Record<string, unknown>>('seller_listings', {
      filter: { id: dto.listing_id },
    });
    if (!listing) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const account = await this.db.queryOne<Record<string, unknown>>('provider_accounts', {
      filter: { id: listing.provider_account_id as string },
    });
    if (!account) throw new Error(`Provider account not found`);

    const providerCode = account.provider_code as string;
    const parsedConfig = parseSellerConfig((account.seller_config as Record<string, unknown>) ?? {});
    const overrides = (listing.pricing_overrides ?? {}) as Record<string, unknown>;

    const payout = await this.pricingService.calculatePayout(
      {
        priceCents: dto.price_cents,
        currency: (listing.currency as string) ?? parsedConfig.default_currency,
        listingType: (listing.listing_type as string) ?? parsedConfig.default_listing_type,
        externalListingId: listing.external_listing_id as string | undefined,
        externalProductId: listing.external_product_id as string | undefined,
      },
      providerCode,
      listing.provider_account_id as string,
    );

    const costBasis = (overrides.cost_basis_override_cents as number)
      ?? (listing.cost_basis_cents as number)
      ?? null;

    const effectiveFloor = (listing.min_price_cents as number) || costBasis || 0;
    const profitCents = costBasis != null ? payout.netPayoutCents - costBasis : null;
    const profitPercent = costBasis != null && costBasis > 0
      ? Math.round((profitCents! / costBasis) * 10000) / 100
      : null;

    return {
      listing_id: dto.listing_id,
      payout: {
        gross_price_cents: payout.grossPriceCents,
        marketplace_fee_cents: payout.feeCents,
        marketplace_fee_percent: dto.price_cents > 0
          ? Math.round((payout.feeCents / dto.price_cents) * 10000) / 100
          : 0,
        net_payout_cents: payout.netPayoutCents,
        effective_floor_cents: effectiveFloor,
        cost_basis_cents: costBasis,
        profit_cents: profitCents,
        profit_percent: profitPercent,
      },
    };
  }
}
