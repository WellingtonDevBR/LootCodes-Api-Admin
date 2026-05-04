import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerPricingRepository } from '../../ports/admin-seller-pricing-repository.port.js';
import type { GetProviderDefaultsDto, GetProviderDefaultsResult } from './seller-pricing.types.js';

@injectable()
export class GetProviderDefaultsUseCase {
  constructor(
    @inject(TOKENS.AdminSellerPricingRepository) private repo: IAdminSellerPricingRepository,
  ) {}

  async execute(dto: GetProviderDefaultsDto): Promise<GetProviderDefaultsResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');
    return this.repo.getProviderDefaults(dto);
  }
}
