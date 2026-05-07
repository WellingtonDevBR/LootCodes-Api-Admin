import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import type { IAdminSellerRepository } from '../src/core/ports/admin-seller-repository.port.js';
import { UnlinkSellerListingMarketplaceProductUseCase } from '../src/core/use-cases/seller/unlink-seller-listing-marketplace-product.use-case.js';

vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}));

describe('UnlinkSellerListingMarketplaceProductUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an empty listing_id before calling the repository', async () => {
    const repo = { unlinkSellerListingMarketplaceProduct: vi.fn() };
    const uc = new UnlinkSellerListingMarketplaceProductUseCase(repo as unknown as IAdminSellerRepository);
    await expect(uc.execute({ listing_id: '', admin_id: 'admin-1' })).rejects.toThrow('listing_id is required');
    expect(repo.unlinkSellerListingMarketplaceProduct).not.toHaveBeenCalled();
  });

  it('returns repository result and emits Sentry observability after unlink', async () => {
    const unlinkResult = {
      listing_id: 'listing-1',
      variant_id: 'variant-1',
      provider_account_id: 'acct-1',
      external_product_id: null as string | null,
      external_listing_id: null as string | null,
      status: 'draft',
      previous_external_product_id: 'cat-offer-99',
      previous_external_listing_id: null as string | null,
    };
    const repo = {
      unlinkSellerListingMarketplaceProduct: vi.fn().mockResolvedValue(unlinkResult),
    };
    const uc = new UnlinkSellerListingMarketplaceProductUseCase(repo as unknown as IAdminSellerRepository);

    await expect(
      uc.execute({ listing_id: 'listing-1', admin_id: 'admin-1' }),
    ).resolves.toEqual(unlinkResult);

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'seller.admin',
        message: 'Marketplace product unlinked from seller listing',
      }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'seller.listing_marketplace_unlinked',
      expect.objectContaining({
        level: 'info',
        tags: { seller_operation: 'unlink_marketplace_product' },
      }),
    );
  });
});
