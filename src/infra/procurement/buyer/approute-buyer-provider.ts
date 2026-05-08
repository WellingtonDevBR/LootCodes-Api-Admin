/**
 * AppRoute IBuyerProvider adapter — wraps `AppRouteManualBuyer` for wallet
 * preflight, and delegates the purchase to `BuyerManualPurchaseService.executeJitPurchase`.
 *
 * AppRoute's catalog endpoint does not expose a cheap "live single-product
 * quote" the way Bamboo's does, so `quote()` reflects the cached snapshot
 * supplied by the registry. The router only uses this for tie-breaking and
 * cost ranking; live cost confirmation happens server-side at order time.
 */
import type {
  IBuyerProvider,
  BuyerOfferQuote,
  BuyerWalletCheckResult,
  BuyerPurchaseRequest,
} from '../../../core/ports/buyer-provider.port.js';
import type { ManualProviderPurchaseResult } from '../../../core/use-cases/procurement/procurement.types.js';
import type { AppRouteManualBuyer } from '../approute-manual-buyer.js';
import type { BuyerManualPurchaseService } from '../buyer-manual-purchase.service.js';

export interface AppRouteOfferSnapshot {
  readonly unitCostCents: number;
  readonly currency: string;
  readonly availableQuantity: number | null;
}

export class AppRouteBuyerProvider implements IBuyerProvider {
  readonly providerCode = 'approute' as const;

  constructor(
    readonly providerAccountId: string,
    private readonly buyer: AppRouteManualBuyer,
    private readonly service: BuyerManualPurchaseService,
    /**
     * Per-offer snapshot from `provider_variant_offers` — keyed by external offer id.
     * Used to satisfy `quote()` without an extra API call.
     */
    private readonly offerSnapshots: ReadonlyMap<string, AppRouteOfferSnapshot> = new Map(),
  ) {}

  async quote(offerId: string): Promise<BuyerOfferQuote> {
    const snap = this.offerSnapshots.get(offerId);
    if (!snap) {
      throw new Error(`AppRoute quote unavailable for offer ${offerId} — no cached snapshot`);
    }
    return {
      unitCostCents: snap.unitCostCents,
      currency: snap.currency,
      availableQuantity: snap.availableQuantity,
    };
  }

  async walletPreflight(
    unitCents: number,
    quantity: number,
    currency: string,
  ): Promise<BuyerWalletCheckResult> {
    const required = unitCents * quantity;
    if (!Number.isFinite(required) || required <= 0) {
      return { ok: false, reason: 'unavailable', message: 'Cannot compute required spend' };
    }

    const result = await this.buyer.preflightSufficientBalance(required, currency);
    if (result.ok) {
      return { ok: true, walletCurrency: currency.toUpperCase(), spendableCents: required };
    }
    const reason = mapAppRouteWalletError(result.error);
    return { ok: false, reason, message: result.error };
  }

  async purchase(req: BuyerPurchaseRequest): Promise<ManualProviderPurchaseResult> {
    return this.service.executeJitPurchase({
      variant_id: req.variantId,
      provider_code: 'approute',
      provider_account_id: req.providerAccountId,
      offer_id: req.offerId,
      quantity: req.quantity,
      idempotency_key: req.idempotencyKey,
      ...(req.adminUserId ? { admin_user_id: req.adminUserId } : {}),
      ...(req.walletCurrencyHint ? { wallet_currency: req.walletCurrencyHint } : {}),
    });
  }
}

function mapAppRouteWalletError(msg: string): 'no_wallet' | 'insufficient' | 'currency_mismatch' | 'unavailable' {
  const t = msg.toLowerCase();
  if (t.includes('no balance row')) return 'no_wallet';
  if (t.includes('insufficient')) return 'insufficient';
  if (t.includes('invalid settlement currency')) return 'currency_mismatch';
  return 'unavailable';
}
