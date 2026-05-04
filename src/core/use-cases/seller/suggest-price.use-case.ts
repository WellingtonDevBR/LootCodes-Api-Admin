import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerPricingRepository } from '../../ports/admin-seller-pricing-repository.port.js';
import type { SuggestPriceDto, SuggestPriceResult } from './seller-pricing.types.js';

@injectable()
export class SuggestPriceUseCase {
  constructor(
    @inject(TOKENS.AdminSellerPricingRepository) private repo: IAdminSellerPricingRepository,
  ) {}

  async execute(dto: SuggestPriceDto): Promise<SuggestPriceResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (dto.effective_cost_cents < 0) throw new Error('effective_cost_cents cannot be negative');
    return this.repo.suggestPrice(dto);
  }
}
