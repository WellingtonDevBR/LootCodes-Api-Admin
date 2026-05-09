export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'warning' | 'info';

export interface AdminAlertRow {
  readonly id: string;
  readonly alert_type: string;
  readonly severity: AlertSeverity;
  readonly title: string;
  readonly message: string;
  readonly related_order_id: string | null;
  readonly related_user_id: string | null;
  readonly metadata: Record<string, unknown>;
  readonly is_read: boolean;
  readonly is_resolved: boolean;
  readonly requires_action: boolean;
  readonly priority: number;
  readonly created_at: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
}

export interface ListAlertsDto {
  readonly is_read?: boolean;
  readonly is_resolved?: boolean;
  readonly severity?: string;
  readonly alert_type?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListAlertsResult {
  readonly alerts: readonly AdminAlertRow[];
  readonly total_count: number;
}

export interface DismissAlertDto {
  readonly id: string;
}

export interface DismissAllAlertsDto {
  readonly ids: readonly string[];
}

export interface DismissAllByFilterDto {
  readonly severity?: string;
  readonly alert_type?: string;
}

/**
 * Outcome of {@link IAdminAlertsRepository.syncSellerListingPausedAlerts}.
 *
 * `alertsCreated` — number of net-new `seller_listing_paused` rows inserted (paused listings that had no open alert).
 * `alertsResolved` — number of stale open alerts auto-closed (their listing is no longer paused).
 * `pausedListingCount` — total listings observed in a paused/failed/error state during this run.
 */
export interface SyncSellerListingPausedAlertsResult {
  readonly alertsCreated: number;
  readonly alertsResolved: number;
  readonly pausedListingCount: number;
}
