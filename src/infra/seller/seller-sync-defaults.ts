import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { ISellerProviderConfigRepository } from '../../core/ports/seller-provider-config-repository.port.js';
import { SELLER_CONFIG_DEFAULTS } from '../../core/use-cases/seller/seller.types.js';

/**
 * Resolves the `auto_sync_stock` / `auto_sync_price` flags for a new or
 * relinked `seller_listings` row.
 *
 * Order of precedence (caller wins):
 *   1. Explicit DTO value (`dto.auto_sync_*`).
 *   2. `provider_accounts.seller_config.auto_sync_*_default`.
 *   3. {@link SELLER_CONFIG_DEFAULTS} when `seller_config` is missing or malformed.
 *
 * Single source of truth used by
 * `SupabaseAdminProcurementRepository.linkCatalogProduct` and
 * `SupabaseAdminSellerRepository.createSellerListing`. Replaces the historical
 * hardcoded `false` fallbacks that silently ignored `seller_config`.
 *
 * Reads route through {@link ISellerProviderConfigRepository} so the result is
 * memoized across the request lifecycle (admin double-clicks on "Link product"
 * don't issue two `provider_accounts` SELECTs).
 */
export async function resolveSellerSyncDefaults(
  providerAccountId: string,
  dto: { auto_sync_stock?: boolean; auto_sync_price?: boolean },
): Promise<{ auto_sync_stock: boolean; auto_sync_price: boolean }> {
  const repo = container.resolve<ISellerProviderConfigRepository>(TOKENS.SellerProviderConfigRepository);
  const config = (await repo.getByAccountId(providerAccountId)) ?? SELLER_CONFIG_DEFAULTS;

  return {
    auto_sync_stock: dto.auto_sync_stock ?? config.auto_sync_stock_default,
    auto_sync_price: dto.auto_sync_price ?? config.auto_sync_price_default,
  };
}
