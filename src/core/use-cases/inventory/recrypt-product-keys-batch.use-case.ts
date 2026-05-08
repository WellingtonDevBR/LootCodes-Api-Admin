import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IKeyRotationRepository } from '../../ports/key-rotation-repository.port.js';
import type { IKeyEncryptionPort } from '../../ports/key-encryption.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('recrypt-product-keys-batch');

const DEFAULT_BATCH_SIZE = 50;

export interface RecryptProductKeysBatchInput {
  readonly batchSize?: number;
}

export interface RecryptProductKeysBatchResult {
  readonly processed: number;
  readonly skipped: number;
  readonly errors: number;
  readonly errorDetails: ReadonlyArray<{ keyId: string; error: string }>;
}

@injectable()
export class RecryptProductKeysBatchUseCase {
  constructor(
    @inject(TOKENS.KeyRotationRepository) private readonly repo: IKeyRotationRepository,
    @inject(TOKENS.KeyEncryptionPort) private readonly crypto: IKeyEncryptionPort,
  ) {}

  async execute(input: RecryptProductKeysBatchInput): Promise<RecryptProductKeysBatchResult> {
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const currentKeyId = this.crypto.currentKeyId();

    const keys = await this.repo.findKeysNeedingRotation(currentKeyId, batchSize);

    if (keys.length === 0) {
      logger.info('RecryptProductKeysBatch: no keys need rotation');
      return { processed: 0, skipped: 0, errors: 0, errorDetails: [] };
    }

    logger.info('RecryptProductKeysBatch: starting', {
      batchSize,
      currentKeyId,
      candidateCount: keys.length,
    });

    let processed = 0;
    let skipped = 0;
    const errorDetails: Array<{ keyId: string; error: string }> = [];

    for (const key of keys) {
      // Guard: repo should filter these out, but be defensive
      if (key.encryption_key_id === currentKeyId) {
        skipped++;
        continue;
      }

      try {
        const plaintext = await this.crypto.decrypt(
          key.encrypted_key,
          key.encryption_iv,
          key.encryption_salt,
          key.encryption_key_id,
        );

        const newPayload = await this.crypto.encrypt(plaintext);
        await this.repo.updateKeyEncryption(key.id, newPayload);
        processed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('RecryptProductKeysBatch: key rotation failed', {
          keyId: key.id,
          oldKeyId: key.encryption_key_id ?? '<null>',
          error: message,
        });
        errorDetails.push({ keyId: key.id, error: message });
      }
    }

    const errors = errorDetails.length;
    logger.info('RecryptProductKeysBatch: completed', {
      processed,
      skipped,
      errors,
      currentKeyId,
    });

    return { processed, skipped, errors, errorDetails };
  }
}
