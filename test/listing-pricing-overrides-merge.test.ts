import { describe, expect, it } from 'vitest';
import { mergeSellerListingPricingOverrides } from '../src/core/use-cases/seller/listing-pricing-overrides-merge.js';
import { SELLER_CONFIG_DEFAULTS } from '../src/core/use-cases/seller/seller.types.js';

describe('mergeSellerListingPricingOverrides', () => {
  it('returns base config when overrides are null', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, commission_rate_percent: 12 };
    expect(mergeSellerListingPricingOverrides(base, null)).toEqual(base);
  });

  it('maps commission_override_percent into commission_rate_percent', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, commission_rate_percent: 5 };
    const merged = mergeSellerListingPricingOverrides(base, { commission_override_percent: 18 });
    expect(merged.commission_rate_percent).toBe(18);
    expect(merged.price_strategy).toBe(base.price_strategy);
  });

  it('still accepts legacy commission_rate_percent on overrides', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, commission_rate_percent: 5 };
    const merged = mergeSellerListingPricingOverrides(base, { commission_rate_percent: 9 });
    expect(merged.commission_rate_percent).toBe(9);
  });

  it('prefers commission_override_percent over legacy commission_rate_percent', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, commission_rate_percent: 5 };
    const merged = mergeSellerListingPricingOverrides(base, {
      commission_override_percent: 20,
      commission_rate_percent: 9,
    });
    expect(merged.commission_rate_percent).toBe(20);
  });

  it('maps min_profit_percent into min_profit_margin_pct', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, min_profit_margin_pct: 0 };
    const merged = mergeSellerListingPricingOverrides(base, { min_profit_percent: 11 });
    expect(merged.min_profit_margin_pct).toBe(11);
  });

  it('maps listing undercut_fixed strategy', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, price_strategy: 'smart_compete', price_strategy_value: 0 };
    const merged = mergeSellerListingPricingOverrides(base, {
      price_strategy: 'undercut_fixed',
      price_strategy_value: 1,
    });
    expect(merged.price_strategy).toBe('undercut_fixed');
    expect(merged.price_strategy_value).toBe(1);
  });

  it('maps listing price_strategy and price_strategy_value', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, price_strategy: 'fixed', price_strategy_value: 0 };
    const merged = mergeSellerListingPricingOverrides(base, {
      price_strategy: 'undercut_percent',
      price_strategy_value: 3,
    });
    expect(merged.price_strategy).toBe('undercut_percent');
    expect(merged.price_strategy_value).toBe(3);
  });
});
