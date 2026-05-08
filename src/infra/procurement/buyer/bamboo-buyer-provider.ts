/**
 * Bamboo IBuyerProvider adapter — wraps `BambooManualBuyer` for live quotes
 * and wallet preflight, and delegates the actual purchase to
 * `BuyerManualPurchaseService.executeJitPurchase`.
 *
 * Wallet preflight uses Bamboo's live wallet summary (`fetchLiveWalletSummaries`)
 * rather than a separate API call, matching the manual-flow behavior.
 */
import type {
  IBuyerProvider,
  BuyerOfferQuote,
  BuyerWalletCheckResult,
  BuyerPurchaseRequest,
} from '../../../core/ports/buyer-provider.port.js';
import type { ManualProviderPurchaseResult } from '../../../core/use-cases/procurement/procurement.types.js';
import type { BambooManualBuyer } from '../bamboo-manual-buyer.js';
import type { BuyerManualPurchaseService } from '../buyer-manual-purchase.service.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('bamboo-buyer-provider');

export class BambooBuyerProvider implements IBuyerProvider {
  readonly providerCode = 'bamboo' as const;

  constructor(
    readonly providerAccountId: string,
    private readonly buyer: BambooManualBuyer,
    private readonly service: BuyerManualPurchaseService,
  ) {}

  async quote(offerId: string, walletCurrencyHint?: string): Promise<BuyerOfferQuote> {
    const wc =
      typeof walletCurrencyHint === 'string' && /^[A-Za-z]{3}$/.test(walletCurrencyHint.trim())
        ? walletCurrencyHint.trim().toUpperCase()
        : 'USD';
    const q = await this.buyer.quote(offerId, wc);
    return {
      unitCostCents: q.price_cents,
      currency: q.currency,
      availableQuantity: q.available_quantity,
    };
  }

  async walletPreflight(
    unitCents: number,
    quantity: number,
    currency: string,
  ): Promise<BuyerWalletCheckResult> {
    const wc = normalizeIso(currency);
    if (!wc) {
      return { ok: false, reason: 'currency_mismatch', message: `Invalid currency: ${currency}` };
    }
    const required = unitCents * quantity;
    if (!Number.isFinite(required) || required <= 0) {
      return { ok: false, reason: 'unavailable', message: 'Cannot compute required spend' };
    }

    let wallets: ReadonlyArray<{ id: number; currency: string; balance: number }>;
    try {
      wallets = await this.buyer.fetchLiveWalletSummaries();
    } catch (err) {
      logger.warn('Bamboo wallet preflight: live wallet fetch failed', {
        providerAccountId: this.providerAccountId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, reason: 'unavailable', message: 'Bamboo wallet lookup failed' };
    }

    const match = wallets.find((w) => w.currency.toUpperCase() === wc);
    if (!match) {
      return {
        ok: false,
        reason: 'currency_mismatch',
        message: `No Bamboo wallet for ${wc}`,
      };
    }

    const balanceCents = Math.round((match.balance ?? 0) * 100);
    if (balanceCents < required) {
      return {
        ok: false,
        reason: 'insufficient',
        message: `Bamboo ${wc} balance ${balanceCents}¢ < required ${required}¢`,
        walletCurrency: wc,
        spendableCents: balanceCents,
      };
    }

    return { ok: true, walletCurrency: wc, spendableCents: balanceCents };
  }

  async purchase(req: BuyerPurchaseRequest): Promise<ManualProviderPurchaseResult> {
    return this.service.executeJitPurchase({
      variant_id: req.variantId,
      provider_code: 'bamboo',
      provider_account_id: req.providerAccountId,
      offer_id: req.offerId,
      quantity: req.quantity,
      idempotency_key: req.idempotencyKey,
      ...(req.adminUserId ? { admin_user_id: req.adminUserId } : {}),
      ...(req.walletCurrencyHint ? { wallet_currency: req.walletCurrencyHint } : {}),
    });
  }
}

function normalizeIso(input: string): string | null {
  if (typeof input !== 'string') return null;
  const t = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : null;
}
