import type { SellerPriceStrategy, SellerProviderConfig } from './seller.types.js';

/**
 * Merges `seller_listings.pricing_overrides` (CRM / Admin API JSON shape) into
 * the resolved provider {@link SellerProviderConfig} used by auto-pricing cron.
 *
 * Canonical keys: `commission_override_percent`, `min_profit_percent`,
 * `price_strategy`, `price_strategy_value`.
 * Legacy keys `commission_rate_percent`, `min_profit_margin_pct` are honored too.
 *
 * `bypass_profitability_guard` is stored on the listing JSON but is **not** folded into
 * {@link SellerProviderConfig}; auto-pricing reads it from raw `pricing_overrides`.
 */
export function mergeSellerListingPricingOverrides(
  baseConfig: SellerProviderConfig,
  pricingOverrides: Record<string, unknown> | null | undefined,
): SellerProviderConfig {
  if (!pricingOverrides || typeof pricingOverrides !== 'object') return baseConfig;
  const ov = pricingOverrides as Record<string, unknown>;
  const merged = { ...baseConfig };

  const commission =
    typeof ov.commission_override_percent === 'number'
      ? ov.commission_override_percent
      : typeof ov.commission_rate_percent === 'number'
        ? ov.commission_rate_percent
        : undefined;
  if (commission !== undefined) merged.commission_rate_percent = commission;

  const minProfit =
    typeof ov.min_profit_percent === 'number'
      ? ov.min_profit_percent
      : typeof ov.min_profit_margin_pct === 'number'
        ? ov.min_profit_margin_pct
        : undefined;
  if (minProfit !== undefined) merged.min_profit_margin_pct = minProfit;

  if (typeof ov.price_strategy === 'string') {
    merged.price_strategy = ov.price_strategy as SellerPriceStrategy;
  }
  if (typeof ov.price_strategy_value === 'number') {
    merged.price_strategy_value = ov.price_strategy_value;
  }

  return merged;
}
