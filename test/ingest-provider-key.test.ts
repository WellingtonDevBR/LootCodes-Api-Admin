import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { InternalError } from '../src/core/errors/domain-errors.js';
import { ingestProviderPurchasedKey } from '../src/infra/procurement/ingest-provider-key.js';
import { SecureKeyManager } from '../src/infra/crypto/secure-key-manager.js';

describe('ingestProviderPurchasedKey', () => {
  beforeEach(() => {
    vi.spyOn(SecureKeyManager, 'encrypt').mockResolvedValue({
      encrypted: 'enc',
      iv: 'iv',
      salt: 'salt',
      keyId: 'primary',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns existing product_keys id when raw_key_hash already exists', async () => {
    const db = {
      queryOne: vi.fn().mockResolvedValueOnce({ id: 'existing-id' }),
      insert: vi.fn(),
    } as unknown as IDatabase;

    const id = await ingestProviderPurchasedKey(
      db,
      {
        variant_id: 'var-1',
        plaintext_key: 'same-secret',
        purchase_cost_cents: 100,
        purchase_currency: 'USD',
        supplier_reference: 'bamboo:ref',
      },
      'req-1',
    );

    expect(id).toBe('existing-id');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts an encrypted row and returns the new id', async () => {
    const db = {
      queryOne: vi.fn().mockResolvedValueOnce(null),
      insert: vi.fn().mockResolvedValue({ id: 'new-key-id' }),
    } as unknown as IDatabase;

    const id = await ingestProviderPurchasedKey(
      db,
      {
        variant_id: 'var-1',
        plaintext_key: 'fresh-secret',
        purchase_cost_cents: null,
        purchase_currency: 'EUR',
        supplier_reference: 'bamboo:ref2',
        created_by: 'aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee',
      },
      'req-2',
    );

    expect(id).toBe('new-key-id');
    expect(db.insert).toHaveBeenCalledWith(
      'product_keys',
      expect.objectContaining({
        variant_id: 'var-1',
        encryption_version: 'aes-256-gcm',
        marketplace_eligible: true,
        created_by: 'aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee',
        raw_key_hash: expect.any(String),
      }),
    );
  });

  it('on duplicate raw_key_hash during insert, loads the winner row id', async () => {
    const dupMsg =
      'Insert failed on product_keys: duplicate key value violates unique constraint "product_keys_raw_key_hash_key" (23505)';

    const db = {
      queryOne: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'race-winner' }),
      insert: vi.fn().mockRejectedValue(new InternalError(dupMsg)),
    } as unknown as IDatabase;

    const id = await ingestProviderPurchasedKey(
      db,
      {
        variant_id: 'var-1',
        plaintext_key: 'collide',
        purchase_cost_cents: 0,
        purchase_currency: 'USD',
        supplier_reference: 'x:y',
      },
      'req-3',
    );

    expect(id).toBe('race-winner');
  });

  it('throws KeyIngestionError when encrypt fails', async () => {
    vi.spyOn(SecureKeyManager, 'encrypt').mockRejectedValueOnce(new Error('no master key'));

    const db = {
      queryOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn(),
    } as unknown as IDatabase;

    await expect(
      ingestProviderPurchasedKey(
        db,
        {
          variant_id: 'var-1',
          plaintext_key: 'x',
          purchase_cost_cents: null,
          purchase_currency: 'USD',
          supplier_reference: 's',
        },
        'req-4',
      ),
    ).rejects.toMatchObject({ name: 'KeyIngestionError', stage: 'encrypt' });
  });
});
