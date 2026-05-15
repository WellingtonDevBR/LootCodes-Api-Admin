import type {
  ListAlertsDto,
  ListAlertsResult,
  DismissAlertDto,
  DismissAllAlertsDto,
  DismissAllByFilterDto,
  SyncSellerListingPausedAlertsResult,
  SyncSellerListingPricingFrozenAlertsResult,
} from '../use-cases/alerts/alerts.types.js';

export interface IAdminAlertsRepository {
  listAlerts(dto: ListAlertsDto): Promise<ListAlertsResult>;
  dismissAlert(dto: DismissAlertDto): Promise<void>;
  dismissAllAlerts(dto: DismissAllAlertsDto): Promise<void>;
  dismissAllByFilter(dto: DismissAllByFilterDto): Promise<number>;
  /**
   * Reconciles `admin_alerts` rows of type `seller_listing_paused` against the current
   * paused/failed listings in `seller_listings`. Idempotent: missing alerts are inserted,
   * stale ones (listing no longer paused) are auto-resolved. Designed to be invoked as a
   * cron phase of `ReconcileSellerListingsUseCase`.
   */
  syncSellerListingPausedAlerts(): Promise<SyncSellerListingPausedAlertsResult>;
  /**
   * Reconciles `admin_alerts` rows of type `seller_listing_pricing_frozen` against active
   * listings with auto_sync_price=true that are stuck in `budget_exhausted` for >6h or
   * priced below cost-basis for >1h. Idempotent: missing alerts are inserted, recovered
   * listings have their alerts auto-resolved. Invoked as a cron phase of
   * `ReconcileSellerListingsUseCase`.
   */
  syncSellerListingPricingFrozenAlerts(): Promise<SyncSellerListingPricingFrozenAlertsResult>;
}
