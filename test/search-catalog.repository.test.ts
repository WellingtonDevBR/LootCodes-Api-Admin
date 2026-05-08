import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import type { CatalogProductRow } from '../src/core/use-cases/procurement/procurement.types.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

function catalogRow(
  overrides: Partial<CatalogProductRow> & Pick<CatalogProductRow, 'id' | 'provider_code' | 'product_name'>,
): CatalogProductRow {
  return {
    external_product_id: overrides.external_product_id ?? 'ext',
    external_parent_product_id: overrides.external_parent_product_id ?? null,
    platform: overrides.platform ?? null,
    region: overrides.region ?? null,
    min_price_cents: overrides.min_price_cents ?? 100,
    currency: overrides.currency ?? 'USD',
    qty: overrides.qty ?? 1,
    available_to_buy: overrides.available_to_buy ?? true,
    thumbnail: overrides.thumbnail ?? null,
    slug: overrides.slug ?? null,
    wholesale_price_cents: overrides.wholesale_price_cents ?? null,
    updated_at: overrides.updated_at ?? '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('SupabaseAdminProcurementRepository.searchCatalog blended fairness', () => {
  it('merges per-provider slices when provider_code is omitted so low-sort-traffic providers are not starved', async () => {
    const registry = {
      getSupportedProviders: (): string[] => ['aaa', 'zzz'],
      hasCapability: (): boolean => false,
      getProductSearchAdapter: () => null,
    };

    const queryPaginated = vi.fn().mockImplementation((_table: string, opts: { filter?: { provider_code?: string } }) => {
      if (!opts.filter?.provider_code) {
        return Promise.resolve({ data: [], total: 42 });
      }
      const code = opts.filter.provider_code as string;
      if (code === 'aaa') {
        return Promise.resolve({
          data: [
            catalogRow({
              id: 'a1',
              provider_code: 'aaa',
              product_name: 'Alpha minecraft',
              external_product_id: 'ea',
            }),
          ],
          total: 10,
        });
      }
      if (code === 'zzz') {
        return Promise.resolve({
          data: [
            catalogRow({
              id: 'z1',
              provider_code: 'zzz',
              product_name: 'Zebra minecraft',
              external_product_id: 'ez',
            }),
          ],
          total: 10,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    });

    const db = { queryPaginated } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);

    const result = await repo.searchCatalog({ search: 'minecraft', page_size: 20, page: 1 });

    expect(queryPaginated).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(42);
    expect(result.products.map((p) => p.product_name)).toEqual(['Alpha minecraft', 'Zebra minecraft']);
  });

  it('uses normal pagination when provider_code is set', async () => {
    const registry = {
      getSupportedProviders: (): string[] => ['foo'],
      hasCapability: (): boolean => false,
      getProductSearchAdapter: () => null,
    };

    const queryPaginated = vi.fn().mockResolvedValue({
      data: [
        catalogRow({
          id: 'x',
          provider_code: 'foo',
          product_name: 'Only foo',
          external_product_id: 'e',
        }),
      ],
      total: 1,
    });

    const db = { queryPaginated } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);

    const result = await repo.searchCatalog({
      search: 'mine',
      provider_code: 'foo',
      page_size: 10,
      page: 1,
    });

    expect(queryPaginated).toHaveBeenCalledTimes(1);
    expect(result.products).toHaveLength(1);
    expect(queryPaginated.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        filter: { provider_code: 'foo' },
        ilike: [['product_name', '%mine%']],
        range: [0, 9],
      }),
    );
  });

  it('ANDs whitespace-separated search tokens as multiple product_name ILIKE filters', async () => {
    const registry = {
      getSupportedProviders: (): string[] => ['foo'],
      hasCapability: (): boolean => false,
      getProductSearchAdapter: () => null,
    };

    const queryPaginated = vi.fn().mockResolvedValue({ data: [], total: 0 });

    const db = { queryPaginated } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);

    await repo.searchCatalog({
      search: 'Minecraft Java',
      provider_code: 'foo',
      page_size: 10,
      page: 1,
    });

    expect(queryPaginated.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        ilike: [
          ['product_name', '%Minecraft%'],
          ['product_name', '%Java%'],
        ],
      }),
    );
  });
});
