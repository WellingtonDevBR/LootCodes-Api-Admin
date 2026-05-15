import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminInventoryRepository } from '../../ports/admin-inventory-repository.port.js';
import type { INotificationDispatcher } from '../../ports/notification-channel.port.js';
import type { ManualSellKeysDto, ManualSellKeysResult } from './inventory.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('ManualSellKeysUseCase');

@injectable()
export class ManualSellKeysUseCase {
  constructor(
    @inject(TOKENS.AdminInventoryRepository) private readonly repo: IAdminInventoryRepository,
    @inject(TOKENS.NotificationDispatcher) private readonly dispatcher: INotificationDispatcher,
  ) {}

  async execute(dto: ManualSellKeysDto): Promise<ManualSellKeysResult> {
    const result = await this.repo.manualSellKeys(dto);

    if (dto.key_ids.length >= 5) {
      try {
        await this.dispatcher.dispatch({
          type: 'keys.manual_sale',
          severity: dto.key_ids.length >= 10 ? 'critical' : 'warning',
          actor: { id: dto.admin_user_id, email: dto.admin_email },
          payload: {
            key_count: dto.key_ids.length,
            order_id: result.order_id,
            buyer_email: dto.buyer_email,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.warn('Failed to dispatch manual-sell notification', err as Error, {
          order_id: result.order_id,
        });
      }
    }

    return result;
  }
}
