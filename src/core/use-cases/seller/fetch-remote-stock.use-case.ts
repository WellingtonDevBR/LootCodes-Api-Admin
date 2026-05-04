import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { FetchRemoteStockDto, FetchRemoteStockResult } from './seller-listing.types.js';

@injectable()
export class FetchRemoteStockUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: FetchRemoteStockDto): Promise<FetchRemoteStockResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    return this.repo.fetchRemoteStock(dto);
  }
}
