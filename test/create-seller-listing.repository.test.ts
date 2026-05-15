import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { TOKENS } from '../src/di/tokens.js';
import type { IDatabase } from '../src/core/ports/database.port.js';
import type { ISellerProviderConfigRepository } from '../src/core/ports/seller-provider-config-repository.port.js';
import type { SellerProviderConfig } from '../src/core/use-cases/seller/seller.types.js';
import { SELLER_CONFIG_DEFAULTS } from '../src/core/use-cases/seller/seller.types.js';
import { SupabaseAdminSellerRepository } from '../src/infra/seller/supabase-admin-seller.repository.js';

function registerConfigRepo(config: SellerProviderConfig | null): void {
  const repo: ISellerProviderConfigRepository = {
    async getByAccountId() { return config; },
    async getByProviderCode() { return config; },
    invalidate() { /* no-op */ },
    clear() { /* no-op */ },
  };
  container.register(TOKENS.SellerProviderConfigRepository, { useValue: repo });
}

describe('SupabaseAdminSellerRepository.createSellerListing', () => {
  beforeEach(() => {
    container.clearInstances();
  });

  function buildDb() {
    const inserts: Array<{ table: string; data: Record<string, unknown> }> = [];
    const insert = vi.fn().mockImplementation(async (table: string, data: Record<string, unknown>) => {
      inserts.push({ table, data });
      if (table === 'seller_listings') return { id: 'listing-1' };
      if (table === 'domain_events') return { id: 'event-1' };
      return { id: 'unknown-1' };
    });
    // `createSellerListing` no longer reads `provider_accounts` directly — the
    // seller-config defaults arrive through the registered config repo. We
    // still stub `query` because the repository may make secondary reads in
    // the future and we want a clean failure mode.
    const query = vi.fn().mockResolvedValue([]);
    return {
      db: { insert, query } as unknown as IDatabase,
      inserts,
    };
  }

  it('seeds new listings with provider seller_config defaults when DTO omits flags', async () => {
    registerConfigRepo({
      ...SELLER_CONFIG_DEFAULTS,
      auto_sync_stock_default: true,
      auto_sync_price_default: true,
    });
    const { db, inserts } = buildDb();
    const repo = new SupabaseAdminSellerRepository(db);

    await repo.createSellerListing({
      variant_id: 'var-1',
      provider_account_id: 'pa-1',
      price_cents: 1000,
      admin_id: 'admin-1',
    });

    const sellerInsert = inserts.find((i) => i.table === 'seller_listings');
    expect(sellerInsert).toBeDefined();
    expect(sellerInsert!.data.auto_sync_stock).toBe(true);
    expect(sellerInsert!.data.auto_sync_price).toBe(true);
  });

  it('honours explicit DTO override over provider seller_config', async () => {
    registerConfigRepo({
      ...SELLER_CONFIG_DEFAULTS,
      auto_sync_stock_default: true,
      auto_sync_price_default: true,
    });
    const { db, inserts } = buildDb();
    const repo = new SupabaseAdminSellerRepository(db);

    await repo.createSellerListing({
      variant_id: 'var-1',
      provider_account_id: 'pa-1',
      price_cents: 1000,
      admin_id: 'admin-1',
      auto_sync_stock: false,
      auto_sync_price: false,
    });

    const sellerInsert = inserts.find((i) => i.table === 'seller_listings');
    expect(sellerInsert!.data.auto_sync_stock).toBe(false);
    expect(sellerInsert!.data.auto_sync_price).toBe(false);
  });

  it('falls back to provider_account_defaults when seller_config disables one flag', async () => {
    registerConfigRepo({
      ...SELLER_CONFIG_DEFAULTS,
      auto_sync_stock_default: false,
      auto_sync_price_default: true,
    });
    const { db, inserts } = buildDb();
    const repo = new SupabaseAdminSellerRepository(db);

    await repo.createSellerListing({
      variant_id: 'var-1',
      provider_account_id: 'pa-1',
      price_cents: 1000,
      admin_id: 'admin-1',
    });

    const sellerInsert = inserts.find((i) => i.table === 'seller_listings');
    expect(sellerInsert!.data.auto_sync_stock).toBe(false);
    expect(sellerInsert!.data.auto_sync_price).toBe(true);
  });
});
