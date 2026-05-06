import { computeProfitabilityFloorCents } from './seller-pricing-math.js';

export function resolveProfitabilityFloorCentsForAutoPricing(input: {
  bypassProfitabilityGuard: boolean;
  hasProfitTarget: boolean;
  effectiveCostCents: number;
  commissionRatePercent: number;
  minProfitMarginPct: number;
  fixedFeeCents: number;
  isNetPricingModel: boolean;
}): number | null {
  if (!input.hasProfitTarget) return null;
  if (input.bypassProfitabilityGuard) return null;
  if (input.effectiveCostCents <= 0) return null;
  return computeProfitabilityFloorCents(
    input.effectiveCostCents,
    input.isNetPricingModel ? 0 : input.commissionRatePercent,
    input.minProfitMarginPct,
    input.isNetPricingModel ? 0 : input.fixedFeeCents,
  );
}
