import { describe, expect, it, vi } from 'vitest';
import type {
  IMarketplaceAdapterRegistry,
  ISellerDeclaredStockAdapter,
} from '../src/core/ports/marketplace-adapter.port.js';
import type { IAdminSellerRepository } from '../src/core/ports/admin-seller-repository.port.js';
import type { SellerListingPublishContext } from '../src/core/use-cases/seller/seller-listing.types.js';
import { SetSellerListingDeclaredStockUseCase } from '../src/core/use-cases/seller/set-seller-listing-declared-stock.use-case.js';

/**
 * Helpers — minimal stubs for the registry and repository methods exercised by
 * the use case. Each test passes only what it asserts on.
 */
type SellerRepoMethods = Pick<
  IAdminSellerRepository,
  'getSellerListingPublishContext' | 'setSellerListingManualDeclaredStock'
>;

function ctx(overrides: Partial<SellerListingPublishContext> = {}): SellerListingPublishContext {
  return {
    listing_id: 'lst-1',
    variant_id: 'var-1',
    provider_account_id: 'pa-1',
    provider_code: 'eneba',
    external_product_id: 'prod-x',
    external_listing_id: 'auction-1',
    listing_type: 'declared_stock',
    price_cents: 1500,
    currency: 'EUR',
    status: 'active',
    ...overrides,
  };
}

describe('SetSellerListingDeclaredStockUseCase', () => {
  it('rejects an empty listing_id before touching the registry or repository', async () => {
    const registry = { getDeclaredStockAdapter: vi.fn() } as unknown as IMarketplaceAdapterRegistry;
    const repo = {
      getSellerListingPublishContext: vi.fn(),
      setSellerListingManualDeclaredStock: vi.fn(),
    } as unknown as IAdminSellerRepository;

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo);

    await expect(uc.execute({ listing_id: '   ', quantity: 5, admin_id: 'adm-1' })).rejects.toThrow(
      'listing_id is required',
    );
    expect(registry.getDeclaredStockAdapter).not.toHaveBeenCalled();
    expect(repo.getSellerListingPublishContext).not.toHaveBeenCalled();
  });

  it('rejects a non-integer quantity', async () => {
    const registry = { getDeclaredStockAdapter: vi.fn() } as unknown as IMarketplaceAdapterRegistry;
    const repo = {
      getSellerListingPublishContext: vi.fn(),
      setSellerListingManualDeclaredStock: vi.fn(),
    } as unknown as IAdminSellerRepository;

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo);

    await expect(uc.execute({ listing_id: 'lst-1', quantity: 1.5, admin_id: 'adm-1' })).rejects.toThrow(
      'quantity must be a non-negative integer',
    );
  });

  it('rejects a negative quantity', async () => {
    const registry = { getDeclaredStockAdapter: vi.fn() } as unknown as IMarketplaceAdapterRegistry;
    const repo = {
      getSellerListingPublishContext: vi.fn(),
      setSellerListingManualDeclaredStock: vi.fn(),
    } as unknown as IAdminSellerRepository;

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo);

    await expect(uc.execute({ listing_id: 'lst-1', quantity: -1, admin_id: 'adm-1' })).rejects.toThrow(
      'quantity must be a non-negative integer',
    );
  });

  it('throws a descriptive error when the listing is missing', async () => {
    const registry = { getDeclaredStockAdapter: vi.fn() } as unknown as IMarketplaceAdapterRegistry;
    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(null),
      setSellerListingManualDeclaredStock: vi.fn(),
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-missing', quantity: 5, admin_id: 'adm-1' })).rejects.toThrow(
      /lst-missing.*not found/,
    );
  });

  it('refuses to push when the listing has no external_listing_id (not yet published)', async () => {
    const registry = { getDeclaredStockAdapter: vi.fn() } as unknown as IMarketplaceAdapterRegistry;
    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(ctx({ external_listing_id: null })),
      setSellerListingManualDeclaredStock: vi.fn(),
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-1', quantity: 5, admin_id: 'adm-1' })).rejects.toThrow(
      /publish.*marketplace/i,
    );
    expect(registry.getDeclaredStockAdapter).not.toHaveBeenCalled();
    expect(repo.setSellerListingManualDeclaredStock).not.toHaveBeenCalled();
  });

  it('refuses to push when the provider has no declared-stock adapter', async () => {
    const registry: IMarketplaceAdapterRegistry = {
      getDeclaredStockAdapter: vi.fn().mockReturnValue(null),
    } as unknown as IMarketplaceAdapterRegistry;
    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(ctx({ provider_code: 'noop' })),
      setSellerListingManualDeclaredStock: vi.fn(),
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-1', quantity: 5, admin_id: 'adm-1' })).rejects.toThrow(
      /noop.*not.*support.*declared/i,
    );
    expect(repo.setSellerListingManualDeclaredStock).not.toHaveBeenCalled();
  });

  it('calls adapter.declareStock and persists manual + mirrored declared stock on success', async () => {
    const declareStock = vi
      .fn<ISellerDeclaredStockAdapter['declareStock']>()
      .mockResolvedValue({ success: true, declaredQuantity: 7 });
    const adapter = { declareStock } as unknown as ISellerDeclaredStockAdapter;

    const registry: IMarketplaceAdapterRegistry = {
      getDeclaredStockAdapter: vi.fn().mockReturnValue(adapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const persisted = vi.fn().mockResolvedValue({
      listing_id: 'lst-1',
      declared_stock: 7,
      manual_declared_stock: 7,
      synced_at: '2026-05-09T00:00:00.000Z',
    });
    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(ctx()),
      setSellerListingManualDeclaredStock: persisted,
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);
    const result = await uc.execute({ listing_id: 'lst-1', quantity: 7, admin_id: 'adm-1' });

    expect(declareStock).toHaveBeenCalledWith('auction-1', 7);
    expect(persisted).toHaveBeenCalledWith({
      listing_id: 'lst-1',
      quantity: 7,
      admin_id: 'adm-1',
    });
    expect(result).toEqual({
      listing_id: 'lst-1',
      declared_stock: 7,
      manual_declared_stock: 7,
      synced_at: '2026-05-09T00:00:00.000Z',
    });
  });

  it('passes 0 through to the adapter (Eneba 0→null translation lives in the adapter)', async () => {
    const declareStock = vi
      .fn<ISellerDeclaredStockAdapter['declareStock']>()
      .mockResolvedValue({ success: true });
    const adapter = { declareStock } as unknown as ISellerDeclaredStockAdapter;

    const registry: IMarketplaceAdapterRegistry = {
      getDeclaredStockAdapter: vi.fn().mockReturnValue(adapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(ctx()),
      setSellerListingManualDeclaredStock: vi.fn().mockResolvedValue({
        listing_id: 'lst-1',
        declared_stock: 0,
        manual_declared_stock: 0,
        synced_at: '2026-05-09T00:00:00.000Z',
      }),
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);
    await uc.execute({ listing_id: 'lst-1', quantity: 0, admin_id: 'adm-1' });

    expect(declareStock).toHaveBeenCalledWith('auction-1', 0);
  });

  it('does not persist when the adapter reports failure and surfaces the adapter error', async () => {
    const declareStock = vi
      .fn<ISellerDeclaredStockAdapter['declareStock']>()
      .mockResolvedValue({ success: false, error: 'rate limited' });
    const adapter = { declareStock } as unknown as ISellerDeclaredStockAdapter;

    const registry: IMarketplaceAdapterRegistry = {
      getDeclaredStockAdapter: vi.fn().mockReturnValue(adapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const persisted = vi.fn();
    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(ctx()),
      setSellerListingManualDeclaredStock: persisted,
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-1', quantity: 7, admin_id: 'adm-1' })).rejects.toThrow(
      'rate limited',
    );
    expect(persisted).not.toHaveBeenCalled();
  });

  it('does not persist when the adapter throws and rethrows the error to the caller', async () => {
    const declareStock = vi.fn().mockRejectedValue(new Error('network down'));
    const adapter = { declareStock } as unknown as ISellerDeclaredStockAdapter;

    const registry: IMarketplaceAdapterRegistry = {
      getDeclaredStockAdapter: vi.fn().mockReturnValue(adapter),
    } as unknown as IMarketplaceAdapterRegistry;

    const persisted = vi.fn();
    const repo: SellerRepoMethods = {
      getSellerListingPublishContext: vi.fn().mockResolvedValue(ctx()),
      setSellerListingManualDeclaredStock: persisted,
    };

    const uc = new SetSellerListingDeclaredStockUseCase(registry, repo as IAdminSellerRepository);

    await expect(uc.execute({ listing_id: 'lst-1', quantity: 7, admin_id: 'adm-1' })).rejects.toThrow(
      'network down',
    );
    expect(persisted).not.toHaveBeenCalled();
  });
});
