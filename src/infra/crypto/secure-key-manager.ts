/**
 * Node.js port of the Deno SecureKeyManager from
 * `supabase/functions/_shared/secure-key-manager.ts`.
 *
 * AES-256-GCM encryption/decryption with multi-master-key support.
 * Uses Node.js `crypto.subtle` (Web Crypto API, available since Node 15).
 */
import crypto from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

const ENCRYPT_ITERATIONS = 100_000;
const DECRYPT_ITERATION_CANDIDATES: readonly number[] = [100_000, 600_000];
const DEFAULT_PRIMARY_KEY_ID = 'primary';

type WebCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export class MasterKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterKeyConfigError';
  }
}

export class MasterKeyDecryptError extends Error {
  readonly attemptedKeyId: string;
  readonly attemptedIterations: readonly number[];
  constructor(message: string, attemptedKeyId: string, attemptedIterations: readonly number[]) {
    super(message);
    this.name = 'MasterKeyDecryptError';
    this.attemptedKeyId = attemptedKeyId;
    this.attemptedIterations = attemptedIterations;
  }
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export class SecureKeyManager {
  static async deriveKey(
    password: string,
    salt: Uint8Array,
    iterations: number = ENCRYPT_ITERATIONS,
  ): Promise<WebCryptoKey> {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private static lookupKey(keyId: string): string | null {
    const primary = process.env.ENCRYPTION_MASTER_KEY;
    const primaryId = process.env.ENCRYPTION_MASTER_KEY_ID?.trim() || DEFAULT_PRIMARY_KEY_ID;
    if (primary && keyId === primaryId) return primary;
    const envName = 'ENCRYPTION_MASTER_KEY_' + keyId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    return process.env[envName] ?? null;
  }

  private static enumerateLegacyCandidates(): Array<{ label: string; key: string }> {
    const seen = new Set<string>();
    const out: Array<{ label: string; key: string }> = [];

    const push = (label: string, key: string | undefined) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push({ label, key });
    };

    push('legacy', process.env.ENCRYPTION_MASTER_KEY_LEGACY);
    push('primary', process.env.ENCRYPTION_MASTER_KEY);

    for (const name of Object.keys(process.env)) {
      if (!name.startsWith('ENCRYPTION_MASTER_KEY_')) continue;
      if (name === 'ENCRYPTION_MASTER_KEY_ID') continue;
      if (name === 'ENCRYPTION_MASTER_KEY_LEGACY') continue;
      push(name.replace('ENCRYPTION_MASTER_KEY_', '').toLowerCase(), process.env[name]);
    }

    return out;
  }

  static async encrypt(
    plaintext: string,
  ): Promise<{ encrypted: string; iv: string; salt: string; keyId: string }> {
    const masterKey = process.env.ENCRYPTION_MASTER_KEY;
    if (!masterKey) {
      throw new MasterKeyConfigError('ENCRYPTION_MASTER_KEY is not configured.');
    }

    const keyId = process.env.ENCRYPTION_MASTER_KEY_ID?.trim() || DEFAULT_PRIMARY_KEY_ID;
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const derivedKey = await this.deriveKey(masterKey, salt, ENCRYPT_ITERATIONS);
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      enc.encode(plaintext),
    );

    return {
      encrypted: Buffer.from(encryptedBuffer).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      salt: Buffer.from(salt).toString('base64'),
      keyId,
    };
  }

  static async decrypt(
    encryptedData: string,
    iv: string,
    salt: string,
    keyId?: string | null,
  ): Promise<string> {
    const dec = new TextDecoder();
    const saltBytes = b64ToBytes(salt);
    const ivBytes = b64ToBytes(iv);
    const encryptedBytes = b64ToBytes(encryptedData);

    if (keyId) {
      const primary = this.lookupKey(keyId);
      if (primary) {
        try {
          return await this.tryDecryptWithKey(primary, ivBytes, saltBytes, encryptedBytes, dec, keyId);
        } catch {
          return this.tryAllCandidatesOrThrow(ivBytes, saltBytes, encryptedBytes, dec, keyId, primary);
        }
      }
      return this.tryAllCandidatesOrThrow(ivBytes, saltBytes, encryptedBytes, dec, keyId, null);
    }

    return this.tryAllCandidatesOrThrow(ivBytes, saltBytes, encryptedBytes, dec, '<all-fallbacks>', null);
  }

  private static async tryAllCandidatesOrThrow(
    iv: Uint8Array,
    salt: Uint8Array,
    encrypted: Uint8Array,
    decoder: InstanceType<typeof TextDecoder>,
    attemptedKeyId: string,
    alreadyTriedKey: string | null,
  ): Promise<string> {
    const candidates = this.enumerateLegacyCandidates()
      .filter(({ key }) => key !== alreadyTriedKey);

    if (candidates.length === 0) {
      throw new MasterKeyConfigError(
        `No master key configured for encryption_key_id="${attemptedKeyId}".`,
      );
    }

    let lastError: unknown;
    for (const { label, key } of candidates) {
      try {
        return await this.tryDecryptWithKey(key, iv, salt, encrypted, decoder, label);
      } catch (err) {
        lastError = err;
      }
    }

    throw new MasterKeyDecryptError(
      `Failed to decrypt (key_id="${attemptedKeyId}") against ${candidates.length} fallback(s). ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
      attemptedKeyId,
      DECRYPT_ITERATION_CANDIDATES,
    );
  }

  private static async tryDecryptWithKey(
    masterKey: string,
    iv: Uint8Array,
    salt: Uint8Array,
    encrypted: Uint8Array,
    decoder: InstanceType<typeof TextDecoder>,
    label: string,
  ): Promise<string> {
    let lastError: unknown;
    for (const iterations of DECRYPT_ITERATION_CANDIDATES) {
      try {
        const key = await this.deriveKey(masterKey, salt, iterations);
        const decrypted = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          key,
          encrypted,
        );
        return decoder.decode(decrypted);
      } catch (err) {
        lastError = err;
      }
    }
    throw new MasterKeyDecryptError(
      `Decrypt failed for key "${label}": ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      label,
      DECRYPT_ITERATION_CANDIDATES,
    );
  }
}
