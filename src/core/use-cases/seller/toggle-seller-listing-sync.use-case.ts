import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { ToggleSellerListingSyncDto, ToggleSellerListingSyncResult } from './seller-listing.types.js';

@injectable()
export class ToggleSellerListingSyncUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: ToggleSellerListingSyncDto): Promise<ToggleSellerListingSyncResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    if (dto.sync_stock === undefined && dto.sync_price === undefined) {
      throw new Error('At least one of sync_stock or sync_price must be provided');
    }
    return this.repo.toggleSellerListingSync(dto);
  }
}
