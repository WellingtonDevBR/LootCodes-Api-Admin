import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { SyncSellerStockDto, SyncSellerStockResult } from './seller-listing.types.js';

@injectable()
export class SyncSellerStockUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: SyncSellerStockDto): Promise<SyncSellerStockResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    return this.repo.syncSellerStock(dto);
  }
}
