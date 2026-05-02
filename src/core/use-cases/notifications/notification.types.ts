export interface SendBroadcastNotificationDto { title: string; body: string; target_audience?: string; admin_id: string }
export interface SendBroadcastNotificationResult { success: boolean; notifications_queued: number }
export interface GetAdminUnseenCountsDto { admin_id: string }
export interface GetAdminUnseenCountsResult { counts: Record<string, number> }
export interface MarkAdminSectionSeenDto { section: string; admin_id: string }
export interface MarkAdminSectionSeenResult { success: boolean }
