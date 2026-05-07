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
});
