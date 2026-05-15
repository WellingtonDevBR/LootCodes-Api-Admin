import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { IKeyEncryptionPort } from '../../ports/key-encryption.port.js';
import type { INotificationDispatcher } from '../../ports/notification-channel.port.js';
import type {
  DecryptKeysOrchestrateDto,
  DecryptKeysOrchestrateResult,
} from './inventory.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('DecryptKeysWithAuditUseCase');

@injectable()
export class DecryptKeysWithAuditUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
    @inject(TOKENS.KeyEncryptionPort) private readonly encryption: IKeyEncryptionPort,
    @inject(TOKENS.NotificationDispatcher) private readonly dispatcher: INotificationDispatcher,
  ) {}

  async execute(dto: DecryptKeysOrchestrateDto): Promise<DecryptKeysOrchestrateResult> {
    const result = await this.repo.decryptAndAuditKeys(dto, async (row) =>
      this.encryption.decrypt(
        row.encrypted_key!,
        row.encryption_iv!,
        row.encryption_salt!,
        row.encryption_key_id ?? null,
      ),
    );

    if (result.keys.length >= 10) {
      try {
        await this.dispatcher.dispatch({
          type: 'keys.bulk_decrypt',
          severity: result.keys.length >= 50 ? 'critical' : 'warning',
          actor: { id: dto.admin_user_id, email: dto.admin_email },
          payload: { key_count: result.keys.length, key_ids: dto.key_ids },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn('Failed to dispatch decrypt notification', err as Error);
      }
    }

    return result;
  }
}
