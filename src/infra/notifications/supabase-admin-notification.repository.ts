import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminNotificationRepository } from '../../core/ports/admin-notification-repository.port.js';
import type {
  SendBroadcastNotificationDto,
  SendBroadcastNotificationResult,
  GetAdminUnseenCountsDto,
  GetAdminUnseenCountsResult,
  MarkAdminSectionSeenDto,
  MarkAdminSectionSeenResult,
} from '../../core/use-cases/notifications/notification.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminNotificationRepository');

@injectable()
export class SupabaseAdminNotificationRepository implements IAdminNotificationRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async sendBroadcastNotification(dto: SendBroadcastNotificationDto): Promise<SendBroadcastNotificationResult> {
    logger.info('Sending broadcast notification', { adminId: dto.admin_id, title: dto.title });

    const result = await this.db.rpc<{ notifications_queued: number }>(
      'queue_broadcast_push',
      {
        p_title: dto.title,
        p_body: dto.body,
        p_target_audience: dto.target_audience ?? null,
        p_admin_id: dto.admin_id,
      },
    );

    return {
      success: true,
      notifications_queued: result.notifications_queued,
    };
  }

  async getAdminUnseenCounts(dto: GetAdminUnseenCountsDto): Promise<GetAdminUnseenCountsResult> {
    const counts = await this.db.rpc<Record<string, number>>(
      'get_admin_unseen_counts',
      { p_admin_id: dto.admin_id },
    );

    return { counts: counts ?? {} };
  }

  async markAdminSectionSeen(dto: MarkAdminSectionSeenDto): Promise<MarkAdminSectionSeenResult> {
    await this.db.rpc('mark_admin_section_seen', {
      p_section: dto.section,
      p_admin_id: dto.admin_id,
    });

    return { success: true };
  }
}
