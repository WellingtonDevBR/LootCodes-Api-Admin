import 'reflect-metadata';
import { describe, expect, it, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { TOKENS } from '../src/di/tokens.js';
import type { ISellerProviderConfigRepository } from '../src/core/ports/seller-provider-config-repository.port.js';
import type { SellerProviderConfig } from '../src/core/use-cases/seller/seller.types.js';
import { SELLER_CONFIG_DEFAULTS } from '../src/core/use-cases/seller/seller.types.js';
import { resolveSellerSyncDefaults } from '../src/infra/seller/seller-sync-defaults.js';

function makeRepo(config: SellerProviderConfig | null): ISellerProviderConfigRepository {
  return {
    async getByAccountId() { return config; },
    async getByProviderCode() { return config; },
    invalidate() { /* no-op */ },
    clear() { /* no-op */ },
  };
}

describe('resolveSellerSyncDefaults', () => {
  beforeEach(() => {
    container.clearInstances();
  });

  it('returns provider seller_config defaults when DTO omits both flags', async () => {
    container.register(TOKENS.SellerProviderConfigRepository, {
      useValue: makeRepo({
        ...SELLER_CONFIG_DEFAULTS,
        auto_sync_stock_default: true,
        auto_sync_price_default: true,
      }),
    });
    const out = await resolveSellerSyncDefaults('pa-1', {});
    expect(out).toEqual({ auto_sync_stock: true, auto_sync_price: true });
  });

  it('honours explicit DTO override over provider defaults', async () => {
    container.register(TOKENS.SellerProviderConfigRepository, {
      useValue: makeRepo({
        ...SELLER_CONFIG_DEFAULTS,
        auto_sync_stock_default: true,
        auto_sync_price_default: true,
      }),
    });
    const out = await resolveSellerSyncDefaults('pa-1', {
      auto_sync_stock: false,
      auto_sync_price: false,
    });
    expect(out).toEqual({ auto_sync_stock: false, auto_sync_price: false });
  });

  it('falls back to SELLER_CONFIG_DEFAULTS (true) when no row is found', async () => {
    container.register(TOKENS.SellerProviderConfigRepository, { useValue: makeRepo(null) });
    const out = await resolveSellerSyncDefaults('pa-1', {});
    expect(out).toEqual({ auto_sync_stock: true, auto_sync_price: true });
  });

  it('respects an explicit per-provider opt-out of auto_sync_stock', async () => {
    container.register(TOKENS.SellerProviderConfigRepository, {
      useValue: makeRepo({
        ...SELLER_CONFIG_DEFAULTS,
        auto_sync_stock_default: false,
        auto_sync_price_default: true,
      }),
    });
    const out = await resolveSellerSyncDefaults('pa-1', {});
    expect(out).toEqual({ auto_sync_stock: false, auto_sync_price: true });
  });
});
