import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { BatchUpdatePricesDto, BatchUpdatePricesResult } from './seller-listing.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('BatchUpdatePricesUseCase');

@injectable()
export class BatchUpdatePricesUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: BatchUpdatePricesDto): Promise<BatchUpdatePricesResult> {
    if (!dto.provider_account_id) throw new Error('provider_account_id is required');
    if (!dto.updates?.length) throw new Error('updates array is required and must not be empty');
    if (dto.updates.length > 200) throw new Error('Maximum 200 items per batch');

    const { account } = await this.repo.getProviderAccountDetail(dto.provider_account_id);
    const adapter = this.registry.getBatchPriceAdapter(account.provider_code);
    if (!adapter) {
      throw new Error(`Provider ${account.provider_code} does not support batch price updates`);
    }

    const result = await adapter.batchUpdatePrices(
      dto.updates.map((u) => ({
        externalListingId: u.external_listing_id,
        priceCents: u.price_cents,
      })),
    );

    // Manual admin pushes consume the same marketplace quota (e.g. Eneba's 10
    // free price changes per 24 h) as the auto-pricing cron. Persist a price-
    // change timestamp on each affected listing so our local budget counter
    // stays aligned with the marketplace's real quota and the next cron tick
    // doesn't over-spend. We update by external_listing_id; failures are
    // logged but not propagated — the marketplace push has already succeeded.
    try {
      await this.repo.recordSellerListingPriceChangeQuota({
        provider_account_id: dto.provider_account_id,
        external_listing_ids: dto.updates.map((u) => u.external_listing_id),
        price_change_window_hours: account.seller_config.price_change_window_hours,
      });
    } catch (err) {
      logger.warn(
        'Failed to record price-change quota after manual batch push',
        err as Error,
        {
          provider_account_id: dto.provider_account_id,
          listing_count: dto.updates.length,
        },
      );
    }

    return result;
  }
}
