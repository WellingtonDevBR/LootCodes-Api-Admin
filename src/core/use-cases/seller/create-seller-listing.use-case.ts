import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { CreateSellerListingDto, CreateSellerListingResult } from './seller-listing.types.js';

@injectable()
export class CreateSellerListingUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: CreateSellerListingDto): Promise<CreateSellerListingResult> {
    if (!dto.variant_id) throw new Error('variant_id is required');
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');
    if (!dto.price_cents || dto.price_cents <= 0) throw new Error('price_cents must be positive');
    if (!dto.currency) throw new Error('currency is required');
    if (!dto.listing_type) throw new Error('listing_type is required');
    return this.repo.createSellerListing(dto);
  }
}
