import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { EnableKeyReplacementsDto, EnableKeyReplacementsResult } from './seller-listing.types.js';

@injectable()
export class EnableKeyReplacementsUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: EnableKeyReplacementsDto): Promise<EnableKeyReplacementsResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');

    const { account } = await this.repo.getProviderAccountDetail(dto.provider_account_id);

    const adapter = this.registry.getDeclaredStockAdapter(account.provider_code);
    if (!adapter) {
      throw new Error(`Provider ${account.provider_code} does not support declared stock`);
    }

    const enebaAdapter = adapter as unknown as {
      enableKeyReplacements?: () => Promise<boolean>;
    };
    if (typeof enebaAdapter.enableKeyReplacements !== 'function') {
      throw new Error(`Provider ${account.provider_code} does not support key replacements`);
    }

    const success = await enebaAdapter.enableKeyReplacements();
    return { success };
  }
}
