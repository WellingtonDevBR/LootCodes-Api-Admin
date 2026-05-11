/**
 * WGCards AES-128-ECB / PKCS7 crypto helper.
 *
 * The WGCards API uses AES with:
 *   - Mode:    ECB (no IV)
 *   - Padding: PKCS7 (Node's `setAutoPadding(true)` default)
 *   - Key:     raw UTF-8 bytes of `appId` — must be exactly 16 bytes (AES-128)
 *
 * This matches hutool's `SecureUtil.generateKey(AES, appId.getBytes())` when
 * the `appId` is exactly 16 chars (the key bytes are used as `SecretKeySpec`
 * directly, with no hashing or derivation).
 *
 * Request payloads are encrypted to a Base64 string and sent as the `msg` field.
 * Response bodies are a raw Base64-encoded ciphertext that must be decrypted.
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';

export class WgcardsAesCrypto {
  private readonly key: Buffer;

  constructor(appId: string) {
    const key = Buffer.from(appId, 'utf8');
    if (key.length !== 16) {
      throw new Error(
        `WGCards: appId must be exactly 16 UTF-8 bytes for AES-128 key derivation, got ${key.length} (appId length ${appId.length})`,
      );
    }
    this.key = key;
  }

  /**
   * Encrypts a JSON-serialisable payload to a Base64 string.
   * The caller is responsible for JSON.stringify-ing the payload first.
   */
  encrypt(plaintext: string): string {
    const cipher = createCipheriv('aes-128-ecb', this.key, null);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return encrypted.toString('base64');
  }

  /**
   * Decrypts a Base64-encoded ciphertext from the WGCards response and
   * returns the raw JSON string.
   */
  decrypt(ciphertext: string): string {
    const decipher = createDecipheriv('aes-128-ecb', this.key, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext, 'base64'),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  /**
   * Convenience: decrypt and JSON.parse in one call.
   * Throws if the decrypted content is not valid JSON.
   */
  decryptJson<T = unknown>(ciphertext: string): T {
    const raw = this.decrypt(ciphertext);
    return JSON.parse(raw) as T;
  }
}
