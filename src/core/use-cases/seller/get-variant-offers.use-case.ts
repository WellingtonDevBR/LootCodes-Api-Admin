import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { GetVariantOffersDto, GetVariantOffersResult } from './seller.types.js';

@injectable()
export class GetVariantOffersUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: GetVariantOffersDto): Promise<GetVariantOffersResult> {
    if (!dto.variant_id) {
      throw new Error('variant_id is required');
    }
    return this.repo.getVariantOffers(dto);
  }
}
