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
});
