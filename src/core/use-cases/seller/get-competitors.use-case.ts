import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerPricingRepository } from '../../ports/admin-seller-pricing-repository.port.js';
import type { GetCompetitorsDto, GetCompetitorsResult } from './seller-pricing.types.js';

@injectable()
export class GetCompetitorsUseCase {
  constructor(
    @inject(TOKENS.AdminSellerPricingRepository) private repo: IAdminSellerPricingRepository,
  ) {}

  async execute(dto: GetCompetitorsDto): Promise<GetCompetitorsResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    return this.repo.getCompetitors(dto);
  }
}
