import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminNotificationRepository } from '../../ports/admin-notification-repository.port.js';
import type { MarkAdminSectionSeenDto, MarkAdminSectionSeenResult } from './notification.types.js';

@injectable()
export class MarkAdminSectionSeenUseCase {
  constructor(
    @inject(TOKENS.AdminNotificationRepository) private repo: IAdminNotificationRepository,
  ) {}

  async execute(dto: MarkAdminSectionSeenDto): Promise<MarkAdminSectionSeenResult> {
    return this.repo.markAdminSectionSeen(dto);
  }
}
