import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminNotificationRepository } from '../../ports/admin-notification-repository.port.js';
import type { SendBroadcastNotificationDto, SendBroadcastNotificationResult } from './notification.types.js';

@injectable()
export class SendBroadcastNotificationUseCase {
  constructor(
    @inject(TOKENS.AdminNotificationRepository) private repo: IAdminNotificationRepository,
  ) {}

  async execute(dto: SendBroadcastNotificationDto): Promise<SendBroadcastNotificationResult> {
    return this.repo.sendBroadcastNotification(dto);
  }
}
