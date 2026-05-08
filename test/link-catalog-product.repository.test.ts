import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

describe('SupabaseAdminProcurementRepository.linkCatalogProduct', () => {
  it('inserts provider_variant_offers using external_offer_id and omits invalid columns', async () => {
    const insert = vi.fn().mockResolvedValue({ id: 'offer-uuid-1' });
    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'provider_accounts') {
        return [{ id: 'pa-1', supports_seller: false }];
      }
      return [];
    });

    const db = { insert, query } as unknown as IDatabase;
    const registry = {} as IMarketplaceAdapterRegistry;
    const repo = new SupabaseAdminProcurementRepository(db, registry);

    const result = await repo.linkCatalogProduct({
      variant_id: 'var-1',
      provider_code: 'bamboo',
      external_product_id: '2494448',
      currency: 'USD',
      price_cents: 2605,
      admin_id: 'admin-1',
    });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      'provider_variant_offers',
      expect.objectContaining({
        variant_id: 'var-1',
        provider_account_id: 'pa-1',
        external_offer_id: '2494448',
        currency: 'USD',
        last_price_cents: 2605,
        is_active: true,
      }),
    );
    const payload = insert.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('provider_code');
    expect(payload).not.toHaveProperty('external_product_id');
    expect(result).toEqual({ offer_id: 'offer-uuid-1', seller_listing_id: null });
  });

  it('maps optional platform and region codes onto provider_variant_offers columns', async () => {
    const insert = vi.fn().mockResolvedValue({ id: 'offer-uuid-2' });
    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'provider_accounts') {
        return [{ id: 'pa-2', supports_seller: false }];
      }
      return [];
    });

    const db = { insert, query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    await repo.linkCatalogProduct({
      variant_id: 'var-2',
      provider_code: 'bamboo',
      external_product_id: '2494449',
      currency: 'USD',
      price_cents: 100,
      platform_code: 'steam',
      region_code: 'TR',
      admin_id: 'admin-1',
    });

    expect(insert).toHaveBeenCalledWith(
      'provider_variant_offers',
      expect.objectContaining({
        external_platform_code: 'steam',
        external_region_code: 'TR',
      }),
    );
  });

  it('skips provider_variant_offers when create_procurement_offer is false but still upserts seller_listings when supports_seller', async () => {
    const insert = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'seller_listings') return { id: 'listing-uuid-1' };
      throw new Error(`unexpected insert into ${table}`);
    });
    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'provider_accounts') {
        return [{ id: 'pa-eneba', supports_seller: true }];
      }
      if (table === 'seller_listings') {
        return [];
      }
      return [];
    });

    const db = { insert, query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.linkCatalogProduct({
      variant_id: 'var-sell',
      provider_code: 'eneba',
      external_product_id: 'ext-prod-99',
      currency: 'EUR',
      price_cents: 500,
      admin_id: 'admin-1',
      create_procurement_offer: false,
    });

    expect(result).toEqual({ offer_id: null, seller_listing_id: 'listing-uuid-1' });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      'seller_listings',
      expect.objectContaining({
        variant_id: 'var-sell',
        provider_account_id: 'pa-eneba',
        external_product_id: 'ext-prod-99',
      }),
    );
  });

  it('persists external_parent_product_id when dto.external_parent_product_id is set', async () => {
    const insert = vi.fn().mockResolvedValue({ id: 'offer-approute-1' });
    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'provider_accounts') {
        return [{ id: 'pa-ar', supports_seller: false }];
      }
      return [];
    });

    const db = { insert, query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    await repo.linkCatalogProduct({
      variant_id: 'var-ar',
      provider_code: 'approute',
      external_product_id: 'denom-1',
      external_parent_product_id: 'svc-parent',
      currency: 'USD',
      price_cents: 100,
      admin_id: 'admin-1',
    });

    expect(insert).toHaveBeenCalledWith(
      'provider_variant_offers',
      expect.objectContaining({
        external_parent_product_id: 'svc-parent',
      }),
    );
  });

  it('persists external_parent_product_id from provider_product_catalog slug fallback when DTO omits parent', async () => {
    const insert = vi.fn().mockResolvedValue({ id: 'offer-approute-2' });
    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'provider_accounts') {
        return [{ id: 'pa-ar', supports_seller: false }];
      }
      if (table === 'provider_product_catalog') {
        return [{ external_parent_product_id: null, slug: 'svc-from-slug' }];
      }
      return [];
    });

    const db = { insert, query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    await repo.linkCatalogProduct({
      variant_id: 'var-ar',
      provider_code: 'approute',
      external_product_id: 'denom-1',
      currency: 'USD',
      price_cents: 100,
      admin_id: 'admin-1',
    });

    expect(insert).toHaveBeenCalledWith(
      'provider_variant_offers',
      expect.objectContaining({
        external_parent_product_id: 'svc-from-slug',
      }),
    );
  });
});
