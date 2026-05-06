import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { UpdateSellerListingOverridesDto, UpdateSellerListingOverridesResult, SellerListingPricingOverrides } from './seller-listing.types.js';
import type { SellerPriceStrategy } from './seller.types.js';

const VALID_STRATEGIES: SellerPriceStrategy[] = [
  'fixed',
  'match_lowest',
  'undercut_percent',
  'undercut_fixed',
  'margin_target',
  'smart_compete',
];

@injectable()
export class UpdateSellerListingOverridesUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UpdateSellerListingOverridesDto): Promise<UpdateSellerListingOverridesResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');

    const sanitised: SellerListingPricingOverrides = { ...dto.overrides };

    if (sanitised.price_strategy != null) {
      if (!VALID_STRATEGIES.includes(sanitised.price_strategy)) {
        throw new Error(`Invalid price_strategy: ${sanitised.price_strategy}. Valid: ${VALID_STRATEGIES.join(', ')}`);
      }
    }

    if (sanitised.price_strategy_value != null) {
      if (typeof sanitised.price_strategy_value !== 'number' || sanitised.price_strategy_value < 0) {
        throw new Error('price_strategy_value must be a non-negative number');
      }
    }

    if (sanitised.bypass_profitability_guard != null) {
      if (typeof sanitised.bypass_profitability_guard !== 'boolean') {
        throw new Error('bypass_profitability_guard must be a boolean');
      }
    }

    return this.repo.updateSellerListingOverrides({
      ...dto,
      overrides: sanitised,
    });
  }
}
