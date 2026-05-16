import type { SellerPriceStrategy, SellerProviderConfig } from './seller.types.js';

/**
 * Merges `seller_listings.pricing_overrides` (CRM / Admin API JSON shape) into
 * the resolved provider {@link SellerProviderConfig} used by auto-pricing cron.
 *
 * Canonical keys: `commission_override_percent`, `min_profit_percent`,
 * `fixed_fee_override_cents`, `price_strategy`, `price_strategy_value`.
 * Legacy keys `commission_rate_percent`, `min_profit_margin_pct` are honored too.
 *
 * `fixed_fee_override_cents` is the per-sale flat fee charged by the marketplace
 * for THIS specific product, expressed in the listing's currency (e.g. €0.25 →
 * `25` for an EUR listing). Per-product because marketplaces like Eneba and
 * Kinguin charge category-specific or game-specific flat fees that the global
 * `seller_config.fixed_fee_cents` cannot capture.
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

  if (
    typeof ov.fixed_fee_override_cents === 'number'
    && Number.isFinite(ov.fixed_fee_override_cents)
    && ov.fixed_fee_override_cents >= 0
  ) {
    merged.fixed_fee_cents = ov.fixed_fee_override_cents;
  }

  if (typeof ov.price_strategy === 'string') {
    merged.price_strategy = ov.price_strategy as SellerPriceStrategy;
  }
  if (typeof ov.price_strategy_value === 'number') {
    merged.price_strategy_value = ov.price_strategy_value;
  }

  // excluded_p1_merchants is additive: listing entries are appended to
  // account-level entries so both sets are respected.
  if (Array.isArray(ov.excluded_p1_merchants)) {
    const extra = (ov.excluded_p1_merchants as unknown[]).filter(
      (v): v is string => typeof v === 'string',
    );
    if (extra.length > 0) {
      merged.excluded_p1_merchants = [...(baseConfig.excluded_p1_merchants ?? []), ...extra];
    }
  }

  return merged;
}
