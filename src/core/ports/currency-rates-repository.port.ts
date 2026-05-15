/**
 * Read access to the `currency_rates` table.
 *
 * Used by every admin route that converts cents between currencies for display
 * (orders, inventory, pricing, analytics). The implementation owns its own
 * TTL cache so callers never have to think about cache lifecycle — and so
 * routes don't need to resolve `IDatabase` just to convert a number.
 */
export type RateMap = Map<string, number>;

export interface ICurrencyRatesRepository {
  /**
   * Returns a sparse map of `"FROM->TO"` → rate from `currency_rates`. Cached
   * with a short TTL; admin writes propagate within the TTL window.
   */
  getActiveRates(): Promise<RateMap>;

  /** Force the cache to refresh on the next call. */
  invalidate(): void;
}
