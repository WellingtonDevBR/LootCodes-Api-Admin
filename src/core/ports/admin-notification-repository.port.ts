import type {
  SendBroadcastNotificationDto,
  SendBroadcastNotificationResult,
  GetAdminUnseenCountsDto,
  GetAdminUnseenCountsResult,
  MarkAdminSectionSeenDto,
  MarkAdminSectionSeenResult,
} from '../use-cases/notifications/notification.types.js';

export interface IAdminNotificationRepository {
  sendBroadcastNotification(dto: SendBroadcastNotificationDto): Promise<SendBroadcastNotificationResult>;
  getAdminUnseenCounts(dto: GetAdminUnseenCountsDto): Promise<GetAdminUnseenCountsResult>;
  markAdminSectionSeen(dto: MarkAdminSectionSeenDto): Promise<MarkAdminSectionSeenResult>;
}
