import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

describe('SupabaseAdminProcurementRepository.testProviderQuote', () => {
  it('resolves provider_code via provider_accounts join semantics', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          provider_account_id: 'acc-bamboo',
          last_price_cents: 2605,
          available_quantity: 0,
        },
      ])
      .mockResolvedValueOnce([{ id: 'acc-bamboo', provider_code: 'bamboo', display_name: 'Bamboo' }]);

    const db = { query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.testProviderQuote({
      variant_id: 'var-1',
      admin_id: 'admin-1',
    });

    expect(query).toHaveBeenNthCalledWith(
      1,
      'provider_variant_offers',
      expect.objectContaining({ filter: { variant_id: 'var-1' } }),
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      'provider_accounts',
      expect.objectContaining({ in: [['id', ['acc-bamboo']]] }),
    );
    expect(result.quotes).toEqual([
      { provider: 'bamboo', price_cents: 2605, available: false },
    ]);
  });

  it('filters by dto.provider_code using account lookup', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          provider_account_id: 'acc-bamboo',
          last_price_cents: 100,
          available_quantity: 5,
        },
        {
          provider_account_id: 'acc-other',
          last_price_cents: 200,
          available_quantity: 1,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'acc-bamboo', provider_code: 'bamboo', display_name: 'Bamboo' },
        { id: 'acc-other', provider_code: 'eneba', display_name: 'Eneba' },
      ]);

    const db = { query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.testProviderQuote({
      variant_id: 'var-1',
      provider_code: 'bamboo',
      admin_id: 'admin-1',
    });

    expect(result.quotes).toEqual([{ provider: 'bamboo', price_cents: 100, available: true }]);
  });

  it('uses display_name when provider_code is blank', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          provider_account_id: 'acc-x',
          last_price_cents: 50,
          available_quantity: 0,
        },
      ])
      .mockResolvedValueOnce([
        { id: 'acc-x', provider_code: '', display_name: 'Bamboo Wholesale' },
      ]);

    const db = { query } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.testProviderQuote({
      variant_id: 'var-1',
      admin_id: 'admin-1',
    });

    expect(result.quotes).toEqual([
      { provider: 'Bamboo Wholesale', price_cents: 50, available: false },
    ]);
  });
});
