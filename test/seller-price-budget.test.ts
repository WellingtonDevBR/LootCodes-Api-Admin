import { describe, it, expect } from 'vitest';
import { evaluatePriceChangeBudget } from '../src/infra/seller/pricing/seller-price-budget.js';
import { SELLER_CONFIG_DEFAULTS, type SellerProviderConfig } from '../src/core/use-cases/seller/seller.types.js';

function eneba(overrides: Partial<SellerProviderConfig> = {}): SellerProviderConfig {
  return {
    ...SELLER_CONFIG_DEFAULTS,
    price_change_free_quota: 10,
    price_change_fee_cents: 50,
    price_change_window_hours: 24,
    price_change_max_paid_per_window: 5,
    auto_price_free_only: true,
    ...overrides,
  };
}

function listingWithTimestamps(timestamps: string[]) {
  return { providerMetadata: { price_change_timestamps: timestamps } };
}

describe('evaluatePriceChangeBudget', () => {
  it('allows unlimited free changes when the provider charges nothing', () => {
    const config = eneba({
      price_change_fee_cents: 0,
      price_change_free_quota: 10,
    });
    const result = evaluatePriceChangeBudget(listingWithTimestamps([]), config);
    expect(result).toEqual({ allowed: true, isFree: true, feeCents: 0 });
  });

  it('trusts the marketplace quota over the local timestamp counter', () => {
    const config = eneba();
    const fortyRecent = Array.from({ length: 40 }, (_, i) => new Date(Date.now() - i * 60_000).toISOString());
    const result = evaluatePriceChangeBudget(listingWithTimestamps(fortyRecent), config, 3);
    expect(result).toEqual({ allowed: true, isFree: true, feeCents: 0 });
  });

  it('blocks free + paid pushes when free quota is exhausted and auto_price_free_only is on', () => {
    const config = eneba();
    const result = evaluatePriceChangeBudget(listingWithTimestamps([]), config, 0);
    expect(result.allowed).toBe(false);
  });

  it('allows a paid push when below cost floor even with auto_price_free_only', () => {
    const config = eneba();
    const result = evaluatePriceChangeBudget(
      listingWithTimestamps([]),
      config,
      0,
      { allowPaidWhenBelowFloor: true },
    );
    expect(result).toEqual({ allowed: true, isFree: false, feeCents: 50 });
  });

  it('blocks paid push when paid budget for the window is exhausted', () => {
    const config = eneba({ price_change_max_paid_per_window: 2 });
    // 10 free quota + 2 paid already used (over 12 timestamps in window)
    const recent = Array.from({ length: 12 }, () => new Date().toISOString());
    const result = evaluatePriceChangeBudget(
      { providerMetadata: { price_change_timestamps: recent } },
      config,
      0,
      { allowPaidWhenBelowFloor: true },
    );
    expect(result.allowed).toBe(false);
  });

  it('falls back to timestamp counting when no real quota is provided', () => {
    const config = eneba({ auto_price_free_only: false });
    const fiveRecent = Array.from({ length: 5 }, () => new Date().toISOString());
    const result = evaluatePriceChangeBudget(listingWithTimestamps(fiveRecent), config);
    expect(result).toEqual({ allowed: true, isFree: true, feeCents: 0 });
  });

  it('ignores timestamps older than the window when counting', () => {
    const config = eneba();
    const oldTs = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const result = evaluatePriceChangeBudget(
      listingWithTimestamps([oldTs, oldTs, oldTs, oldTs, oldTs, oldTs, oldTs, oldTs, oldTs, oldTs, oldTs]),
      config,
    );
    expect(result).toEqual({ allowed: true, isFree: true, feeCents: 0 });
  });
});
