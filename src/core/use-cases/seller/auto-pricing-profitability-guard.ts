/** Reads raw `seller_listings.pricing_overrides.bypass_profitability_guard` (strict boolean true). */
export function readsBypassProfitabilityGuard(
  pricingOverrides: Record<string, unknown> | null | undefined,
): boolean {
  return pricingOverrides?.bypass_profitability_guard === true;
}

/** When true, record profitability_no_cost skip (cron stops this listing for this cycle). */
export function shouldSkipForProfitabilityNoCost(input: {
  bypassProfitabilityGuard: boolean;
  hasProfitTarget: boolean;
  effectiveCostCents: number;
  hasManualFloor: boolean;
}): boolean {
  if (!input.hasProfitTarget) return false;
  if (input.bypassProfitabilityGuard) return false;
  return input.effectiveCostCents <= 0 && !input.hasManualFloor;
}

/**
 * When bypass_profitability_guard is on: only provider absolute floor + optional manual listing min.
 * No cost-breakeven or profitability-margin elevation.
 */
export function computeRelaxedEffectiveMinCentsForAutoPricing(
  listing: {
    min_price_mode: string;
    min_price_override_cents: number;
  },
  providerMinFloorCents: number,
): number {
  let floor = Math.max(0, providerMinFloorCents);
  if (listing.min_price_mode === 'manual' && listing.min_price_override_cents > 0) {
    floor = Math.max(floor, listing.min_price_override_cents);
  }
  return floor;
}
