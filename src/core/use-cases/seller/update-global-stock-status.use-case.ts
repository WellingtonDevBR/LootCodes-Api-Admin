import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { UpdateGlobalStockStatusDto, UpdateGlobalStockStatusResult } from './seller-listing.types.js';

@injectable()
export class UpdateGlobalStockStatusUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UpdateGlobalStockStatusDto): Promise<UpdateGlobalStockStatusResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');
    if (typeof dto.enabled !== 'boolean') throw new Error('enabled must be a boolean');

    const { account } = await this.repo.getProviderAccountDetail(dto.provider_account_id);
    const adapter = this.registry.getGlobalStockAdapter(account.provider_code);
    if (!adapter) {
      throw new Error(`Provider ${account.provider_code} does not support global stock status`);
    }

    return adapter.updateAllStockStatus(dto.enabled);
  }
}
