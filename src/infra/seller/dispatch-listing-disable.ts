/**
 * Per-marketplace "stop selling" dispatcher.
 *
 * Different marketplaces use different APIs to express "do not accept new
 * orders right now". This helper centralizes the mapping; see
 * `docs/declared-stock-disable.md` for the canonical matrix and
 * justification.
 *
 * Most adapters' `declareStock(id, 0)` already encodes the right semantics
 * (Eneba `declaredStock: null`, G2A `active: false`, Gamivo `INACTIVE`,
 * Digiseller `disabled`). Kinguin is the exception: `declareStock(id, 0)`
 * sets `declaredStock: 0` but leaves the offer `ACTIVE` — we must call
 * `deactivateListing` to get `status: INACTIVE`.
 */
import type {
  IMarketplaceAdapterRegistry,
  ISellerDeclaredStockAdapter,
  ISellerListingAdapter,
} from '../../core/ports/marketplace-adapter.port.js';

export interface DispatchDisableResult {
  readonly success: boolean;
  /** What the helper actually called, for logging / tests. */
  readonly action: 'deactivate_listing' | 'declare_stock_zero';
  readonly error?: string;
}

/**
 * Push the right "no sale" signal for `providerCode`.
 *
 * Returns success=true when the marketplace acknowledged the call; the
 * caller is responsible for persisting the listing's `error_message`
 * regardless. Throws are bubbled to the caller's try/catch.
 */
export async function dispatchListingDisable(
  registry: IMarketplaceAdapterRegistry,
  providerCode: string,
  externalListingId: string,
): Promise<DispatchDisableResult> {
  const code = providerCode.trim().toLowerCase();

  if (code === 'kinguin') {
    const listingAdapter: ISellerListingAdapter | null = registry.getListingAdapter(code);
    if (!listingAdapter || typeof listingAdapter.deactivateListing !== 'function') {
      return {
        success: false,
        action: 'deactivate_listing',
        error: 'Kinguin listing adapter not available',
      };
    }
    const r = await listingAdapter.deactivateListing(externalListingId);
    return { success: r.success === true, action: 'deactivate_listing' };
  }

  // All other marketplaces: their declareStock(0) already maps to the
  // right "stop selling" call. See docs/declared-stock-disable.md.
  const declaredStockAdapter: ISellerDeclaredStockAdapter | null =
    registry.getDeclaredStockAdapter(code);
  if (!declaredStockAdapter) {
    return {
      success: false,
      action: 'declare_stock_zero',
      error: `No declared-stock adapter for provider ${code}`,
    };
  }
  const r = await declaredStockAdapter.declareStock(externalListingId, 0);
  return {
    success: r.success === true,
    action: 'declare_stock_zero',
    ...(r.error ? { error: r.error } : {}),
  };
}
