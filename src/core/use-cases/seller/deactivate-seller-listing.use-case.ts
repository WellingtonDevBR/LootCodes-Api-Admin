import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { DeactivateSellerListingDto, DeactivateSellerListingResult } from './seller-listing.types.js';

@injectable()
export class DeactivateSellerListingUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: DeactivateSellerListingDto): Promise<DeactivateSellerListingResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    return this.repo.deactivateSellerListing(dto);
  }
}
