/**
 * Seller pricing decision recorder.
 *
 * Owns every write to `seller_pricing_decisions`. The auto-pricing orchestrator
 * emits one decision per listing per tick — `pushed`, `skipped`, or `no_change`
 * — which the admin CRM uses to:
 *
 *   - Surface "why is this listing not updating" without re-running the cron.
 *   - Drive the {@link ../../alerts/supabase-admin-alerts.repository.ts}
 *     `seller_listing_pricing_frozen` observer (latest decision tells us if a
 *     listing is stuck on `budget_exhausted` for too long).
 *
 * Errors are logged and swallowed: a recorder failure must never halt the
 * cron, because the marketplace push has already happened by the time we get
 * here. Sentry forwarding is wired through `createLogger.error`.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type { SellerProviderConfig } from '../../../core/use-cases/seller/seller.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-price-decision-recorder');

export interface PricingDecision {
  seller_listing_id: string;
  action: 'pushed' | 'skipped' | 'no_change';
  reason_code: string;
  reason_detail: string | null;
  price_before_cents: number;
  target_price_cents: number;
  price_after_cents: number | null;
  effective_floor_cents: number;
  competitor_count: number;
  lowest_competitor_cents: number | null;
  our_position_before: number | null;
  our_position_after: number | null;
  estimated_fee_cents: number;
  estimated_payout_cents: number | null;
  config_snapshot: Record<string, unknown>;
  proposed_price_cents: number | null;
  second_lowest_competitor_cents: number | null;
  decision_context: Record<string, unknown>;
}

export function buildConfigSnapshot(config: SellerProviderConfig): Record<string, unknown> {
  return {
    price_strategy: config.price_strategy,
    smart_pricing_enabled: config.smart_pricing_enabled,
    min_change_delta_cents: config.min_change_delta_cents,
    dampening_snapshots: config.dampening_snapshots,
    max_position_target: config.max_position_target,
    position_gap_threshold_pct: config.position_gap_threshold_pct,
    oscillation_threshold: config.oscillation_threshold,
    min_price_floor_cents: config.min_price_floor_cents,
    auto_price_free_only: config.auto_price_free_only,
    min_profit_margin_pct: config.min_profit_margin_pct,
    fixed_fee_cents: config.fixed_fee_cents,
  };
}

@injectable()
export class SellerPriceDecisionRecorder {
  constructor(@inject(TOKENS.Database) private readonly db: IDatabase) {}

  async record(decision: PricingDecision): Promise<void> {
    try {
      await this.db.insert('seller_pricing_decisions', decision as unknown as Record<string, unknown>);
    } catch (err) {
      logger.error('Failed to record pricing decision', err as Error, {
        listingId: decision.seller_listing_id,
        action: decision.action,
      });
    }
  }
}
