/**
 * RouteAndPurchaseJitOffersUseCase
 *
 * Replaces the legacy Bamboo-only JIT path. Loads buyer-capable provider
 * offers for a variant, normalizes to USD, applies profitability + stock
 * gates, then purchases from the cheapest viable provider whose wallet
 * has credit.
 *
 * Pure use case — no Supabase, no fetch, no env reads. All side-effects
 * go through ports.
 */
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS } from '../../../di/tokens.js';
import type { IBuyerProviderRegistry } from '../../ports/buyer-provider.port.js';
import type { IProcurementFxConverter } from '../../ports/procurement-fx-converter.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('route-and-purchase-jit');

export interface JitCandidateOffer {
  readonly id: string;
  readonly provider_code: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string;
  readonly currency: string;
  readonly last_price_cents: number | null;
  readonly available_quantity: number | null;
  readonly prioritize_quote_sync: boolean;
}

export interface IJitOfferRepository {
  /**
   * Returns active linked offers for a variant filtered to buyer-capable
   * providers (i.e. `provider_accounts.is_enabled = true AND
   * supports_seller = false`). Sellers like Eneba/Kinguin are excluded.
   */
  findBuyerCapableOffersForVariant(variantId: string): Promise<JitCandidateOffer[]>;
}

export interface RouteAndPurchaseJitOffersInput {
  readonly variantId: string;
  readonly quantity: number;
  readonly externalReservationId: string;
  readonly adminUserId: string | null;

  /**
   * Pre-normalized to USD by the caller. The use case does not normalize
   * the sale side because that requires marketplace-specific context
   * (Eneba auction price currency).
   */
  readonly salePriceUsdCents?: number;
  readonly minMarginUsdCents?: number;
  readonly feesUsdCents?: number;
}

export interface AttemptedProviderEntry {
  readonly providerCode: string;
  readonly providerAccountId: string;
  readonly reason: string;
}

export interface RouteAndPurchaseJitOffersResult {
  readonly purchased: boolean;
  readonly winningProviderCode?: string;
  readonly winningProviderAccountId?: string;
  readonly ingestedKeyCount: number;
  readonly attemptedProviders: ReadonlyArray<AttemptedProviderEntry>;
}

interface RankedCandidate {
  readonly offer: JitCandidateOffer;
  readonly usdUnitCostCents: number;
}

@injectable()
export class RouteAndPurchaseJitOffersUseCase {
  constructor(
    @inject(TOKENS.JitOfferRepository) private readonly offers: IJitOfferRepository,
    @inject(TOKENS.BuyerProviderRegistry) private readonly registry: IBuyerProviderRegistry,
    @inject(TOKENS.ProcurementFxConverter) private readonly fx: IProcurementFxConverter,
  ) {}

  async execute(input: RouteAndPurchaseJitOffersInput): Promise<RouteAndPurchaseJitOffersResult> {
    const { variantId, quantity } = input;
    const attempted: AttemptedProviderEntry[] = [];

    if (!Number.isFinite(quantity) || quantity < 1) {
      return { purchased: false, ingestedKeyCount: 0, attemptedProviders: attempted };
    }

    const rawOffers = await this.offers.findBuyerCapableOffersForVariant(variantId);
    if (rawOffers.length === 0) {
      logger.info('JIT route: no buyer-capable offers', { variantId });
      return { purchased: false, ingestedKeyCount: 0, attemptedProviders: attempted };
    }

    const ranked = await this.rankCandidates(rawOffers, input, attempted);
    if (ranked.length === 0) {
      return { purchased: false, ingestedKeyCount: 0, attemptedProviders: attempted };
    }

    for (const candidate of ranked) {
      const adapter = await this.registry.resolve(candidate.offer.provider_account_id);
      if (!adapter) {
        attempted.push({
          providerCode: candidate.offer.provider_code,
          providerAccountId: candidate.offer.provider_account_id,
          reason: 'no_buyer_adapter',
        });
        continue;
      }

      const wallet = await adapter.walletPreflight(
        candidate.offer.last_price_cents ?? 0,
        quantity,
        candidate.offer.currency,
      );
      if (!wallet.ok) {
        attempted.push({
          providerCode: candidate.offer.provider_code,
          providerAccountId: candidate.offer.provider_account_id,
          reason: `wallet_${wallet.reason}`,
        });
        logger.info('JIT route: wallet preflight failed', {
          providerCode: candidate.offer.provider_code,
          reason: wallet.reason,
        });
        continue;
      }

      const idempotencyKey =
        `jit-${variantId}-${input.externalReservationId}-${candidate.offer.id}-${randomUUID()}`;

      const result = await adapter.purchase({
        variantId,
        providerAccountId: candidate.offer.provider_account_id,
        offerId: candidate.offer.external_offer_id,
        quantity,
        idempotencyKey,
        adminUserId: input.adminUserId,
        attemptSource: 'seller_jit',
        walletCurrencyHint: candidate.offer.currency,
      });

      const ingested = result.keys_ingested ?? 0;
      if (result.success && ingested > 0) {
        logger.info('JIT route: purchase succeeded', {
          providerCode: candidate.offer.provider_code,
          variantId,
          ingested,
        });
        return {
          purchased: true,
          winningProviderCode: candidate.offer.provider_code,
          winningProviderAccountId: candidate.offer.provider_account_id,
          ingestedKeyCount: ingested,
          attemptedProviders: attempted,
        };
      }

      attempted.push({
        providerCode: candidate.offer.provider_code,
        providerAccountId: candidate.offer.provider_account_id,
        reason: result.error ?? 'purchase_failed',
      });
      logger.warn('JIT route: purchase did not yield ingested keys', {
        providerCode: candidate.offer.provider_code,
        error: result.error,
      });
    }

    return { purchased: false, ingestedKeyCount: 0, attemptedProviders: attempted };
  }

  private async rankCandidates(
    rawOffers: readonly JitCandidateOffer[],
    input: RouteAndPurchaseJitOffersInput,
    attempted: AttemptedProviderEntry[],
  ): Promise<RankedCandidate[]> {
    const maxUsdCents = computeMaxUsdUnitCost(input);
    const ranked: RankedCandidate[] = [];

    for (const offer of rawOffers) {
      const skip = (reason: string) => {
        attempted.push({
          providerCode: offer.provider_code,
          providerAccountId: offer.provider_account_id,
          reason,
        });
      };

      if (offer.last_price_cents == null || offer.last_price_cents <= 0) {
        skip('no_price');
        continue;
      }

      if (
        offer.available_quantity != null
        && Number.isFinite(offer.available_quantity)
        && offer.available_quantity < input.quantity
      ) {
        skip('insufficient_stock');
        continue;
      }

      const usdUnit = await this.fx.toUsdCents(offer.last_price_cents, offer.currency);
      if (usdUnit == null || !Number.isFinite(usdUnit) || usdUnit <= 0) {
        skip('fx_unsupported');
        continue;
      }

      if (maxUsdCents != null && usdUnit > maxUsdCents) {
        skip('above_margin_gate');
        continue;
      }

      ranked.push({ offer, usdUnitCostCents: usdUnit });
    }

    ranked.sort((a, b) => {
      if (a.usdUnitCostCents !== b.usdUnitCostCents) {
        return a.usdUnitCostCents - b.usdUnitCostCents;
      }
      const ap = a.offer.prioritize_quote_sync ? 1 : 0;
      const bp = b.offer.prioritize_quote_sync ? 1 : 0;
      return bp - ap;
    });

    return ranked;
  }
}

function computeMaxUsdUnitCost(input: RouteAndPurchaseJitOffersInput): number | null {
  const sale = input.salePriceUsdCents;
  if (typeof sale !== 'number' || !Number.isFinite(sale)) return null;
  const margin =
    typeof input.minMarginUsdCents === 'number' && Number.isFinite(input.minMarginUsdCents)
      ? input.minMarginUsdCents
      : 0;
  const fees =
    typeof input.feesUsdCents === 'number' && Number.isFinite(input.feesUsdCents)
      ? input.feesUsdCents
      : 0;
  const max = sale - margin - fees;
  return Number.isFinite(max) ? max : null;
}
