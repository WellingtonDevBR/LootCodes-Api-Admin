import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { BatchUpdateStockDto, BatchUpdateStockResult } from './seller-listing.types.js';

@injectable()
export class BatchUpdateStockUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: BatchUpdateStockDto): Promise<BatchUpdateStockResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');
    if (!dto.updates?.length) throw new Error('updates array is required and must not be empty');
    if (dto.updates.length > 50) throw new Error('Maximum 50 items per batch');

    const { account } = await this.repo.getProviderAccountDetail(dto.provider_account_id);
    const adapter = this.registry.getBatchDeclaredStockAdapter(account.provider_code);
    if (!adapter) {
      throw new Error(`Provider ${account.provider_code} does not support batch stock updates`);
    }

    return adapter.batchUpdateDeclaredStock(
      dto.updates.map((u) => ({
        externalListingId: u.external_listing_id,
        quantity: u.quantity,
      })),
    );
  }
}
