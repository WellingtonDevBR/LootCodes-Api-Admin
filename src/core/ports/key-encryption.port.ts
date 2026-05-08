/**
 * Port for symmetric encryption/decryption of product keys.
 *
 * Separates the use case from the concrete crypto library (AES-256-GCM,
 * PBKDF2). The adapter lives in `infra/crypto/`.
 */

export interface EncryptedKeyPayload {
  readonly encrypted_key: string;
  readonly encryption_iv: string;
  readonly encryption_salt: string;
  readonly encryption_key_id: string;
}

export interface IKeyEncryptionPort {
  /**
   * Encrypt a plaintext key value using the current master key.
   * Returns all fields needed to persist the result in `product_keys`.
   */
  encrypt(plaintext: string): Promise<EncryptedKeyPayload>;

  /**
   * Decrypt an encrypted product key.
   * `keyId` may be null for legacy rows — the adapter will try all
   * configured master keys.
   */
  decrypt(
    encryptedKey: string,
    iv: string,
    salt: string,
    keyId: string | null,
  ): Promise<string>;

  /**
   * The key ID that `encrypt()` will stamp on new ciphertexts.
   * Used by the rotation use case to determine which rows need re-encryption.
   */
  currentKeyId(): string;
}
