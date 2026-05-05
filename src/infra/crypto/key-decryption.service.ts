/**
 * Key decryption service — Node.js port of the Deno SecureKeyManager.
 *
 * Reads encrypted product_keys rows from the DB, decrypts using AES-256-GCM
 * with PBKDF2 key derivation, and applies platform-specific delivery formatting.
 *
 * Multi-master-key support: keys are identified by encryption_key_id. The
 * runtime looks up the matching ENCRYPTION_MASTER_KEY_<id> env var. Legacy
 * rows (null key_id) fall back to ENCRYPTION_MASTER_KEY_LEGACY then primary.
 *
 * PBKDF2 iteration candidates: [100_000, 600_000] tried in order per key.
 */
import { injectable, inject } from 'tsyringe';
import { pbkdf2, createDecipheriv } from 'node:crypto';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IKeyDecryptionPort, DecryptedKeyResult } from '../../core/ports/key-decryption.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('key-decryption');

const DECRYPT_ITERATION_CANDIDATES: readonly number[] = [100_000, 600_000];
const DEFAULT_PRIMARY_KEY_ID = 'primary';

interface ProductKeyRow {
  id: string;
  encrypted_key: string;
  encryption_iv: string;
  encryption_salt: string;
  encryption_key_id: string | null;
  variant_id: string | null;
}

interface PlatformConfig {
  redemption_url_template: string | null;
  key_display_label: string | null;
}

// ─── PBKDF2 + AES-GCM helpers (Node.js equivalents) ─────────────────

function deriveKeyBuffer(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, ciphertext: Buffer): Buffer {
  const AUTH_TAG_LENGTH = 16;
  if (ciphertext.length < AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext too short for AES-GCM auth tag');
  }
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted;
}

// ─── Key resolution from env ─────────────────────────────────────────

function lookupKeyFromEnv(keyId: string): string | null {
  const primaryId = process.env.ENCRYPTION_MASTER_KEY_ID?.trim() || DEFAULT_PRIMARY_KEY_ID;
  const primary = process.env.ENCRYPTION_MASTER_KEY;
  if (primary && keyId === primaryId) return primary;
  const envName = 'ENCRYPTION_MASTER_KEY_' + keyId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return process.env[envName] ?? null;
}

function enumerateLegacyCandidates(): Array<{ label: string; key: string }> {
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

// ─── Decrypt primitives ──────────────────────────────────────────────

async function tryDecryptWithKey(
  masterKey: string,
  ivBytes: Buffer,
  saltBytes: Buffer,
  encryptedBytes: Buffer,
): Promise<string> {
  let lastError: unknown;
  for (const iterations of DECRYPT_ITERATION_CANDIDATES) {
    try {
      const key = await deriveKeyBuffer(masterKey, saltBytes, iterations);
      const decrypted = aesGcmDecrypt(key, ivBytes, encryptedBytes);
      return decrypted.toString('utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function decryptValue(
  encryptedData: string,
  iv: string,
  salt: string,
  keyId: string | null,
): Promise<string> {
  const saltBytes = Buffer.from(salt, 'base64');
  const ivBytes = Buffer.from(iv, 'base64');
  const encryptedBytes = Buffer.from(encryptedData, 'base64');

  if (keyId) {
    const masterKey = lookupKeyFromEnv(keyId);
    if (masterKey) {
      try {
        return await tryDecryptWithKey(masterKey, ivBytes, saltBytes, encryptedBytes);
      } catch {
        // Fall through to legacy sweep
      }
    }
  }

  const candidates = enumerateLegacyCandidates();
  if (candidates.length === 0) {
    throw new Error(
      `No master key configured for encryption_key_id="${keyId ?? '<null>'}". ` +
      `Set the appropriate ENCRYPTION_MASTER_KEY_* environment variable.`,
    );
  }

  let lastError: unknown;
  for (const { key } of candidates) {
    try {
      return await tryDecryptWithKey(key, ivBytes, saltBytes, encryptedBytes);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to decrypt key (key_id="${keyId ?? '<null>'}") against ` +
    `${candidates.length} configured master key(s). ` +
    `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

// ─── Key delivery formatting ─────────────────────────────────────────

const KNOWN_PREFIXES = [
  /^Your Code:\s*/i,
  /^Activation Key:\s*/i,
  /^Key:\s*/i,
  /^Code:\s*/i,
];

function stripKnownPrefixes(raw: string): string {
  let text = raw.trim();
  for (const prefix of KNOWN_PREFIXES) {
    text = text.replace(prefix, '');
  }
  return text.trim();
}

function formatKeyForDelivery(rawPlaintext: string, config?: PlatformConfig | null): string {
  const cleanCode = stripKnownPrefixes(rawPlaintext);
  const label = config?.key_display_label?.trim();
  const template = config?.redemption_url_template?.trim();

  if (!label || !template || !cleanCode) {
    return cleanCode;
  }

  const url = template.replace('{code}', encodeURIComponent(cleanCode));
  return `${label}: ${url}`;
}

// ─── Service ─────────────────────────────────────────────────────────

@injectable()
export class KeyDecryptionService implements IKeyDecryptionPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async decryptKeysByIds(keyIds: string[]): Promise<DecryptedKeyResult[]> {
    if (keyIds.length === 0) return [];

    const rows = await this.db.query<ProductKeyRow>('product_keys', {
      select: 'id, encrypted_key, encryption_iv, encryption_salt, encryption_key_id, variant_id',
      in: [['id', keyIds]],
    });

    if (rows.length === 0) {
      throw new Error('No keys found for the given IDs');
    }

    const variantIds = rows
      .map((r) => r.variant_id)
      .filter((id): id is string => !!id);
    const configByVariant = await this.loadPlatformConfigs(variantIds);

    const results: DecryptedKeyResult[] = [];
    for (const row of rows) {
      if (!row.encrypted_key || !row.encryption_iv || !row.encryption_salt) {
        throw new Error(`Key ${row.id} missing encryption data`);
      }
      const plaintext = await decryptValue(
        row.encrypted_key,
        row.encryption_iv,
        row.encryption_salt,
        row.encryption_key_id,
      );
      const cfg = row.variant_id ? configByVariant.get(row.variant_id) : undefined;
      results.push({ keyId: row.id, plaintext: formatKeyForDelivery(plaintext, cfg) });
    }

    return results;
  }

  private async loadPlatformConfigs(variantIds: string[]): Promise<Map<string, PlatformConfig>> {
    const map = new Map<string, PlatformConfig>();
    const uniqueIds = Array.from(new Set(variantIds));
    if (uniqueIds.length === 0) return map;

    try {
      const rows = await this.db.query<{
        variant_id: string;
        product_platforms: { redemption_url_template?: string | null; key_display_label?: string | null } | null;
      }>('variant_platforms', {
        select: 'variant_id, product_platforms(redemption_url_template, key_display_label)',
        in: [['variant_id', uniqueIds]],
      });

      for (const row of rows) {
        const cfg: PlatformConfig = {
          redemption_url_template: row.product_platforms?.redemption_url_template ?? null,
          key_display_label: row.product_platforms?.key_display_label ?? null,
        };
        if (cfg.redemption_url_template || cfg.key_display_label) {
          if (!map.has(row.variant_id)) {
            map.set(row.variant_id, cfg);
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load platform configs for delivery formatting — using bare codes', {
        error: err instanceof Error ? err.message : String(err),
        variantCount: uniqueIds.length,
      });
    }

    return map;
  }
}
