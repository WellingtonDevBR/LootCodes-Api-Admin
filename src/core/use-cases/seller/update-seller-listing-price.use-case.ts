import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { UpdateSellerListingPriceDto, UpdateSellerListingPriceResult } from './seller-listing.types.js';

@injectable()
export class UpdateSellerListingPriceUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UpdateSellerListingPriceDto): Promise<UpdateSellerListingPriceResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (!dto.price_cents || dto.price_cents <= 0) throw new Error('price_cents must be positive');
    return this.repo.updateSellerListingPrice(dto);
  }
}
