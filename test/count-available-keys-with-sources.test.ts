/**
 * Unit tests for SupabaseAdminSellerRepository.countAvailableProductKeysForVariant
 *
 * Verifies that keys from linked variant_inventory_sources are included in the
 * count so that an Eneba publish is not blocked when the consumer variant has 0
 * own keys but a source variant has available stock.
 */
import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { SupabaseAdminSellerRepository } from '../src/infra/seller/supabase-admin-seller.repository.js';

type QueryCall = [string, unknown];

function buildDb(calls: Map<string, unknown[]>): IDatabase {
  const query = vi.fn().mockImplementation((table: string) => {
    return Promise.resolve(calls.get(table) ?? []);
  });

  return {
    query,
    queryAll: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    queryPaginated: vi.fn(),
    insert: vi.fn(),
    insertMany: vi.fn(),
    update: vi.fn(),
    updateIn: vi.fn(),
    upsert: vi.fn(),
    upsertMany: vi.fn(),
    delete: vi.fn(),
    rpc: vi.fn(),
    invokeFunction: vi.fn(),
    invokeInternalFunction: vi.fn(),
  } as unknown as IDatabase;
}

describe('SupabaseAdminSellerRepository.countAvailableProductKeysForVariant', () => {
  it('counts only own keys when no inventory sources are linked', async () => {
    const db = buildDb(
      new Map([
        ['variant_inventory_sources', []],
        ['product_keys', [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }]],
      ]),
    );
    const repo = new SupabaseAdminSellerRepository(db);

    const count = await repo.countAvailableProductKeysForVariant('var-own');
    expect(count).toBe(3);
  });

  it('includes keys from linked source variants in the total count', async () => {
    const db = buildDb(
      new Map([
        [
          'variant_inventory_sources',
          [{ source_variant_id: 'var-src-1' }, { source_variant_id: 'var-src-2' }],
        ],
        // product_keys returns keys for the consumer variant AND both sources (5 total)
        [
          'product_keys',
          [{ id: 'k1' }, { id: 'k2' }, { id: 'k3' }, { id: 'k4' }, { id: 'k5' }],
        ],
      ]),
    );
    const repo = new SupabaseAdminSellerRepository(db);

    const count = await repo.countAvailableProductKeysForVariant('var-consumer');
    expect(count).toBe(5);
  });

  it('returns 0 when no own keys and no source links exist', async () => {
    const db = buildDb(
      new Map([
        ['variant_inventory_sources', []],
        ['product_keys', []],
      ]),
    );
    const repo = new SupabaseAdminSellerRepository(db);

    const count = await repo.countAvailableProductKeysForVariant('var-empty');
    expect(count).toBe(0);
  });

  it('returns 0 when source links exist but all source variants have no available keys', async () => {
    const db = buildDb(
      new Map([
        ['variant_inventory_sources', [{ source_variant_id: 'var-src-empty' }]],
        ['product_keys', []],
      ]),
    );
    const repo = new SupabaseAdminSellerRepository(db);

    const count = await repo.countAvailableProductKeysForVariant('var-consumer');
    expect(count).toBe(0);
  });

  it('queries variant_inventory_sources with consumer_variant_id and source_kind=variant', async () => {
    const db = buildDb(
      new Map([
        ['variant_inventory_sources', []],
        ['product_keys', []],
      ]),
    );
    const repo = new SupabaseAdminSellerRepository(db);

    await repo.countAvailableProductKeysForVariant('var-abc');

    expect(db.query).toHaveBeenCalledWith('variant_inventory_sources', {
      select: 'source_variant_id',
      eq: [
        ['consumer_variant_id', 'var-abc'],
        ['source_kind', 'variant'],
      ],
    });
  });

  it('queries product_keys with IN clause including own and source variant ids', async () => {
    const db = buildDb(
      new Map([
        ['variant_inventory_sources', [{ source_variant_id: 'var-src' }]],
        ['product_keys', []],
      ]),
    );
    const repo = new SupabaseAdminSellerRepository(db);

    await repo.countAvailableProductKeysForVariant('var-consumer');

    expect(db.query).toHaveBeenCalledWith('product_keys', {
      eq: [['key_state', 'available']],
      in: [['variant_id', ['var-consumer', 'var-src']]],
    });
  });
});
