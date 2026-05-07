import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type { PublishSellerListingToMarketplaceResult } from './seller-listing.types.js';

export interface PublishSellerListingToMarketplaceDtoInput {
  readonly listing_id: string;
  readonly admin_id: string;
}

@injectable()
export class PublishSellerListingToMarketplaceUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private sellerRepo: IAdminSellerRepository,
  ) {}

  async execute(dto: PublishSellerListingToMarketplaceDtoInput): Promise<PublishSellerListingToMarketplaceResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');

    const ctx = await this.sellerRepo.getSellerListingPublishContext(dto.listing_id);
    if (!ctx) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const extProduct = ctx.external_product_id?.trim();
    if (!extProduct) {
      throw new Error('Listing has no external_product_id — link a marketplace catalog product first');
    }

    const existingAuction = ctx.external_listing_id?.trim();
    if (existingAuction) {
      return {
        listing_id: ctx.listing_id,
        external_listing_id: existingAuction,
        status: ctx.status,
        skipped_already_published: true,
      };
    }

    if (ctx.price_cents <= 0) {
      const msg = 'Listing price must be greater than zero before marketplace publish';
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw new Error(msg);
    }

    const adapter = this.registry.getListingAdapter(ctx.provider_code);
    if (!adapter) {
      const msg = `Provider "${ctx.provider_code}" does not support automated marketplace listing publish`;
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw new Error(msg);
    }

    let quantity: number | undefined;
    if (ctx.listing_type === 'declared_stock') {
      quantity = await this.sellerRepo.countAvailableProductKeysForVariant(ctx.variant_id);
    }

    try {
      const remote = await adapter.createListing({
        externalProductId: extProduct,
        priceCents: ctx.price_cents,
        currency: ctx.currency,
        listingType: ctx.listing_type,
        ...(ctx.listing_type === 'declared_stock' ? { quantity: quantity ?? 0 } : {}),
      });

      const declaredStock = ctx.listing_type === 'declared_stock' ? (quantity ?? 0) : 0;

      return await this.sellerRepo.finalizeSellerListingMarketplacePublishSuccess({
        listing_id: dto.listing_id,
        external_listing_id: remote.externalListingId,
        declared_stock: declaredStock,
        admin_id: dto.admin_id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Marketplace publish failed';
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}
