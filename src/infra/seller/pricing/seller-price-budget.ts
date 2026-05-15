/**
 * Seller price-change budget evaluator.
 *
 * Decides whether the current cron tick may push a new price to the
 * marketplace. Combines three sources of truth:
 *
 *   1. The marketplace's live free-quota number (`realQuotaRemaining`) when it
 *      provides one (Eneba's `priceUpdateQuota.quota`). When present this is
 *      authoritative — we never push a "free" change when the marketplace says
 *      zero free slots remain.
 *   2. Our local `seller_listings.provider_metadata.price_change_timestamps`
 *      counter, used as fallback when the marketplace doesn't expose a live
 *      quota and as the paid-slot counter when the free quota is exhausted.
 *   3. The provider-level `auto_price_free_only` flag — the operator's "never
 *      pay a fee" preference. Honored by default; overridden only when the
 *      caller passes `allowPaidWhenBelowFloor: true` (the floor-correction
 *      escape hatch, because never-sell-below-cost is a strictly stronger
 *      invariant than never-pay-a-fee).
 *
 * Pure function; no IO, no DB writes — recording the timestamp lives in
 * {@link ./seller-price-change-quota.ts}.
 */
import type { SellerProviderConfig } from '../../../core/use-cases/seller/seller.types.js';
import { getPriceChangeTimestamps } from './seller-price-change-quota.js';

export interface BudgetResult {
  allowed: boolean;
  isFree: boolean;
  feeCents: number;
}

export interface BudgetInput {
  /** The full provider_metadata blob (we only read `price_change_timestamps`). */
  readonly providerMetadata: Record<string, unknown> | null | undefined;
}

function countRecentChanges(timestamps: readonly string[], windowHours: number): number {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  return timestamps.filter((t) => new Date(t).getTime() > cutoff).length;
}

/**
 * @param realQuotaRemaining  Live `priceUpdateQuota.quota` from Eneba S_stock
 *   — when present, used as the authoritative free-slot count instead of our
 *   local `price_change_timestamps` counter (which drifts on server restarts
 *   and double-counts manual admin pushes that ran while the cron was warming
 *   up its in-memory snapshot).
 * @param options.allowPaidWhenBelowFloor  When `true`, bypass the
 *   `auto_price_free_only` short-circuit and fall through to the paid-slot
 *   check. Set by the orchestrator only when the listing's stored price is
 *   below the cost-basis-derived floor.
 */
export function evaluatePriceChangeBudget(
  listing: BudgetInput,
  config: SellerProviderConfig,
  realQuotaRemaining?: number | null,
  options?: { allowPaidWhenBelowFloor?: boolean },
): BudgetResult {
  const allowPaidWhenBelowFloor = options?.allowPaidWhenBelowFloor === true;

  // Free-tier providers: no fee, unlimited free quota. Always allowed.
  if (config.price_change_fee_cents === 0 || config.price_change_free_quota === -1) {
    return { allowed: true, isFree: true, feeCents: 0 };
  }

  // Authoritative free-quota path: trust the marketplace's own counter.
  if (realQuotaRemaining != null) {
    if (realQuotaRemaining > 0) {
      return { allowed: true, isFree: true, feeCents: 0 };
    }
    if (config.auto_price_free_only && !allowPaidWhenBelowFloor) {
      return { allowed: false, isFree: false, feeCents: 0 };
    }
    const timestamps = getPriceChangeTimestamps(listing.providerMetadata);
    const paidSoFar = Math.max(
      0,
      countRecentChanges(timestamps, config.price_change_window_hours) - config.price_change_free_quota,
    );
    if (config.price_change_max_paid_per_window > 0 && paidSoFar < config.price_change_max_paid_per_window) {
      return { allowed: true, isFree: false, feeCents: config.price_change_fee_cents };
    }
    return { allowed: false, isFree: false, feeCents: 0 };
  }

  // Fallback: timestamp-based counting (providers without a live quota API).
  const timestamps = getPriceChangeTimestamps(listing.providerMetadata);
  const recentChanges = countRecentChanges(timestamps, config.price_change_window_hours);
  if (recentChanges < config.price_change_free_quota) {
    return { allowed: true, isFree: true, feeCents: 0 };
  }

  if (config.auto_price_free_only && !allowPaidWhenBelowFloor) {
    return { allowed: false, isFree: false, feeCents: 0 };
  }

  const paidChangesSoFar = recentChanges - config.price_change_free_quota;
  if (config.price_change_max_paid_per_window > 0 && paidChangesSoFar < config.price_change_max_paid_per_window) {
    return { allowed: true, isFree: false, feeCents: config.price_change_fee_cents };
  }

  return { allowed: false, isFree: false, feeCents: 0 };
}
