/**
 * IKeyEncryptionPort adapter backed by SecureKeyManager (AES-256-GCM / PBKDF2).
 *
 * This thin adapter is the only place in the codebase that couples the use
 * case layer to the concrete crypto library. Swap this file to change the
 * algorithm without touching any use case.
 */
import { injectable } from 'tsyringe';
import { SecureKeyManager } from './secure-key-manager.js';
import type { IKeyEncryptionPort, EncryptedKeyPayload } from '../../core/ports/key-encryption.port.js';

const DEFAULT_PRIMARY_KEY_ID = 'primary';

@injectable()
export class SecureKeyManagerAdapter implements IKeyEncryptionPort {
  currentKeyId(): string {
    return process.env.ENCRYPTION_MASTER_KEY_ID?.trim() || DEFAULT_PRIMARY_KEY_ID;
  }

  async encrypt(plaintext: string): Promise<EncryptedKeyPayload> {
    const result = await SecureKeyManager.encrypt(plaintext);
    return {
      encrypted_key: result.encrypted,
      encryption_iv: result.iv,
      encryption_salt: result.salt,
      encryption_key_id: result.keyId,
    };
  }

  async decrypt(
    encryptedKey: string,
    iv: string,
    salt: string,
    keyId: string | null,
  ): Promise<string> {
    return SecureKeyManager.decrypt(encryptedKey, iv, salt, keyId);
  }
}
