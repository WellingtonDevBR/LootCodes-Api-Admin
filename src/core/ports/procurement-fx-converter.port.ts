/**
 * IProcurementFxConverter — converts an amount in any supported currency to
 * USD cents so cross-vendor offers can be ranked by cost.
 *
 * Implementations read from `public.currency_rates` (USD-anchored). The
 * adapter MUST NOT apply storefront margin — procurement comparison uses raw
 * mid rates.
 *
 * Returns `null` when no active rate exists for the given currency. Callers
 * must skip those offers (we don't guess).
 */
export interface IProcurementFxConverter {
  /**
   * Convert `cents` denominated in `from` currency to USD cents.
   * Returns `null` if the currency cannot be normalized.
   */
  toUsdCents(cents: number, from: string): Promise<number | null>;
}
