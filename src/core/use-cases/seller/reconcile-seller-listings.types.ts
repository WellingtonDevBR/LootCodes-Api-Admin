/**
 * Input/output shapes for ReconcileSellerListingsUseCase — the single
 * orchestrated cron entry point for seller-side maintenance.
 */
import type { FulfillmentMode } from '../../ports/platform-settings.port.js';

export const RECONCILE_PHASES = [
  'expire-reservations',
  'cost-basis',
  'pricing',
  'declared-stock',
  'remote-stock',
] as const;

export type ReconcilePhase = (typeof RECONCILE_PHASES)[number];

export interface ReconcileSellerListingsDto {
  /** Optional UUID filter; honoured by `declared-stock` phase only (other phases sweep all auto-sync listings). */
  readonly variant_ids?: readonly string[];
  /** Hard cap forwarded to the `declared-stock` phase. */
  readonly batch_limit?: number;
  /** When true, `declared-stock` simulates without pushing to marketplaces. Other phases ignore this flag. */
  readonly dry_run?: boolean;
  /** Optional whitelist; if omitted all five phases run in canonical order. */
  readonly phases?: readonly ReconcilePhase[];
}

export type SkipReason = 'global_hold' | 'phase_filter';

export interface PhaseOutcome<T = unknown> {
  readonly ran: boolean;
  readonly skipped_reason?: SkipReason;
  readonly result?: T;
  readonly error?: string;
  readonly duration_ms: number;
}

export interface ReconcileSellerListingsResult {
  readonly request_id: string;
  readonly fulfillment_mode: FulfillmentMode;
  readonly total_duration_ms: number;
  readonly phases: Record<ReconcilePhase, PhaseOutcome>;
}
