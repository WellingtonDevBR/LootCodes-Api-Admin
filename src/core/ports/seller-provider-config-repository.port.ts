import type { SellerProviderConfig } from '../use-cases/seller/seller.types.js';

/**
 * Read-only access to `provider_accounts.seller_config` parsed into the typed
 * domain shape ({@link SellerProviderConfig}).
 *
 * Historically every caller (auto-pricing, declared-stock reconcile, sync
 * defaults, route handlers, webhook auth, etc.) issued its own
 * `provider_accounts` SELECT to pull `seller_config`, then called
 * `parseSellerConfig` inline. That meant three to five duplicate reads per
 * cron tick, plus inconsistent defaulting when the JSONB column was malformed.
 *
 * This port consolidates the read path. The implementation MAY memoize for the
 * lifetime of a single cron run / request to avoid the duplicate IO; callers
 * that need fresh data after an admin write must call {@link invalidate}.
 */
export interface ISellerProviderConfigRepository {
  /** Look up a parsed seller config by `provider_accounts.id`. */
  getByAccountId(accountId: string): Promise<SellerProviderConfig | null>;

  /**
   * Look up by `provider_accounts.provider_code` (e.g. `'eneba'`). Returns the
   * first matching account; callers that need to disambiguate when multiple
   * accounts share a provider_code (test/live duplicates) must resolve by id.
   */
  getByProviderCode(providerCode: string): Promise<SellerProviderConfig | null>;

  /**
   * Drop the cached entry for an account/provider_code. Must be called after
   * any write to `provider_accounts.seller_config` so the next read picks up
   * the new value.
   */
  invalidate(keyOrAccountId: string): void;

  /** Empty the whole cache (used by tests and on long-lived process restarts). */
  clear(): void;
}
