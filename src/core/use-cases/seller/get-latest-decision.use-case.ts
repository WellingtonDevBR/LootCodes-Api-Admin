import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerPricingRepository } from '../../ports/admin-seller-pricing-repository.port.js';
import type { GetLatestDecisionDto, GetLatestDecisionResult } from './seller-pricing.types.js';

@injectable()
export class GetLatestDecisionUseCase {
  constructor(
    @inject(TOKENS.AdminSellerPricingRepository) private repo: IAdminSellerPricingRepository,
  ) {}

  async execute(dto: GetLatestDecisionDto): Promise<GetLatestDecisionResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    return this.repo.getLatestDecision(dto);
  }
}
