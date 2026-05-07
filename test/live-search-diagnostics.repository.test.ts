import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

describe('SupabaseAdminProcurementRepository.liveSearchProviders diagnostics', () => {
  it('includes Kinguin buyer hint when buyer client is not configured', async () => {
    const kinguinAdapter = {
      searchProducts: vi.fn().mockResolvedValue([]),
      isBuyerProductSearchConfigured: (): boolean => false,
    };

    const registry = {
      getSupportedProviders: (): string[] => ['kinguin'],
      hasCapability: (code: string, cap: string): boolean => code === 'kinguin' && cap === 'product_search',
      getProductSearchAdapter: (code: string) => (code === 'kinguin' ? kinguinAdapter : null),
    };

    const queryPaginated = vi.fn().mockResolvedValue({ data: [] });
    const query = vi.fn().mockResolvedValue([{ id: 'k1', provider_code: 'kinguin' }]);
    const upsertMany = vi.fn();
    const db = { queryPaginated, query, upsertMany } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);
    const result = await repo.liveSearchProviders({ query: 'steam gift', max_results: 5 });

    expect(result.providers.some((p) => p.provider_code === 'kinguin')).toBe(true);
    expect(result.diagnostics.hints.some((h) => h.includes('Kinguin'))).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'provider_accounts',
      expect.objectContaining({ filter: { is_enabled: true } }),
    );
  });

  it('hints when no marketplace adapters are registered', async () => {
    const registry = {
      getSupportedProviders: (): string[] => [],
      hasCapability: (): boolean => false,
      getProductSearchAdapter: () => null,
    };

    const queryPaginated = vi.fn();
    const db = { queryPaginated } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);
    const result = await repo.liveSearchProviders({ query: 'x' });

    expect(result.providers).toEqual([]);
    expect(result.diagnostics.registered_provider_codes).toEqual([]);
    expect(result.diagnostics.hints.some((h) => h.includes('No marketplace adapters'))).toBe(true);
    expect(queryPaginated).not.toHaveBeenCalled();
  });
});
