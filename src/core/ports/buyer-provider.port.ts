/**
 * IBuyerProvider port — vendor-agnostic interface for buying keys from a
 * supplier (Bamboo, AppRoute, …).
 *
 * The seller-side JIT router and the manual-purchase service depend on this
 * port; concrete adapters live in `src/infra/procurement/buyer/`.
 *
 * Keeps the use-case layer free of vendor-specific quirks like Bamboo's
 * `walletCurrency` or AppRoute's reference-UUID hashing.
 */
import type { ManualProviderPurchaseResult } from '../use-cases/procurement/procurement.types.js';

export interface BuyerOfferQuote {
  readonly unitCostCents: number;
  readonly currency: string;
  readonly availableQuantity: number | null;
}

export type BuyerWalletDeniedReason =
  | 'no_wallet'
  | 'insufficient'
  | 'currency_mismatch'
  | 'unavailable';

export type BuyerWalletCheckResult =
  | { readonly ok: true; readonly walletCurrency: string; readonly spendableCents: number }
  | {
      readonly ok: false;
      readonly reason: BuyerWalletDeniedReason;
      readonly message: string;
      readonly walletCurrency?: string;
      readonly spendableCents?: number;
    };

export interface BuyerPurchaseRequest {
  readonly variantId: string;
  readonly providerAccountId: string;
  readonly offerId: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly adminUserId: string | null;
  readonly attemptSource: 'manual' | 'seller_jit';
  /** Optional pre-known currency hint for adapters that need wallet routing (Bamboo). */
  readonly walletCurrencyHint?: string;
}

export interface IBuyerProvider {
  readonly providerCode: string;
  readonly providerAccountId: string;

  /**
   * Live cost quote (and stock count when available). Adapters may call the
   * vendor API or return a cached snapshot.
   */
  quote(offerId: string, walletCurrencyHint?: string): Promise<BuyerOfferQuote>;

  /**
   * Verify enough wallet headroom to cover `unitCents * quantity` in the
   * offer's native `currency`. Cheap probe — must NEVER place an order.
   */
  walletPreflight(
    unitCents: number,
    quantity: number,
    currency: string,
  ): Promise<BuyerWalletCheckResult>;

  /**
   * Place the buy. Behaves identically for manual and JIT — distinguish via
   * `attemptSource` so the adapter can stamp the right metadata.
   */
  purchase(req: BuyerPurchaseRequest): Promise<ManualProviderPurchaseResult>;
}

/**
 * Resolves a buyer adapter for a given `provider_accounts.id`.
 *
 * Returns `null` when the provider exists but has no buyer adapter (e.g.
 * seller-only marketplaces) or when its credentials are not configured.
 * Callers must handle `null` by skipping that candidate.
 */
export interface IBuyerProviderRegistry {
  resolve(providerAccountId: string): Promise<IBuyerProvider | null>;
}
