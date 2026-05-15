import 'reflect-metadata';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { SupabaseSellerProviderConfigRepository } from '../src/infra/seller/supabase-seller-provider-config.repository.js';

function buildDb(rows: Record<string, unknown>[]) {
  const queryOne = vi.fn().mockImplementation(async () => rows[0] ?? null);
  const query = vi.fn().mockImplementation(async () => rows);
  return { queryOne, query } as unknown as IDatabase;
}

describe('SupabaseSellerProviderConfigRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses seller_config and returns a fully-populated domain config', async () => {
    const db = buildDb([{
      id: 'pa-1',
      provider_code: 'eneba',
      seller_config: {
        commission_rate_percent: 8,
        min_change_delta_cents: 5,
        auto_sync_price_default: true,
      },
    }]);
    const repo = new SupabaseSellerProviderConfigRepository(db);

    const config = await repo.getByAccountId('pa-1');
    expect(config).not.toBeNull();
    expect(config!.commission_rate_percent).toBe(8);
    expect(config!.min_change_delta_cents).toBe(5);
    expect(config!.auto_sync_price_default).toBe(true);
  });

  it('returns null when the account does not exist', async () => {
    const db = buildDb([]);
    const repo = new SupabaseSellerProviderConfigRepository(db);
    expect(await repo.getByAccountId('missing')).toBeNull();
  });

  it('memoizes reads by account id within the TTL window', async () => {
    const db = buildDb([{ id: 'pa-1', provider_code: 'eneba', seller_config: {} }]);
    const repo = new SupabaseSellerProviderConfigRepository(db);

    await repo.getByAccountId('pa-1');
    await repo.getByAccountId('pa-1');
    await repo.getByAccountId('pa-1');

    expect((db.queryOne as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('memoizes reads by provider code within the TTL window', async () => {
    const db = buildDb([{ id: 'pa-1', provider_code: 'eneba', seller_config: {} }]);
    const repo = new SupabaseSellerProviderConfigRepository(db);

    await repo.getByProviderCode('eneba');
    await repo.getByProviderCode('eneba');

    expect((db.query as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('shares cache between getByProviderCode and getByAccountId so callers can mix lookups', async () => {
    const db = buildDb([{ id: 'pa-1', provider_code: 'eneba', seller_config: {} }]);
    const repo = new SupabaseSellerProviderConfigRepository(db);

    await repo.getByProviderCode('eneba');
    // After the first read, both maps are populated — the account lookup
    // should not hit the database.
    await repo.getByAccountId('pa-1');

    expect((db.queryOne as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('invalidate drops both cache keys for the matching entry', async () => {
    const db = buildDb([{ id: 'pa-1', provider_code: 'eneba', seller_config: {} }]);
    const repo = new SupabaseSellerProviderConfigRepository(db);

    await repo.getByAccountId('pa-1');
    repo.invalidate('pa-1');
    await repo.getByAccountId('pa-1');
    await repo.getByProviderCode('eneba');

    expect((db.queryOne as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });

  it('clear empties all cached entries', async () => {
    const db = buildDb([{ id: 'pa-1', provider_code: 'eneba', seller_config: {} }]);
    const repo = new SupabaseSellerProviderConfigRepository(db);

    await repo.getByAccountId('pa-1');
    repo.clear();
    await repo.getByAccountId('pa-1');

    expect((db.queryOne as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
  });
});
