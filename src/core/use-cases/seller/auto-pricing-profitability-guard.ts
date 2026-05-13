/** Reads raw `seller_listings.pricing_overrides.bypass_profitability_guard` (strict boolean true). */
export function readsBypassProfitabilityGuard(
  pricingOverrides: Record<string, unknown> | null | undefined,
): boolean {
  return pricingOverrides?.bypass_profitability_guard === true;
}

/**
 * Reads `bypass_floor_pct` from pricing_overrides.
 *
 * Even when bypass_profitability_guard is on, this percentage of cost_basis_cents
 * acts as a hard floor to prevent the pricing cron from following a manipulated
 * (artificially low) competitor price into a deep loss.
 *
 * Default: 50 (never price below 50 % of our cost basis).
 * Set to 0 in pricing_overrides to remove the floor entirely.
 */
export const BYPASS_FLOOR_PCT_DEFAULT = 50;

export function readsBypassFloorPct(
  pricingOverrides: Record<string, unknown> | null | undefined,
): number {
  const raw = pricingOverrides?.bypass_floor_pct;
  if (typeof raw === 'number' && raw >= 0 && raw <= 100) return raw;
  return BYPASS_FLOOR_PCT_DEFAULT;
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
 * When bypass_profitability_guard is on: provider absolute floor + optional manual listing min
 * + a safety floor of `bypassFloorPct`% of cost to prevent runaway price drops.
 *
 * No full cost-breakeven or profitability-margin elevation is applied.
 */
export function computeRelaxedEffectiveMinCentsForAutoPricing(
  listing: {
    min_price_mode: string;
    min_price_override_cents: number;
  },
  providerMinFloorCents: number,
  costCents: number,
  bypassFloorPct: number,
): number {
  let floor = Math.max(0, providerMinFloorCents);

  if (listing.min_price_mode === 'manual' && listing.min_price_override_cents > 0) {
    floor = Math.max(floor, listing.min_price_override_cents);
  }

  // Safety floor: never follow competitors below X% of our cost basis.
  if (bypassFloorPct > 0 && costCents > 0) {
    const safetyFloor = Math.ceil(costCents * bypassFloorPct / 100);
    floor = Math.max(floor, safetyFloor);
  }

  return floor;
}
