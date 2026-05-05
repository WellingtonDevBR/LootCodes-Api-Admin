export interface DecryptedKeyResult {
  keyId: string;
  plaintext: string;
}

export interface IKeyDecryptionPort {
  /**
   * Decrypt product keys by their IDs. Reads encrypted data from the DB,
   * decrypts using the configured master keys, and applies platform-specific
   * delivery formatting (e.g. redemption URL template).
   */
  decryptKeysByIds(keyIds: string[]): Promise<DecryptedKeyResult[]>;
}
