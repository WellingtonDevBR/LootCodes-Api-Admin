import * as Sentry from '@sentry/node';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IMarketplaceAdapterRegistry } from '../../ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../../ports/admin-seller-repository.port.js';
import type {
  SetSellerListingDeclaredStockDto,
  SetSellerListingDeclaredStockResult,
} from './seller-listing.types.js';

/**
 * Operator-driven manual update of a single seller listing's declared stock.
 *
 * Flow:
 *   1. Validate input (non-empty listing id, non-negative integer quantity).
 *   2. Load `SellerListingPublishContext` to know the provider code and the
 *      remote auction id we need to update.
 *   3. Refuse for unpublished listings (no `external_listing_id`) and for
 *      providers that do not implement `ISellerDeclaredStockAdapter`.
 *   4. Push the new quantity through the adapter — vendor-specific quirks
 *      (e.g. Eneba sending `0` as `null`, G2A activating/deactivating on
 *      zero, Gamivo updating offer stock) live inside each adapter, not here.
 *   5. Only on adapter success, mirror the value to `manual_declared_stock`
 *      and `declared_stock` in the repository.
 *
 * The use case never persists on adapter failure to avoid the local DB
 * drifting from what the marketplace knows about the listing.
 */
@injectable()
export class SetSellerListingDeclaredStockUseCase {
  constructor(
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
    @inject(TOKENS.AdminSellerRepository) private repo: IAdminSellerRepository,
  ) {}

  async execute(dto: SetSellerListingDeclaredStockDto): Promise<SetSellerListingDeclaredStockResult> {
    if (!dto.listing_id?.trim()) throw new Error('listing_id is required');
    if (!Number.isInteger(dto.quantity) || dto.quantity < 0) {
      throw new Error('quantity must be a non-negative integer');
    }

    const ctx = await this.repo.getSellerListingPublishContext(dto.listing_id);
    if (!ctx) throw new Error(`Seller listing ${dto.listing_id} not found`);

    const externalListingId = ctx.external_listing_id?.trim();
    if (!externalListingId) {
      throw new Error(
        `Listing ${dto.listing_id} has not been published to the marketplace yet — publish it before setting declared stock`,
      );
    }

    const adapter = this.registry.getDeclaredStockAdapter(ctx.provider_code);
    if (!adapter) {
      throw new Error(
        `Provider "${ctx.provider_code}" does not support manual declared-stock updates`,
      );
    }

    const adapterResult = await adapter.declareStock(externalListingId, dto.quantity);
    if (!adapterResult.success) {
      const msg = adapterResult.error ?? 'Marketplace declared-stock update failed';
      throw new Error(msg);
    }

    const persisted = await this.repo.setSellerListingManualDeclaredStock({
      listing_id: dto.listing_id,
      quantity: dto.quantity,
      admin_id: dto.admin_id,
    });

    Sentry.addBreadcrumb({
      category: 'seller.admin',
      message: 'Manual declared stock pushed to marketplace',
      level: 'info',
      data: {
        listing_id: persisted.listing_id,
        provider_code: ctx.provider_code,
        external_listing_id: externalListingId,
        quantity: dto.quantity,
      },
    });

    Sentry.captureMessage('seller.declared_stock_manual_set', {
      level: 'info',
      tags: { seller_operation: 'set_manual_declared_stock' },
      extra: {
        listing_id: persisted.listing_id,
        provider_code: ctx.provider_code,
        external_listing_id: externalListingId,
        quantity: dto.quantity,
        admin_id: dto.admin_id,
      },
    });

    return persisted;
  }
}
