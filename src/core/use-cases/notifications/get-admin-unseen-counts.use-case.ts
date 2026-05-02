import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminNotificationRepository } from '../../ports/admin-notification-repository.port.js';
import type { GetAdminUnseenCountsDto, GetAdminUnseenCountsResult } from './notification.types.js';

@injectable()
export class GetAdminUnseenCountsUseCase {
  constructor(
    @inject(TOKENS.AdminNotificationRepository) private repo: IAdminNotificationRepository,
  ) {}

  async execute(dto: GetAdminUnseenCountsDto): Promise<GetAdminUnseenCountsResult> {
    return this.repo.getAdminUnseenCounts(dto);
  }
}
