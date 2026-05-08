import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

describe('SupabaseAdminProcurementRepository.liveSearchProviders merge + upsert', () => {
  it('merges live hits ahead of local catalog rows per external_product_id and schedules catalog upsert for live hits', async () => {
    const fooAdapter = {
      searchProducts: vi.fn().mockResolvedValue([
        {
          externalProductId: 'dup',
          productName: 'Live title',
          platform: 'PC',
          region: 'EU',
          priceCents: 999,
          currency: 'EUR',
          available: true,
        },
        {
          externalProductId: 'live-only',
          productName: 'Live only',
          platform: null,
          region: null,
          priceCents: 100,
          currency: 'USD',
          available: true,
        },
      ]),
    };

    const registry = {
      getSupportedProviders: (): string[] => ['foo'],
      hasCapability: (code: string, cap: string): boolean => code === 'foo' && cap === 'product_search',
      getProductSearchAdapter: (code: string) => (code === 'foo' ? fooAdapter : null),
    };

    const queryPaginated = vi.fn().mockResolvedValue({
      data: [
        {
          provider_code: 'foo',
          external_product_id: 'dup',
          product_name: 'Stale catalog title',
          platform: 'Xbox',
          region: null,
          min_price_cents: 111,
          currency: 'EUR',
          qty: 5,
          available_to_buy: true,
          thumbnail: 'thumb',
        },
        {
          provider_code: 'foo',
          external_product_id: 'local-only',
          product_name: 'Catalog only',
          platform: null,
          region: 'ROW',
          min_price_cents: 222,
          currency: 'EUR',
          qty: 1,
          available_to_buy: true,
          thumbnail: null,
        },
      ],
    });

    const query = vi.fn().mockResolvedValue([{ id: 'acct-z', provider_code: 'foo' }]);

    const upsertMany = vi.fn().mockResolvedValue(undefined);

    const db = { queryPaginated, query, upsertMany } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);
    const result = await repo.liveSearchProviders({ query: 'test', max_results: 10 });

    expect(result.providers).toHaveLength(1);
    const offers = result.providers[0]?.offers ?? [];
    expect(offers.map((o) => o.external_product_id)).toEqual(['dup', 'live-only', 'local-only']);
    expect(offers.find((o) => o.external_product_id === 'dup')?.product_name).toBe('Live title');
    expect(upsertMany).toHaveBeenCalledTimes(1);
    const upsertArg = upsertMany.mock.calls[0];
    expect(upsertArg?.[0]).toBe('provider_product_catalog');
    expect(upsertArg?.[2]).toBe('provider_account_id,external_product_id');
    const rows = upsertArg?.[1] as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.provider_account_id === 'acct-z')).toBe(true);
    const prices = rows.map((r) => r.min_price_cents as number).sort((a, b) => a - b);
    expect(prices).toEqual([100, 222, 999]);
  });

  it('fills zero live prices from catalog merge and only upserts rows with positive merged prices', async () => {
    const fooAdapter = {
      searchProducts: vi.fn().mockResolvedValue([
        {
          externalProductId: 'dup',
          productName: 'Live title',
          platform: 'PC',
          region: 'EU',
          priceCents: 0,
          currency: 'EUR',
          available: true,
        },
        {
          externalProductId: 'live-zero-only',
          productName: 'No catalog row',
          platform: null,
          region: null,
          priceCents: 0,
          currency: 'EUR',
          available: true,
        },
      ]),
    };

    const registry = {
      getSupportedProviders: (): string[] => ['foo'],
      hasCapability: (code: string, cap: string): boolean => code === 'foo' && cap === 'product_search',
      getProductSearchAdapter: (code: string) => (code === 'foo' ? fooAdapter : null),
    };

    const queryPaginated = vi.fn().mockResolvedValue({
      data: [
        {
          provider_code: 'foo',
          external_product_id: 'dup',
          product_name: 'Catalog dup',
          platform: 'Xbox',
          region: null,
          min_price_cents: 555,
          currency: 'EUR',
          qty: 5,
          available_to_buy: true,
          thumbnail: null,
        },
      ],
    });

    const query = vi.fn().mockResolvedValue([{ id: 'acct-z', provider_code: 'foo' }]);
    const upsertMany = vi.fn().mockResolvedValue(undefined);
    const db = { queryPaginated, query, upsertMany } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);
    const result = await repo.liveSearchProviders({ query: 'test', max_results: 10 });

    const offers = result.providers[0]?.offers ?? [];
    const dup = offers.find((o) => o.external_product_id === 'dup');
    expect(dup?.price_cents).toBe(555);

    expect(upsertMany).toHaveBeenCalledTimes(1);
    const rows = upsertMany.mock.calls[0]?.[1] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.external_product_id).toBe('dup');
    expect(rows[0]?.min_price_cents).toBe(555);
  });

  it('returns catalog-only groups when adapter has no product_search capability', async () => {
    const registry = {
      getSupportedProviders: (): string[] => ['bamboo'],
      hasCapability: (): boolean => false,
      getProductSearchAdapter: () => null,
    };

    const queryPaginated = vi.fn().mockResolvedValue({
      data: [
        {
          provider_code: 'bamboo',
          external_product_id: 'x1',
          product_name: 'Bamboo row',
          platform: null,
          region: null,
          min_price_cents: 50,
          currency: 'EUR',
          qty: 0,
          available_to_buy: true,
          thumbnail: null,
        },
      ],
    });
    const query = vi.fn().mockResolvedValue([{ id: 'acct-b', provider_code: 'bamboo' }]);
    const upsertMany = vi.fn();

    const db = { queryPaginated, query, upsertMany } as unknown as IDatabase;

    const repo = new SupabaseAdminProcurementRepository(db, registry as unknown as IMarketplaceAdapterRegistry);
    const result = await repo.liveSearchProviders({ query: 'row', max_results: 5 });

    expect(result.providers[0]?.offers).toHaveLength(1);
    expect(upsertMany).not.toHaveBeenCalled();
  });
});
