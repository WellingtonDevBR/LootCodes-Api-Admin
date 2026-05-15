/**
 * Input/output shapes for ReconcileSellerListingsUseCase — the single
 * orchestrated cron entry point for seller-side marketplace maintenance.
 *
 * This cron operates exclusively on admin-owned marketplace listings
 * (Eneba, Kinguin, …). It is NOT gated by `platform_settings.fulfillment_mode`
 * — that flag governs user-facing checkout/key delivery and has no bearing
 * on whether seller listings should keep mirroring our cost basis, prices,
 * and stock declarations.
 *
 * Live buyer-catalog quote refresh runs out-of-band on
 * `POST /internal/cron/sync-buyer-catalog` and is intentionally NOT a phase
 * here, to keep the orchestrator focused on seller-listing reconciliation.
 */

export const RECONCILE_PHASES = [
  'expire-reservations',
  'cost-basis',
  'pricing',
  'declared-stock',
  'remote-stock',
  /**
   * Cross-check our internal key provisions against Eneba's live S_keys data.
   * - REPORTED keys → mark `faulty` in product_keys.
   * - Orphaned provisions (delivered on our side but not SOLD on Eneba) →
   *   restock key to `available`, mark provision `refunded`, cancel reservation.
   * Runs after remote-stock so declared-stock quantities are already up-to-date.
   */
  'eneba-key-reconcile',
  /**
   * Idempotent reconciliation of `admin_alerts` of type `seller_listing_paused`. Runs last so
   * earlier phases (which may pause a listing they could not heal) are reflected in the
   * alerts surface within the same cron tick.
   */
  'paused-listing-alerts',
  /**
   * Idempotent reconciliation of `admin_alerts` of type `seller_listing_pricing_frozen`.
   * Surfaces listings whose pricing is stuck (budget_exhausted for >6h or below
   * cost basis for >1h). Runs after `pricing` so the freshest decision rows are
   * considered.
   */
  'pricing-frozen-alerts',
] as const;

export type ReconcilePhase = (typeof RECONCILE_PHASES)[number];

export interface ReconcileSellerListingsDto {
  /** Optional UUID filter; honoured by `declared-stock` phase only (other phases sweep all auto-sync listings). */
  readonly variant_ids?: readonly string[];
  /** Hard cap forwarded to the `declared-stock` phase. */
  readonly batch_limit?: number;
  /** When true, `declared-stock` simulates without pushing to marketplaces. Other phases ignore this flag. */
  readonly dry_run?: boolean;
  /** Optional whitelist; if omitted all phases run in canonical order. */
  readonly phases?: readonly ReconcilePhase[];
}

export type SkipReason = 'phase_filter';

export interface PhaseOutcome<T = unknown> {
  readonly ran: boolean;
  readonly skipped_reason?: SkipReason;
  readonly result?: T;
  readonly error?: string;
  readonly duration_ms: number;
}

export interface ReconcileSellerListingsResult {
  readonly request_id: string;
  readonly total_duration_ms: number;
  readonly phases: Record<ReconcilePhase, PhaseOutcome>;
}
