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

/**
 * Outcome of {@link IAdminAlertsRepository.syncSellerListingPricingFrozenAlerts}.
 *
 * Listings are considered "pricing frozen" when EITHER:
 *   1. The most recent `seller_pricing_decisions` row for the listing is
 *      `action='skipped' AND reason_code='budget_exhausted'` AND the listing's
 *      `last_synced_at` is older than `FROZEN_BUDGET_HOURS` (default 6 h), OR
 *   2. The listing has `auto_sync_price=true` AND `price_cents < cost_basis_cents`
 *      for more than `FROZEN_BELOW_COST_HOURS` (default 1 h).
 *
 * `alertsCreated` — net-new `seller_listing_pricing_frozen` rows inserted.
 * `alertsResolved` — open alerts auto-closed because the listing recovered.
 * `frozenListingCount` — total listings observed in a frozen state.
 */
export interface SyncSellerListingPricingFrozenAlertsResult {
  readonly alertsCreated: number;
  readonly alertsResolved: number;
  readonly frozenListingCount: number;
}
