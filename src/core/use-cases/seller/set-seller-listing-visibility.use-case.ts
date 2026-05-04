import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { SetSellerListingVisibilityDto, SetSellerListingVisibilityResult } from './seller-listing.types.js';

@injectable()
export class SetSellerListingVisibilityUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: SetSellerListingVisibilityDto): Promise<SetSellerListingVisibilityResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    const valid = ['all', 'retail', 'business'];
    if (!valid.includes(dto.visibility)) throw new Error(`visibility must be one of: ${valid.join(', ')}`);
    return this.repo.setSellerListingVisibility(dto);
  }
}
