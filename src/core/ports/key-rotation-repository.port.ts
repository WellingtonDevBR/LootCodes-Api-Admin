/**
 * Port for accessing product keys that need encryption-key rotation.
 *
 * Keeps the rotation use case independent of Supabase / PostgREST.
 */
import type { EncryptedKeyPayload } from './key-encryption.port.js';

export interface KeyRotationRecord {
  readonly id: string;
  readonly encrypted_key: string;
  readonly encryption_iv: string;
  readonly encryption_salt: string;
  readonly encryption_key_id: string | null;
}

export interface IKeyRotationRepository {
  /**
   * Returns up to `batchSize` product keys whose `encryption_key_id` does
   * not match `currentKeyId` (or is null). These are the candidates for
   * re-encryption.
   *
   * Only considers keys in states where re-encryption is safe and meaningful
   * (available, reserved). Sold / faulty keys are excluded.
   */
  findKeysNeedingRotation(
    currentKeyId: string,
    batchSize: number,
  ): Promise<KeyRotationRecord[]>;

  /**
   * Overwrites the encryption fields of a single key row with the new
   * ciphertext produced by the current master key.
   */
  updateKeyEncryption(keyId: string, payload: EncryptedKeyPayload): Promise<void>;
}
