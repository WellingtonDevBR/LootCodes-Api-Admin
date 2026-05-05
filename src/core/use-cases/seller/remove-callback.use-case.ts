import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { RemoveCallbackDto, RemoveCallbackResult } from './seller-listing.types.js';

@injectable()
export class RemoveCallbackUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: RemoveCallbackDto): Promise<RemoveCallbackResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');
    if (!dto.callback_id) throw new Error('callback_id is required');

    const { account } = await this.repo.getProviderAccountDetail(dto.provider_account_id);
    const adapter = this.registry.getCallbackSetupAdapter(account.provider_code);
    if (!adapter) {
      throw new Error(`Provider ${account.provider_code} does not support callback management`);
    }

    return adapter.removeCallback(dto.callback_id);
  }
}
