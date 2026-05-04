import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerPricingRepository } from '../../ports/admin-seller-pricing-repository.port.js';
import type { CalculatePayoutDto, CalculatePayoutResult } from './seller-pricing.types.js';

@injectable()
export class CalculatePayoutUseCase {
  constructor(
    @inject(TOKENS.AdminSellerPricingRepository) private repo: IAdminSellerPricingRepository,
  ) {}

  async execute(dto: CalculatePayoutDto): Promise<CalculatePayoutResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (!dto.price_cents || dto.price_cents <= 0) throw new Error('price_cents must be positive');
    return this.repo.calculatePayout(dto);
  }
}
