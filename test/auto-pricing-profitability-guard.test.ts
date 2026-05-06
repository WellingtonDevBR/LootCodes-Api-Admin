import { describe, expect, it } from 'vitest';
import {
  readsBypassProfitabilityGuard,
  shouldSkipForProfitabilityNoCost,
  computeRelaxedEffectiveMinCentsForAutoPricing,
} from '../src/core/use-cases/seller/auto-pricing-profitability-guard.js';

describe('readsBypassProfitabilityGuard', () => {
  it('is true only when pricing_overrides.bypass_profitability_guard is strictly true', () => {
    expect(readsBypassProfitabilityGuard(null)).toBe(false);
    expect(readsBypassProfitabilityGuard({})).toBe(false);
    expect(readsBypassProfitabilityGuard({ bypass_profitability_guard: false })).toBe(false);
    expect(readsBypassProfitabilityGuard({ bypass_profitability_guard: true })).toBe(true);
  });
});

describe('shouldSkipForProfitabilityNoCost', () => {
  it('skips when profit target, no cost, no manual floor, and bypass off', () => {
    expect(
      shouldSkipForProfitabilityNoCost({
        bypassProfitabilityGuard: false,
        hasProfitTarget: true,
        effectiveCostCents: 0,
        hasManualFloor: false,
      }),
    ).toBe(true);
  });

  it('does not skip when bypass is on with same inputs', () => {
    expect(
      shouldSkipForProfitabilityNoCost({
        bypassProfitabilityGuard: true,
        hasProfitTarget: true,
        effectiveCostCents: 0,
        hasManualFloor: false,
      }),
    ).toBe(false);
  });

  it('does not skip when there is cost', () => {
    expect(
      shouldSkipForProfitabilityNoCost({
        bypassProfitabilityGuard: false,
        hasProfitTarget: true,
        effectiveCostCents: 100,
        hasManualFloor: false,
      }),
    ).toBe(false);
  });
});

describe('computeRelaxedEffectiveMinCentsForAutoPricing', () => {
  it('uses max of provider floor and manual override only', () => {
    expect(
      computeRelaxedEffectiveMinCentsForAutoPricing(
        {
          min_price_mode: 'manual',
          min_price_override_cents: 200,
        },
        50,
      ),
    ).toBe(200);
  });

  it('uses provider floor when auto mode', () => {
    expect(
      computeRelaxedEffectiveMinCentsForAutoPricing(
        {
          min_price_mode: 'auto',
          min_price_override_cents: 0,
        },
        80,
      ),
    ).toBe(80);
  });
});
