import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RecryptProductKeysBatchUseCase } from '../src/core/use-cases/inventory/recrypt-product-keys-batch.use-case.js';
import type { IKeyRotationRepository, KeyRotationRecord } from '../src/core/ports/key-rotation-repository.port.js';
import type { IKeyEncryptionPort, EncryptedKeyPayload } from '../src/core/ports/key-encryption.port.js';

// ─── Fakes ────────────────────────────────────────────────────────────

function makeKey(id: string, keyId: string | null = 'old-key'): KeyRotationRecord {
  return {
    id,
    encrypted_key: `enc_${id}`,
    encryption_iv: `iv_${id}`,
    encryption_salt: `salt_${id}`,
    encryption_key_id: keyId,
  };
}

function makeEncryptionPort(currentKeyId = 'new-key'): IKeyEncryptionPort & {
  encryptCalls: string[];
  decryptCalls: string[];
  failOn: Set<string>;
} {
  const encryptCalls: string[] = [];
  const decryptCalls: string[] = [];
  const failOn = new Set<string>();

  return {
    encryptCalls,
    decryptCalls,
    failOn,
    currentKeyId: () => currentKeyId,
    async decrypt(encryptedKey, _iv, _salt, _keyId) {
      decryptCalls.push(encryptedKey);
      if (failOn.has(encryptedKey)) throw new Error(`Decrypt failed for ${encryptedKey}`);
      return `plain_${encryptedKey}`;
    },
    async encrypt(plaintext) {
      encryptCalls.push(plaintext);
      return {
        encrypted_key: `new_enc_${plaintext}`,
        encryption_iv: 'new_iv',
        encryption_salt: 'new_salt',
        encryption_key_id: currentKeyId,
      } satisfies EncryptedKeyPayload;
    },
  };
}

function makeRepo(keys: KeyRotationRecord[] = []): IKeyRotationRepository & {
  updates: Array<{ keyId: string; payload: EncryptedKeyPayload }>;
} {
  const updates: Array<{ keyId: string; payload: EncryptedKeyPayload }> = [];
  return {
    updates,
    async findKeysNeedingRotation(_currentKeyId, batchSize) {
      return keys.slice(0, batchSize);
    },
    async updateKeyEncryption(keyId, payload) {
      updates.push({ keyId, payload });
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('RecryptProductKeysBatchUseCase', () => {
  let encryptionPort: ReturnType<typeof makeEncryptionPort>;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    encryptionPort = makeEncryptionPort('new-key');
    repo = makeRepo([makeKey('k1'), makeKey('k2'), makeKey('k3')]);
  });

  // ─── Happy path ────────────────────────────────────────────────

  it('decrypts and re-encrypts each key then updates the DB', async () => {
    const uc = new RecryptProductKeysBatchUseCase(repo, encryptionPort);

    const result = await uc.execute({ batchSize: 10 });

    expect(result.processed).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    expect(encryptionPort.decryptCalls).toHaveLength(3);
    expect(encryptionPort.encryptCalls).toHaveLength(3);
    expect(repo.updates).toHaveLength(3);
  });

  it('stamps the new key ID on every updated row', async () => {
    const uc = new RecryptProductKeysBatchUseCase(repo, encryptionPort);
    await uc.execute({});

    for (const u of repo.updates) {
      expect(u.payload.encryption_key_id).toBe('new-key');
    }
  });

  it('uses the old encrypted_key, iv, salt, and key_id when decrypting', async () => {
    const decryptArgs: Array<[string, string, string, string | null]> = [];
    const spy: IKeyEncryptionPort = {
      ...encryptionPort,
      async decrypt(encryptedKey, iv, salt, keyId) {
        decryptArgs.push([encryptedKey, iv, salt, keyId]);
        return `plain_${encryptedKey}`;
      },
    };

    const uc = new RecryptProductKeysBatchUseCase(repo, spy);
    await uc.execute({});

    expect(decryptArgs[0]).toEqual(['enc_k1', 'iv_k1', 'salt_k1', 'old-key']);
  });

  // ─── Batch size respected ──────────────────────────────────────

  it('passes batchSize to the repository', async () => {
    const findSpy = vi.fn().mockResolvedValue([makeKey('k1')]);
    const spyRepo: IKeyRotationRepository = {
      findKeysNeedingRotation: findSpy,
      updateKeyEncryption: vi.fn().mockResolvedValue(undefined),
    };

    const uc = new RecryptProductKeysBatchUseCase(spyRepo, encryptionPort);
    await uc.execute({ batchSize: 25 });

    expect(findSpy).toHaveBeenCalledWith('new-key', 25);
  });

  it('defaults batchSize to 50 when not provided', async () => {
    const findSpy = vi.fn().mockResolvedValue([]);
    const spyRepo: IKeyRotationRepository = {
      findKeysNeedingRotation: findSpy,
      updateKeyEncryption: vi.fn().mockResolvedValue(undefined),
    };

    const uc = new RecryptProductKeysBatchUseCase(spyRepo, encryptionPort);
    await uc.execute({});

    expect(findSpy).toHaveBeenCalledWith('new-key', 50);
  });

  // ─── Empty batch ───────────────────────────────────────────────

  it('returns zeros when no keys need rotation', async () => {
    const uc = new RecryptProductKeysBatchUseCase(makeRepo([]), encryptionPort);

    const result = await uc.execute({});

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.errorDetails).toHaveLength(0);
  });

  // ─── Per-key error isolation ───────────────────────────────────

  it('records the error for a single failing key without aborting the rest', async () => {
    encryptionPort.failOn.add('enc_k2');
    const uc = new RecryptProductKeysBatchUseCase(repo, encryptionPort);

    const result = await uc.execute({});

    expect(result.processed).toBe(2); // k1 and k3
    expect(result.errors).toBe(1);    // k2 failed
    expect(result.errorDetails).toHaveLength(1);
    expect(result.errorDetails[0]?.keyId).toBe('k2');
    expect(result.errorDetails[0]?.error).toMatch(/Decrypt failed/);

    // The two successful keys were still updated in DB
    expect(repo.updates.map((u) => u.keyId)).toEqual(['k1', 'k3']);
  });

  // ─── Skips keys already on the current key ─────────────────────

  it('skips keys that already carry the current encryption_key_id', async () => {
    const mixedRepo = makeRepo([
      makeKey('already-current', 'new-key'), // already up to date
      makeKey('needs-rotation', 'old-key'),
    ]);
    // findKeysNeedingRotation should NOT return the already-current key,
    // but let's verify the use case is defensive even if the repo yields it.
    const uc = new RecryptProductKeysBatchUseCase(mixedRepo, encryptionPort);

    // Override repo to return both keys
    vi.spyOn(mixedRepo, 'findKeysNeedingRotation').mockResolvedValue([
      makeKey('already-current', 'new-key'),
      makeKey('needs-rotation', 'old-key'),
    ]);

    const result = await uc.execute({});

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(1);
    expect(mixedRepo.updates.map((u) => u.keyId)).toEqual(['needs-rotation']);
  });

  // ─── All keys fail ─────────────────────────────────────────────

  it('reports all errors when every key fails — does not throw', async () => {
    encryptionPort.failOn.add('enc_k1');
    encryptionPort.failOn.add('enc_k2');
    encryptionPort.failOn.add('enc_k3');

    const uc = new RecryptProductKeysBatchUseCase(repo, encryptionPort);
    const result = await uc.execute({});

    expect(result.errors).toBe(3);
    expect(result.processed).toBe(0);
    expect(repo.updates).toHaveLength(0);
  });
});
