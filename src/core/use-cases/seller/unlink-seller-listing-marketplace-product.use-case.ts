import * as Sentry from '@sentry/node';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type {
  UnlinkSellerListingMarketplaceProductDto,
  UnlinkSellerListingMarketplaceProductResult,
} from './seller-listing.types.js';

@injectable()
export class UnlinkSellerListingMarketplaceProductUseCase {
  constructor(
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: UnlinkSellerListingMarketplaceProductDto): Promise<UnlinkSellerListingMarketplaceProductResult> {
    if (!dto.listing_id?.trim()) throw new Error('listing_id is required');

    const result = await this.repo.unlinkSellerListingMarketplaceProduct(dto);

    Sentry.addBreadcrumb({
      category: 'seller.admin',
      message: 'Marketplace product unlinked from seller listing',
      level: 'info',
      data: {
        listing_id: result.listing_id,
        variant_id: result.variant_id,
        provider_account_id: result.provider_account_id,
        previous_external_product_id: result.previous_external_product_id,
        previous_external_listing_id: result.previous_external_listing_id,
      },
    });

    Sentry.captureMessage('seller.listing_marketplace_unlinked', {
      level: 'info',
      tags: { seller_operation: 'unlink_marketplace_product' },
      extra: {
        listing_id: result.listing_id,
        variant_id: result.variant_id,
        provider_account_id: result.provider_account_id,
        admin_id: dto.admin_id,
        previous_external_product_id: result.previous_external_product_id,
        previous_external_listing_id: result.previous_external_listing_id,
      },
    });

    return result;
  }
}
