import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { SupabasePlatformSettingsRepository } from '../src/infra/platform-settings/supabase-platform-settings.repository.js';

function buildDb(queryOneReturn: unknown): IDatabase {
  return {
    query: vi.fn(),
    queryAll: vi.fn(),
    queryOne: vi.fn().mockResolvedValue(queryOneReturn),
    queryPaginated: vi.fn(),
    insert: vi.fn(),
    insertMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    upsertMany: vi.fn(),
    delete: vi.fn(),
    rpc: vi.fn(),
    invokeFunction: vi.fn(),
    invokeInternalFunction: vi.fn(),
  } as unknown as IDatabase;
}

describe('SupabasePlatformSettingsRepository.getFulfillmentMode', () => {
  it('returns "auto" when stored', async () => {
    const db = buildDb({ value: { mode: 'auto' } });
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).resolves.toBe('auto');
  });

  it('returns "hold_all" when stored', async () => {
    const db = buildDb({ value: { mode: 'hold_all', set_at: null, set_by: 'admin-1' } });
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).resolves.toBe('hold_all');
  });

  it('returns "hold_new_cards" when stored', async () => {
    const db = buildDb({ value: { mode: 'hold_new_cards' } });
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).resolves.toBe('hold_new_cards');
  });

  it('throws when no platform_settings row exists for fulfillment_mode', async () => {
    const db = buildDb(null);
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).rejects.toThrow(/fulfillment_mode/);
  });

  it('throws when value is missing the mode field', async () => {
    const db = buildDb({ value: { unrelated: true } });
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).rejects.toThrow(/fulfillment_mode/);
  });

  it('throws when stored mode is an unknown string', async () => {
    const db = buildDb({ value: { mode: 'panic' } });
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).rejects.toThrow(/panic/);
  });

  it('throws when value is not an object', async () => {
    const db = buildDb({ value: 'auto' });
    const repo = new SupabasePlatformSettingsRepository(db);
    await expect(repo.getFulfillmentMode()).rejects.toThrow(/fulfillment_mode/);
  });

  it('queries platform_settings with key=fulfillment_mode using maybeSingle', async () => {
    const db = buildDb({ value: { mode: 'auto' } });
    const repo = new SupabasePlatformSettingsRepository(db);
    await repo.getFulfillmentMode();
    expect(db.queryOne).toHaveBeenCalledWith('platform_settings', {
      select: 'value',
      eq: [['key', 'fulfillment_mode']],
      maybeSingle: true,
    });
  });
});
