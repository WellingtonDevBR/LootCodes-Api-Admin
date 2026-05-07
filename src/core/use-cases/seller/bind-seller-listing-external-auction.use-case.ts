import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { BindSellerListingExternalAuctionResult } from './seller-listing.types.js';

export interface BindSellerListingExternalAuctionDtoInput {
  readonly listing_id: string;
  readonly external_listing_id: string;
  readonly admin_id: string;
}

@injectable()
export class BindSellerListingExternalAuctionUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private sellerRepo: IAdminSellerRepository,
  ) {}

  async execute(dto: BindSellerListingExternalAuctionDtoInput): Promise<BindSellerListingExternalAuctionResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');
    const extAuction = dto.external_listing_id?.trim();
    if (!extAuction) throw new Error('external_listing_id is required');

    const ctx = await this.sellerRepo.getSellerListingPublishContext(dto.listing_id);
    if (!ctx) throw new Error(`Seller listing ${dto.listing_id} not found`);

    if (!ctx.external_product_id?.trim()) {
      throw new Error('Listing has no external_product_id — link a marketplace product before binding an auction id');
    }

    const adapter = this.registry.getListingAdapter(ctx.provider_code);
    if (!adapter) {
      throw new Error(`Provider "${ctx.provider_code}" does not support auction verification`);
    }

    let verifiedStatus: string;
    try {
      const remote = await adapter.getListingStatus(extAuction);
      verifiedStatus = remote.status;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      throw new Error(`Marketplace did not confirm auction id: ${msg}`);
    }

    return this.sellerRepo.finalizeSellerListingBindExistingAuction({
      listing_id: dto.listing_id,
      external_listing_id: extAuction,
      admin_id: dto.admin_id,
      verified_remote_status: verifiedStatus,
    });
  }
}
