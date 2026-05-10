import { describe, expect, it } from 'vitest';
import { applySellerPriceStrategy } from '../src/core/use-cases/seller/apply-seller-price-strategy.js';

describe('applySellerPriceStrategy', () => {
  it('undercuts the lowest competitor by a fixed cent delta', () => {
    expect(
      applySellerPriceStrategy('undercut_fixed', 1, 999, 56),
    ).toBe(55);
  });

  it('falls back to cost when undercut_fixed is set but there is no competitor price', () => {
    expect(
      applySellerPriceStrategy('undercut_fixed', 1, 200, null),
    ).toBe(200);
  });

  describe('smart_compete', () => {
    it('targets P2 − 1 when two competitors exist (gap-exploit: 1 cent below next tier)', () => {
      // floor=1405, P1=1555, P2=1600 → target = max(1405, 1599) = 1599
      expect(
        applySellerPriceStrategy('smart_compete', 0, 1_405, 1_555, 1_600),
      ).toBe(1_599);
    });

    it('targets P1 − 1 when only one competitor exists', () => {
      // floor=1405, P1=1555, no P2 → target = max(1405, 1554) = 1554
      expect(
        applySellerPriceStrategy('smart_compete', 0, 1_405, 1_555),
      ).toBe(1_554);
    });

    it('clamps to floor when P2 − 1 would be below it', () => {
      // floor=1600, P1=1400, P2=1550 → P2-1=1549 < floor → return floor 1600
      expect(
        applySellerPriceStrategy('smart_compete', 0, 1_600, 1_400, 1_550),
      ).toBe(1_600);
    });

    it('falls back to floor when no competitors', () => {
      expect(
        applySellerPriceStrategy('smart_compete', 0, 1_405, null),
      ).toBe(1_405);
    });
  });
});
