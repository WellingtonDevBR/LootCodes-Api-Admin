import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { EnableDeclaredStockDto, EnableDeclaredStockResult } from './seller-listing.types.js';

@injectable()
export class EnableDeclaredStockUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: EnableDeclaredStockDto): Promise<EnableDeclaredStockResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');

    const { account } = await this.repo.getProviderAccountDetail(dto.provider_account_id);

    const adapter = this.registry.getDeclaredStockAdapter(account.provider_code);
    if (!adapter) {
      throw new Error(`Provider ${account.provider_code} does not support declared stock`);
    }

    // enableDeclaredStock is an Eneba-specific method, not a generic adapter capability.
    const enebaAdapter = adapter as unknown as {
      enableDeclaredStock?: () => Promise<{ success: boolean; failureReason: string | null }>;
    };
    if (typeof enebaAdapter.enableDeclaredStock !== 'function') {
      throw new Error(`Provider ${account.provider_code} does not support enabling declared stock`);
    }

    return enebaAdapter.enableDeclaredStock();
  }
}
