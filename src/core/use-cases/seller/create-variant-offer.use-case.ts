import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { CreateVariantOfferDto, CreateVariantOfferResult } from './seller.types.js';

@injectable()
export class CreateVariantOfferUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: CreateVariantOfferDto): Promise<CreateVariantOfferResult> {
    return this.repo.createVariantOffer(dto);
  }
}
