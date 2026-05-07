/**
 * Encrypt and insert a provider-purchased key — parity with Edge `ingestProviderKey`.
 */
import { createHash } from 'node:crypto';
import type { IDatabase } from '../../core/ports/database.port.js';
import { InternalError } from '../../core/errors/domain-errors.js';
import { SecureKeyManager } from '../crypto/secure-key-manager.js';

export type IngestionStage =
  | 'hash'
  | 'dedup_lookup'
  | 'encrypt'
  | 'insert'
  | 'race_lookup';

export class KeyIngestionError extends Error {
  readonly stage: IngestionStage;
  readonly causeUnknown: unknown;

  constructor(stage: IngestionStage, message: string, causeUnknown?: unknown) {
    super(`[${stage}] ${message}`);
    this.name = 'KeyIngestionError';
    this.stage = stage;
    this.causeUnknown = causeUnknown;
  }
}

export interface IngestProviderKeyParams {
  readonly variant_id: string;
  readonly plaintext_key: string;
  readonly purchase_cost_cents: number | null;
  readonly purchase_currency: string;
  readonly supplier_reference: string;
  readonly created_by?: string | null;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function sha256Hex(plaintext: string): Promise<string> {
  try {
    const hash = createHash('sha256').update(plaintext, 'utf8').digest('hex');
    return hash;
  } catch (err) {
    throw new KeyIngestionError('hash', asMessage(err), err);
  }
}

export async function ingestProviderPurchasedKey(
  db: IDatabase,
  params: IngestProviderKeyParams,
  requestId: string,
): Promise<string> {
  const rawKeyHash = await sha256Hex(params.plaintext_key);

  try {
    const existing = await db.queryOne<{ id: string }>('product_keys', {
      select: 'id',
      filter: { raw_key_hash: rawKeyHash },
    });
    if (existing?.id) {
      return existing.id;
    }
  } catch (err) {
    throw new KeyIngestionError('dedup_lookup', asMessage(err), err);
  }

  let encrypted: string;
  let iv: string;
  let salt: string;
  let keyId: string;
  try {
    const enc = await SecureKeyManager.encrypt(params.plaintext_key);
    encrypted = enc.encrypted;
    iv = enc.iv;
    salt = enc.salt;
    keyId = enc.keyId;
  } catch (err) {
    throw new KeyIngestionError('encrypt', asMessage(err), err);
  }

  const row: Record<string, unknown> = {
    variant_id: params.variant_id,
    encrypted_key: encrypted,
    encryption_iv: iv,
    encryption_salt: salt,
    encryption_key_id: keyId,
    encryption_version: 'aes-256-gcm',
    key_state: 'available',
    is_used: false,
    purchase_cost: params.purchase_cost_cents,
    purchase_currency: params.purchase_currency,
    supplier_reference: params.supplier_reference,
    raw_key_hash: rawKeyHash,
    marketplace_eligible: true,
  };

  if (params.created_by !== undefined && params.created_by !== null && params.created_by.length > 0) {
    row.created_by = params.created_by;
  }

  try {
    const inserted = await db.insert<{ id: string }>('product_keys', row);
    return inserted.id;
  } catch (err) {
    const msg = err instanceof InternalError ? err.message : asMessage(err);
    if (msg.includes('23505') && msg.includes('raw_key_hash')) {
      try {
        const raceExisting = await db.queryOne<{ id: string }>('product_keys', {
          select: 'id',
          filter: { raw_key_hash: rawKeyHash },
        });
        if (raceExisting?.id) {
          return raceExisting.id;
        }
      } catch (raceErr) {
        throw new KeyIngestionError('race_lookup', asMessage(raceErr), raceErr);
      }
    }
    throw new KeyIngestionError('insert', `${msg} (requestId=${requestId})`, err);
  }
}
