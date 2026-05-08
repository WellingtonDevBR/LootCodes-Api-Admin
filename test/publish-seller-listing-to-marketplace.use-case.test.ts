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
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
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
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
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

  it('maps Eneba key_upload to declared_stock create using available key count', async () => {
    const listingAdapter: Partial<ISellerListingAdapter> = {
      createListing: vi.fn().mockResolvedValue({
        externalListingId: 'auction-keys-bridge',
        status: 'active',
      }),
    };

    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(listingAdapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const finalize = vi.fn().mockResolvedValue({
      listing_id: 'lst-ku',
      external_listing_id: 'auction-keys-bridge',
      status: 'active',
      skipped_already_published: false,
    });

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-ku',
        variant_id: 'var-ku',
        provider_account_id: 'pa-ku',
        provider_code: 'eneba',
        external_product_id: 'prod-ku',
        external_listing_id: null,
        listing_type: 'key_upload',
        price_cents: 1000,
        currency: 'EUR',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn().mockResolvedValue(4),
      finalizeSellerListingMarketplacePublishSuccess: finalize,
      markSellerListingPublishFailure: vi.fn(),
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);
    await uc.execute({ listing_id: 'lst-ku', admin_id: 'adm-1' });

    expect(listingAdapter.createListing).toHaveBeenCalledWith(
      expect.objectContaining({
        externalProductId: 'prod-ku',
        listingType: 'declared_stock',
        quantity: 4,
      }),
    );
    expect(finalize).toHaveBeenCalledWith({
      listing_id: 'lst-ku',
      external_listing_id: 'auction-keys-bridge',
      declared_stock: 4,
      admin_id: 'adm-1',
      listing_type: 'declared_stock',
    });
  });

  it('uses updateListing when discoverExistingAuctionId returns an auction (link existing)', async () => {
    const listingAdapter: Partial<ISellerListingAdapter> = {
      discoverExistingAuctionId: vi.fn().mockResolvedValue('auction-remote'),
      updateListing: vi.fn().mockResolvedValue({ success: true }),
      createListing: vi.fn(),
    };

    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(listingAdapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const finalize = vi.fn().mockResolvedValue({
      listing_id: 'lst-disc',
      external_listing_id: 'auction-remote',
      status: 'active',
      skipped_already_published: false,
    });

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-disc',
        variant_id: 'var-disc',
        provider_account_id: 'pa-d',
        provider_code: 'eneba',
        external_product_id: 'prod-linked',
        external_listing_id: null,
        listing_type: 'declared_stock',
        price_cents: 1500,
        currency: 'USD',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn().mockResolvedValue(7),
      finalizeSellerListingMarketplacePublishSuccess: finalize,
      markSellerListingPublishFailure: vi.fn(),
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);
    const result = await uc.execute({ listing_id: 'lst-disc', admin_id: 'adm-1' });

    expect(listingAdapter.discoverExistingAuctionId).toHaveBeenCalledWith('prod-linked');
    expect(listingAdapter.updateListing).toHaveBeenCalledWith({
      externalListingId: 'auction-remote',
      priceCents: 1500,
      currency: 'USD',
      quantity: 7,
    });
    expect(listingAdapter.createListing).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledWith({
      listing_id: 'lst-disc',
      external_listing_id: 'auction-remote',
      declared_stock: 7,
      admin_id: 'adm-1',
    });
    expect(result.external_listing_id).toBe('auction-remote');
  });

  it('links discovered Eneba key_upload auction using declared stock from inventory', async () => {
    const listingAdapter: Partial<ISellerListingAdapter> = {
      discoverExistingAuctionId: vi.fn().mockResolvedValue('auction-remote-ku'),
      updateListing: vi.fn().mockResolvedValue({ success: true }),
      createListing: vi.fn(),
    };

    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(listingAdapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const finalize = vi.fn().mockResolvedValue({
      listing_id: 'lst-disc-ku',
      external_listing_id: 'auction-remote-ku',
      status: 'active',
      skipped_already_published: false,
    });

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
      getSellerListingPublishContext: vi.fn().mockResolvedValue({
        listing_id: 'lst-disc-ku',
        variant_id: 'var-disc-ku',
        provider_account_id: 'pa-dku',
        provider_code: 'eneba',
        external_product_id: 'prod-linked-ku',
        external_listing_id: null,
        listing_type: 'key_upload',
        price_cents: 800,
        currency: 'EUR',
        status: 'draft',
      } satisfies SellerListingPublishContext),
      countAvailableProductKeysForVariant: vi.fn().mockResolvedValue(3),
      finalizeSellerListingMarketplacePublishSuccess: finalize,
      markSellerListingPublishFailure: vi.fn(),
    };

    const uc = new PublishSellerListingToMarketplaceUseCase(registry, sellerRepo as IAdminSellerRepository);
    await uc.execute({ listing_id: 'lst-disc-ku', admin_id: 'adm-1' });

    expect(listingAdapter.updateListing).toHaveBeenCalledWith({
      externalListingId: 'auction-remote-ku',
      priceCents: 800,
      currency: 'EUR',
      quantity: 3,
    });
    expect(finalize).toHaveBeenCalledWith({
      listing_id: 'lst-disc-ku',
      external_listing_id: 'auction-remote-ku',
      declared_stock: 3,
      admin_id: 'adm-1',
      listing_type: 'declared_stock',
    });
  });

  it('records failure when listing adapter is missing', async () => {
    const registry: IMarketplaceAdapterRegistry = {
      getListingAdapter: vi.fn().mockReturnValue(null),
    } as unknown as IMarketplaceAdapterRegistry;

    const markFail = vi.fn().mockResolvedValue(undefined);

    const sellerRepo: Pick<
      IAdminSellerRepository,
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
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
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
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
      'getSellerListingPublishContext' | 'repairSellerListingRowIfStaleFailure' | 'countAvailableProductKeysForVariant' | 'finalizeSellerListingMarketplacePublishSuccess' | 'markSellerListingPublishFailure'
    > = {
      repairSellerListingRowIfStaleFailure: vi.fn(),
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
      expect.stringContaining('Eneba marketplace publish requires at least one available key'),
    );
    expect(registry.getListingAdapter).not.toHaveBeenCalled();
    expect(listingAdapter.createListing).not.toHaveBeenCalled();
  });
});
