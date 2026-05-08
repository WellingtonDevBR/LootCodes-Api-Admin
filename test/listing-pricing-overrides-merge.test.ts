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

  // Fixed-fee override tests — see docs/05-coding-standards.md §11 (Primitive Obsession):
  // value is cents in the LISTING currency, same unit as `seller_config.fixed_fee_cents`.
  it('maps fixed_fee_override_cents into fixed_fee_cents', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, fixed_fee_cents: 0 };
    const merged = mergeSellerListingPricingOverrides(base, { fixed_fee_override_cents: 25 });
    expect(merged.fixed_fee_cents).toBe(25);
  });

  it('overrides a non-zero provider fixed fee per listing', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, fixed_fee_cents: 25 };
    const merged = mergeSellerListingPricingOverrides(base, { fixed_fee_override_cents: 50 });
    expect(merged.fixed_fee_cents).toBe(50);
  });

  it('preserves provider fixed fee when override is absent', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, fixed_fee_cents: 25 };
    const merged = mergeSellerListingPricingOverrides(base, { commission_override_percent: 6 });
    expect(merged.fixed_fee_cents).toBe(25);
  });

  it('rejects non-numeric fixed_fee_override_cents', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, fixed_fee_cents: 25 };
    const merged = mergeSellerListingPricingOverrides(base, { fixed_fee_override_cents: 'oops' });
    expect(merged.fixed_fee_cents).toBe(25);
  });

  it('rejects negative fixed_fee_override_cents', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, fixed_fee_cents: 25 };
    const merged = mergeSellerListingPricingOverrides(base, { fixed_fee_override_cents: -10 });
    expect(merged.fixed_fee_cents).toBe(25);
  });

  it('accepts an explicit zero override (admin choosing to wipe the provider fee)', () => {
    const base = { ...SELLER_CONFIG_DEFAULTS, fixed_fee_cents: 25 };
    const merged = mergeSellerListingPricingOverrides(base, { fixed_fee_override_cents: 0 });
    expect(merged.fixed_fee_cents).toBe(0);
  });
});
