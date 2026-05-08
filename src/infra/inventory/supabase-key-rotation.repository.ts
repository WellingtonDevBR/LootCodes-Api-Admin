/**
 * Supabase adapter for IKeyRotationRepository.
 *
 * Queries product_keys for rows not yet encrypted with the current master
 * key, and updates individual rows after rotation.
 *
 * Only considers keys in states where re-encryption is safe:
 *   - available  — in stock, not yet allocated
 *   - reserved   — held for an in-flight order; still needs to be deliverable
 *
 * Sold, faulty, and cancelled keys are excluded because:
 *   - sold keys: plaintext was already delivered; re-encrypting is cosmetic
 *     and risks touching rows that may be audited
 *   - faulty / cancelled: not going to be delivered; rotation adds no value
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type {
  IKeyRotationRepository,
  KeyRotationRecord,
} from '../../core/ports/key-rotation-repository.port.js';
import type { EncryptedKeyPayload } from '../../core/ports/key-encryption.port.js';

const ROTATABLE_STATUSES = ['available', 'reserved'] as const;

@injectable()
export class SupabaseKeyRotationRepository implements IKeyRotationRepository {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async findKeysNeedingRotation(
    currentKeyId: string,
    batchSize: number,
  ): Promise<KeyRotationRecord[]> {
    const SELECT = 'id, encrypted_key, encryption_iv, encryption_salt, encryption_key_id';

    // Two separate queries because SQL `neq` won't match NULLs — we need
    // (encryption_key_id IS NULL) OR (encryption_key_id != currentKeyId).
    // Combine, de-duplicate by id, then cap at batchSize.
    const [nullKeyRows, wrongKeyRows] = await Promise.all([
      this.db.query<KeyRotationRecord>('product_keys', {
        select: SELECT,
        filter: { encryption_key_id: null },
        in: [['status', ROTATABLE_STATUSES as unknown as unknown[]]],
        limit: batchSize,
        order: { column: 'created_at', ascending: true },
      }),
      this.db.query<KeyRotationRecord>('product_keys', {
        select: SELECT,
        neq: [['encryption_key_id', currentKeyId]],
        in: [['status', ROTATABLE_STATUSES as unknown as unknown[]]],
        limit: batchSize,
        order: { column: 'created_at', ascending: true },
      }),
    ]);

    const seen = new Set<string>();
    const combined: KeyRotationRecord[] = [];
    for (const row of [...nullKeyRows, ...wrongKeyRows]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        combined.push(row);
      }
      if (combined.length >= batchSize) break;
    }
    return combined;
  }

  async updateKeyEncryption(keyId: string, payload: EncryptedKeyPayload): Promise<void> {
    await this.db.update(
      'product_keys',
      { id: keyId },
      {
        encrypted_key: payload.encrypted_key,
        encryption_iv: payload.encryption_iv,
        encryption_salt: payload.encryption_salt,
        encryption_key_id: payload.encryption_key_id,
        updated_at: new Date().toISOString(),
      },
    );
  }
}
