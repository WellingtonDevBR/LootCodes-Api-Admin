/**
 * WgcardsBuyerProvider — IBuyerProvider adapter for WGCards.
 *
 * Implements:
 *   quote()          — calls getStock([skuId]) for live availability; unit price
 *                      falls back to the cached offer snapshot supplied at
 *                      construction (WGCards getStock does not return price).
 *   walletPreflight() — calls getAccount() and checks the matching wallet balance.
 *   purchase()       — delegates to BuyerManualPurchaseService.executeJitPurchase
 *                      which orchestrates the full WGCards buy flow (placeOrder +
 *                      getBuyCard + key ingestion) via the JIT purchase path.
 *
 * `offerId` convention:
 *   Stored in `provider_variant_offers.external_offer_id` as the WGCards `skuId`.
 */
import type {
  IBuyerProvider,
  BuyerOfferQuote,
  BuyerWalletCheckResult,
  BuyerPurchaseRequest,
} from '../../../core/ports/buyer-provider.port.js';
import type { ManualProviderPurchaseResult } from '../../../core/use-cases/procurement/procurement.types.js';
import type { WgcardsManualBuyer } from './wgcards-manual-buyer.js';
import type { BuyerManualPurchaseService } from '../buyer-manual-purchase.service.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('wgcards-buyer-provider');

export interface WgcardsOfferSnapshot {
  readonly unitCostCents: number;
  readonly currency: string;
}

export class WgcardsBuyerProvider implements IBuyerProvider {
  readonly providerCode = 'wgcards' as const;

  constructor(
    readonly providerAccountId: string,
    private readonly buyer: WgcardsManualBuyer,
    private readonly service: BuyerManualPurchaseService,
    /**
     * Cached offer snapshots keyed by skuId — used to satisfy `quote()` price
     * without an extra API call (WGCards getStock only returns availability).
     * If a snapshot is absent, `unitCostCents` is reported as 0 and the
     * caller should treat this as an unpriced quote.
     */
    private readonly offerSnapshots: ReadonlyMap<string, WgcardsOfferSnapshot> = new Map(),
  ) {}

  async quote(offerId: string): Promise<BuyerOfferQuote> {
    let availableQuantity: number | null = null;

    try {
      const result = await this.buyer.quote(offerId);
      availableQuantity = result.available_quantity;
    } catch (err) {
      logger.warn('WGCards quote: getStock failed', err instanceof Error ? err : new Error(String(err)), {
        offerId,
        providerAccountId: this.providerAccountId,
      });
      // Fall through — return snapshot price with unknown availability
    }

    const snap = this.offerSnapshots.get(offerId);

    return {
      unitCostCents: snap?.unitCostCents ?? 0,
      currency: snap?.currency ?? 'USD',
      availableQuantity,
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

    const normalized = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      return { ok: false, reason: 'currency_mismatch', message: `Invalid currency: ${currency}` };
    }

    let accountData;
    try {
      accountData = await this.buyer.getAccount();
    } catch (err) {
      logger.warn('WGCards wallet preflight: getAccount failed', err instanceof Error ? err : new Error(String(err)), {
        providerAccountId: this.providerAccountId,
      });
      return { ok: false, reason: 'unavailable', message: 'WGCards wallet lookup failed' };
    }

    const wallet = accountData.accounts.find(
      (w) => w.currency.toUpperCase() === normalized && w.effective,
    );

    if (!wallet) {
      return {
        ok: false,
        reason: 'no_wallet',
        message: `No active WGCards wallet for ${normalized}`,
      };
    }

    // WGCards balance is in native currency units (not cents)
    const balanceCents = Math.round(wallet.balance * 100);

    if (balanceCents < required) {
      return {
        ok: false,
        reason: 'insufficient',
        message: `WGCards ${normalized} balance ${balanceCents}¢ < required ${required}¢`,
        walletCurrency: normalized,
        spendableCents: balanceCents,
      };
    }

    return { ok: true, walletCurrency: normalized, spendableCents: balanceCents };
  }

  async purchase(req: BuyerPurchaseRequest): Promise<ManualProviderPurchaseResult> {
    return this.service.executeJitPurchase({
      variant_id: req.variantId,
      provider_code: 'wgcards',
      provider_account_id: req.providerAccountId,
      offer_id: req.offerId,
      quantity: req.quantity,
      idempotency_key: req.idempotencyKey,
      ...(req.adminUserId ? { admin_user_id: req.adminUserId } : {}),
      ...(req.walletCurrencyHint ? { wallet_currency: req.walletCurrencyHint } : {}),
    });
  }
}
