import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerPricingRepository } from '../../ports/admin-seller-pricing-repository.port.js';
import type { DryRunPricingDto, DryRunPricingResult } from './seller-pricing.types.js';

@injectable()
export class DryRunPricingUseCase {
  constructor(
    @inject(TOKENS.AdminSellerPricingRepository) private repo: IAdminSellerPricingRepository,
  ) {}

  async execute(dto: DryRunPricingDto): Promise<DryRunPricingResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    return this.repo.dryRunPricing(dto);
  }
}
