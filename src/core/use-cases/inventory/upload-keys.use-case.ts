import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { IKeyEncryptionPort } from '../../ports/key-encryption.port.js';
import { ValidationError } from '../../errors/domain-errors.js';
import type { UploadKeysDto, UploadKeysResult } from './inventory.types.js';

const MAX_KEYS_PER_BATCH = 1000;

@injectable()
export class UploadKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private repo: IAdminInventoryRepository,
    @inject(TOKENS.KeyEncryptionPort) private encryption: IKeyEncryptionPort,
  ) {}

  async execute(dto: UploadKeysDto): Promise<UploadKeysResult> {
    if (!dto.variant_id) throw new ValidationError('variant_id is required');
    if (!Array.isArray(dto.keys) || dto.keys.length === 0) {
      throw new ValidationError('keys array is required and must not be empty');
    }
    if (dto.keys.length > MAX_KEYS_PER_BATCH) {
      throw new ValidationError(`Maximum ${MAX_KEYS_PER_BATCH} keys per upload batch`);
    }

    return this.repo.uploadKeys(dto, (plaintext) => this.encryption.encrypt(plaintext));
  }
}
