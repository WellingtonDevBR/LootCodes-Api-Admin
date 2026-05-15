import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { IKeyEncryptionPort } from '../../ports/key-encryption.port.js';
import type { INotificationDispatcher } from '../../ports/notification-channel.port.js';
import type { ExportKeysDto, ExportKeysResult } from './inventory.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('ExportKeysUseCase');

@injectable()
export class ExportKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
    @inject(TOKENS.KeyEncryptionPort) private readonly encryption: IKeyEncryptionPort,
    @inject(TOKENS.NotificationDispatcher) private readonly dispatcher: INotificationDispatcher,
  ) {}

  async execute(dto: ExportKeysDto): Promise<ExportKeysResult> {
    const result = await this.repo.exportKeysCsv(dto, async (row) =>
      this.encryption.decrypt(
        row.encrypted_key!,
        row.encryption_iv!,
        row.encryption_salt!,
        row.encryption_key_id ?? null,
      ),
    );

    if (dto.key_ids.length >= 10) {
      try {
        await this.dispatcher.dispatch({
          type: 'keys.bulk_download',
          severity: dto.key_ids.length >= 50 ? 'critical' : 'warning',
          actor: { id: dto.admin_user_id, email: dto.admin_email },
          payload: {
            key_count: dto.key_ids.length,
            removed: dto.remove_from_inventory,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn('Failed to dispatch export notification', err as Error);
      }
    }

    return result;
  }
}
