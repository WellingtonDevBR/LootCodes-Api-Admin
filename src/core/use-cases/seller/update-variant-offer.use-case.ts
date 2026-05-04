import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { UpdateVariantOfferDto, UpdateVariantOfferResult } from './seller.types.js';

@injectable()
export class UpdateVariantOfferUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UpdateVariantOfferDto): Promise<UpdateVariantOfferResult> {
    return this.repo.updateVariantOffer(dto);
  }
}
