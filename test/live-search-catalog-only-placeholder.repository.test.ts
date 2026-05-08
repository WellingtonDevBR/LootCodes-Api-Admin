import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

describe('SupabaseAdminProcurementRepository.liveSearchProviders catalog-only placeholders', () => {
  it('lists catalog-only providers with empty offers when local catalog has no rows', async () => {
    const registry = {
      getSupportedProviders: (): string[] => ['approute', 'bamboo'],
      hasCapability: (code: string, cap: string): boolean =>
        code === 'bamboo' && cap === 'product_search',
      getProductSearchAdapter: (code: string) =>
        code === 'bamboo'
          ? { searchProducts: vi.fn().mockResolvedValue([]) }
          : null,
    };

    const queryPaginated = vi.fn().mockResolvedValue({ data: [] });
    const query = vi.fn().mockImplementation((table: string) => {
      if (table === 'provider_accounts') {
        return Promise.resolve([
          { id: 'ar1', provider_code: 'approute' },
          { id: 'b1', provider_code: 'bamboo' },
        ]);
      }
      return Promise.resolve([]);
    });
    const upsertMany = vi.fn();

    const db = { queryPaginated, query, upsertMany } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);
    const result = await repo.liveSearchProviders({ query: 'steam', max_results: 15 });

    const approute = result.providers.find((p) => p.provider_code === 'approute');
    expect(approute).toBeDefined();
    expect(approute?.offers).toEqual([]);

    const bamboo = result.providers.find((p) => p.provider_code === 'bamboo');
    expect(bamboo).toBeDefined();
    expect(bamboo?.offers).toEqual([]);
  });
});
