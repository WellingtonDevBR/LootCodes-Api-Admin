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

    /**
     * Eneba `S_createAuction` does not accept plain auctions with `keys: []` — you must send either
     * plaintext keys or `declaredStock`. CRM publish never uploads keys here, so we always derive
     * declared stock from available inventory keys for Eneba (`declared_stock` and `key_upload` rows).
     */
    let quantity: number | undefined;
    const enebaDeclaredStockFromInventory =
      ctx.provider_code === 'eneba' &&
      (ctx.listing_type === 'declared_stock' || ctx.listing_type === 'key_upload');

    if (enebaDeclaredStockFromInventory) {
      const qty = await this.sellerRepo.countAvailableProductKeysForVariant(ctx.variant_id);
      quantity = qty;
      if (qty <= 0) {
        const msg =
          'Eneba marketplace publish requires at least one available key for this variant ' +
          '(declared stock is taken from inventory; creating an auction without keys or stock is not supported)';
        await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
        throw new Error(msg);
      }
    }

    const bridgeEnebaKeyUploadToDeclaredStock =
      ctx.provider_code === 'eneba' && ctx.listing_type === 'key_upload';
    const wireListingType = bridgeEnebaKeyUploadToDeclaredStock ? 'declared_stock' : ctx.listing_type;

    const adapter = this.registry.getListingAdapter(ctx.provider_code);
    if (!adapter) {
      const msg = `Provider "${ctx.provider_code}" does not support automated marketplace listing publish`;
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw new Error(msg);
    }

    try {
      const discoveredAuctionId =
        (await adapter.discoverExistingAuctionId?.(extProduct).catch(() => null)) ?? null;

      const declaredStockForPersist =
        wireListingType === 'declared_stock' ? (quantity as number) : 0;

      let externalListingId: string;

      if (discoveredAuctionId) {
        const upd = await adapter.updateListing({
          externalListingId: discoveredAuctionId,
          priceCents: ctx.price_cents,
          currency: ctx.currency,
          ...(wireListingType === 'declared_stock' ? { quantity: quantity as number } : {}),
        });
        if (!upd.success) {
          const msg =
            upd.error ??
            'Marketplace already has an auction for this product; update failed (try again after rate limit or bind auction manually)';
          throw new Error(msg);
        }
        externalListingId = discoveredAuctionId;
      } else {
        const remote = await adapter.createListing({
          externalProductId: extProduct,
          priceCents: ctx.price_cents,
          currency: ctx.currency,
          listingType: wireListingType,
          ...(wireListingType === 'declared_stock' ? { quantity: quantity as number } : {}),
        });
        externalListingId = remote.externalListingId;
      }

      return await this.sellerRepo.finalizeSellerListingMarketplacePublishSuccess({
        listing_id: dto.listing_id,
        external_listing_id: externalListingId,
        declared_stock: declaredStockForPersist,
        admin_id: dto.admin_id,
        ...(bridgeEnebaKeyUploadToDeclaredStock ? { listing_type: 'declared_stock' as const } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Marketplace publish failed';
      await this.sellerRepo.markSellerListingPublishFailure(dto.listing_id, msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  }
}
