import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { UpdateSellerListingMinPriceDto, UpdateSellerListingMinPriceResult } from './seller-listing.types.js';

@injectable()
export class UpdateSellerListingMinPriceUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UpdateSellerListingMinPriceDto): Promise<UpdateSellerListingMinPriceResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (dto.mode !== 'auto' && dto.mode !== 'manual') throw new Error('mode must be auto or manual');
    if (dto.mode === 'manual' && (dto.override_cents === undefined || dto.override_cents < 0)) {
      throw new Error('override_cents required for manual mode');
    }
    return this.repo.updateSellerListingMinPrice(dto);
  }
}
