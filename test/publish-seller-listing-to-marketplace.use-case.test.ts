import { describe, expect, it, vi } from 'vitest';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import type { ISellerListingAdapter } from '../src/core/ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../src/core/ports/admin-seller-repository.port.js';
import type { SellerListingPublishContext } from '../src/core/use-cases/seller/seller-listing.types.js';
import { PublishSellerListingToMarketplaceUseCase } from '../src/core/use-cases/seller/publish-seller-listing-to-marketplace.use-case.js';

describe('PublishSellerListingToMarketplaceUseCase', () => {
  it('returns skipped_already_published when external_listing_id already set', async () => {
    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn(),
    } as unknown as IMarketplaceAdapterRegistry;

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-1',
        variant_id: 'var-1',
        provider_account_id: 'pa-1',
        provider_code: 'eneba',
        external_product_id: 'prod-x',
        external_listing_id: 'auction-existing',
        listing_type: 'declared_stock',
        price_cents: 999,
        currency: 'EUR',
        status: 'active',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn(),
      finalizeSellerListingMarketplacePublishSuccess: vi.fn(),
      markSellerListingPublishFailure: vi.fn(),
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);
    const result = await uc.execute({ listing_id: 'lst-1', admin_id: 'adm-1' });

    expect(result).toEqual({
      listing_id: 'lst-1',
      external_listing_id: 'auction-existing',
      status: 'active',
      skipped_already_published: true,
    });
    expect(registry.getListingAdapter).not.toHaveBeenCalled();
  });

  it('calls createListing and persists success for declared_stock when adapter exists', async () => {
    const listingAdapter: Partial<ISellerListingAdapter> = {
      createListing: vi.fn().mockResolvedValue({
        externalListingId: 'auction-new',
        status: 'active',
      }),
    };

    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(listingAdapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const finalize = vi.fn().mockResolvedValue({
      listing_id: 'lst-2',
      external_listing_id: 'auction-new',
      status: 'active',
      skipped_already_published: false,
    });

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-2',
        variant_id: 'var-2',
        provider_account_id: 'pa-2',
        provider_code: 'eneba',
        external_product_id: 'prod-y',
        external_listing_id: null,
        listing_type: 'declared_stock',
        price_cents: 1200,
        currency: 'EUR',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn().mockResolvedValue(5),
      finalizeSellerListingMarketplacePublishSuccess: finalize,
      markSellerListingPublishFailure: vi.fn(),
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);
    const result = await uc.execute({ listing_id: 'lst-2', admin_id: 'adm-1' });

    expect(listingAdapter.createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        externalProductId: 'prod-y',
        priceCents: 1200,
        currency: 'EUR',
        listingType: 'declared_stock',
        quantity: 5,
      }),
    );
    expect(finalize).toHaveBeenCalledWith({
      listing_id: 'lst-2',
      external_listing_id: 'auction-new',
      declared_stock: 5,
      admin_id: 'adm-1',
    });
    expect(result.external_listing_id).toBe('auction-new');
    expect(result.skipped_already_published).toBe(false);
  });

  it('records failure when listing adapter is missing', async () => {
    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(null),
    } as unknown as IMarketplaceAdapterRegistry;

    const markFail = vi.fn().mockResolvedValue(undefined);

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-3',
        variant_id: 'var-3',
        provider_account_id: 'pa-3',
        provider_code: 'unknown_provider',
        external_product_id: 'prod-z',
        external_listing_id: null,
        listing_type: 'declared_stock',
        price_cents: 100,
        currency: 'EUR',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn().mockResolvedValue(3),
      finalizeSellerListingMarketplacePublishSuccess: vi.fn(),
      markSellerListingPublishFailure: markFail,
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-3', admin_id: 'adm-1' })).rejects.toThrow(
      /does not support automated marketplace listing publish/,
    );
    expect(markFail).toHaveBeenCalledWith(
      'lst-3',
      expect.stringContaining('does not support automated marketplace listing publish'),
    );
  });

  it('records failure when listing price is zero or negative', async () => {
    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn(),
    } as unknown as IMarketplaceAdapterRegistry;

    const markFail = vi.fn().mockResolvedValue(undefined);

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-4',
        variant_id: 'var-4',
        provider_account_id: 'pa-4',
        provider_code: 'eneba',
        external_product_id: 'prod-zero',
        external_listing_id: null,
        listing_type: 'declared_stock',
        price_cents: 0,
        currency: 'EUR',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn(),
      finalizeSellerListingMarketplacePublishSuccess: vi.fn(),
      markSellerListingPublishFailure: markFail,
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-4', admin_id: 'adm-1' })).rejects.toThrow(
      /Listing price must be greater than zero before marketplace publish/,
    );
    expect(markFail).toHaveBeenCalledWith(
      'lst-4',
      expect.stringContaining('Listing price must be greater than zero'),
    );
    expect(registry.getListingAdapter).not.toHaveBeenCalled();
  });

  it('records failure when declared_stock listing has no available keys', async () => {
    const listingAdapter: Partial<ISellerListingAdapter> = {
      createListing: vi.fn(),
    };

    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(listingAdapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const markFail = vi.fn().mockResolvedValue(undefined);

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-n-keys',
        variant_id: 'var-n-keys',
        provider_account_id: 'pa-e',
        provider_code: 'eneba',
        external_product_id: 'prod-z',
        external_listing_id: null,
        listing_type: 'declared_stock',
        price_cents: 999,
        currency: 'EUR',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn().mockResolvedValue(0),
      finalizeSellerListingMarketplacePublishSuccess: vi.fn(),
      markSellerListingPublishFailure: markFail,
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-n-keys', admin_id: 'adm-1' })).rejects.toThrow(
      /at least one available key/,
    );
    expect(markFail).toHaveBeenCalledWith(
      'lst-n-keys',
      expect.stringContaining('Declared-stock publish requires at least one available key'),
    );
    expect(registry.getListingAdapter).not.toHaveBeenCalled();
    expect(listingAdapter.createListing).not.toHaveBeenCalled();
  });
});
