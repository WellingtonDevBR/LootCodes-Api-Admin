import { describe, expect, it } from 'vitest';
import { resolveProfitabilityFloorCentsForAutoPricing } from '../src/infra/seller/pricing/auto-pricing-floor-resolution.js';

describe('resolveProfitabilityFloorCentsForAutoPricing', () => {
  it('returns null when bypass is on', () => {
    expect(
      resolveProfitabilityFloorCentsForAutoPricing({
        bypassProfitabilityGuard: true,
        hasProfitTarget: true,
        effectiveCostCents: 500,
        commissionRatePercent: 10,
        minProfitMarginPct: 5,
        fixedFeeCents: 0,
        isNetPricingModel: false,
      }),
    ).toBeNull();
  });

  it('computes floor when bypass off and cost positive', () => {
    const v = resolveProfitabilityFloorCentsForAutoPricing({
      bypassProfitabilityGuard: false,
      hasProfitTarget: true,
      effectiveCostCents: 1000,
      commissionRatePercent: 10,
      minProfitMarginPct: 10,
      fixedFeeCents: 0,
      isNetPricingModel: false,
    });
    expect(v).not.toBeNull();
    expect(typeof v).toBe('number');
    expect(v! >= 1000).toBe(true);
  });
});
