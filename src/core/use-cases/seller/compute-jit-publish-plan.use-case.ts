/**
 * ComputeJitPublishPlanUseCase
 *
 * When a seller listing has zero on-hand keys but has linked buyer offers,
 * compute a JIT publish plan: pick the cheapest buyer that has wallet
 * credits, size the auction's declared stock from the buyer's reported
 * `available_quantity` (defaulting to {@link DEFAULT_DECLARED_STOCK_WHEN_UNKNOWN}
 * when the buyer doesn't report it), and ask the seller pricing service for
 * the marketplace price using the buyer's unit cost — converted to the
 * listing currency — as the procurement cost basis.
 *
 * Pure use case — depends only on ports. No vendor SDK, no Supabase, no env.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IBuyerProviderRegistry } from '../../ports/buyer-provider.port.js';
import type { IProcurementFxConverter } from '../../ports/procurement-fx-converter.port.js';
import type {
  ISellerPricingService,
  PriceSuggestionResult,
} from '../../ports/seller-pricing.port.js';
import type { SellerListingType } from './seller.types.js';
import type {
  IJitOfferRepository,
  JitCandidateOffer,
} from '../procurement/route-and-purchase-jit-offers.use-case.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('compute-jit-publish-plan');

/**
 * Marketplaces (Eneba) require a non-zero declared stock at create time but
 * many buyer offers don't expose a quantity hint. Default to a small batch
 * so admins can publish; subsequent stock syncs reconcile to the real
 * available count.
 */
export const DEFAULT_DECLARED_STOCK_WHEN_UNKNOWN = 10;

export interface ComputeJitPublishPlanInput {
  readonly variantId: string;
  readonly listingId: string;
  readonly externalProductId: string;
  /** seller_listings.provider_account_id — the marketplace, not the buyer. */
  readonly providerAccountId: string;
  readonly listingType: SellerListingType;
  readonly listingCurrency: string;
  readonly listingMinCents: number;
  readonly externalListingId?: string;
}

export interface JitPublishWalletStatus {
  readonly providerCode: string;
  readonly providerAccountId: string;
  readonly offerCurrency: string;
  readonly unitCostCents: number;
  readonly walletAvailableCents: number | null;
  readonly hasCredits: boolean;
  readonly reason?: string;
}

export interface JitPublishChosenBuyer {
  readonly offerId: string;
  readonly providerAccountId: string;
  readonly providerCode: string;
  readonly offerCurrency: string;
  readonly unitCostCents: number;
}

export type JitPublishPlan =
  | {
      readonly kind: 'plan';
      readonly chosenBuyer: JitPublishChosenBuyer;
      readonly declaredStock: number;
      readonly costInListingCurrencyCents: number;
      readonly suggestion: PriceSuggestionResult;
      readonly walletDiagnostics: ReadonlyArray<JitPublishWalletStatus>;
    }
  | { readonly kind: 'no-buyers' }
  | {
      readonly kind: 'no-funded';
      readonly walletDiagnostics: ReadonlyArray<JitPublishWalletStatus>;
    };

interface RankedCandidate {
  readonly offer: JitCandidateOffer;
  readonly usdUnitCostCents: number;
}

interface FundedCandidate extends RankedCandidate {
  readonly walletStatus: JitPublishWalletStatus;
}

@injectable()
export class ComputeJitPublishPlanUseCase {
  constructor(
    @inject(TOKENS.JitOfferRepository) private readonly offers: IJitOfferRepository,
    @inject(TOKENS.BuyerProviderRegistry) private readonly registry: IBuyerProviderRegistry,
    @inject(TOKENS.ProcurementFxConverter) private readonly fx: IProcurementFxConverter,
    @inject(TOKENS.SellerPricingService) private readonly pricing: ISellerPricingService,
  ) {}

  async execute(input: ComputeJitPublishPlanInput): Promise<JitPublishPlan> {
    const rawOffers = await this.offers.findBuyerCapableOffersForVariant(input.variantId);
    if (rawOffers.length === 0) {
      logger.info('JIT publish plan: no buyer-capable offers', { variantId: input.variantId });
      return { kind: 'no-buyers' };
    }

    const ranked = await this.rank(rawOffers);
    if (ranked.length === 0) {
      // Every offer was unrankable (no price / fx miss). Treat as no buyers.
      return { kind: 'no-buyers' };
    }

    const diagnostics: JitPublishWalletStatus[] = [];
    const funded: FundedCandidate[] = [];

    for (const candidate of ranked) {
      const adapter = await this.registry.resolve(candidate.offer.provider_account_id);
      if (!adapter) {
        diagnostics.push({
          providerCode: candidate.offer.provider_code,
          providerAccountId: candidate.offer.provider_account_id,
          offerCurrency: candidate.offer.currency,
          unitCostCents: candidate.offer.last_price_cents ?? 0,
          walletAvailableCents: null,
          hasCredits: false,
          reason: 'no_buyer_adapter',
        });
        continue;
      }

      const wallet = await adapter.walletPreflight(
        candidate.offer.last_price_cents ?? 0,
        1,
        candidate.offer.currency,
      );

      if (wallet.ok) {
        const status: JitPublishWalletStatus = {
          providerCode: candidate.offer.provider_code,
          providerAccountId: candidate.offer.provider_account_id,
          offerCurrency: candidate.offer.currency,
          unitCostCents: candidate.offer.last_price_cents ?? 0,
          walletAvailableCents: wallet.spendableCents,
          hasCredits: true,
        };
        diagnostics.push(status);
        funded.push({ ...candidate, walletStatus: status });
      } else {
        diagnostics.push({
          providerCode: candidate.offer.provider_code,
          providerAccountId: candidate.offer.provider_account_id,
          offerCurrency: candidate.offer.currency,
          unitCostCents: candidate.offer.last_price_cents ?? 0,
          walletAvailableCents: wallet.spendableCents ?? null,
          hasCredits: false,
          reason: `wallet_${wallet.reason}`,
        });
      }
    }

    if (funded.length === 0) {
      logger.info('JIT publish plan: no buyer with credits', {
        variantId: input.variantId,
        diagnostics: diagnostics.length,
      });
      return { kind: 'no-funded', walletDiagnostics: diagnostics };
    }

    // `ranked` is already sorted cheapest USD-first; `funded` preserves order.
    const winner = funded[0]!;
    const winnerOffer = winner.offer;
    const winnerCostCents = winnerOffer.last_price_cents ?? 0;

    const costInListingCurrencyCents = await this.convertToListingCurrencyCents(
      winnerCostCents,
      winnerOffer.currency,
      input.listingCurrency,
    );

    const declaredStock = resolveDeclaredStock(winnerOffer.available_quantity);

    const suggestion = await this.pricing.suggestPrice({
      listingId: input.listingId,
      externalProductId: input.externalProductId,
      costCents: costInListingCurrencyCents,
      listingType: input.listingType,
      listingMinCents: input.listingMinCents,
      listingCurrency: input.listingCurrency,
      providerAccountId: input.providerAccountId,
      procurementCostBasisCents: costInListingCurrencyCents,
      ...(input.externalListingId ? { externalListingId: input.externalListingId } : {}),
    });

    return {
      kind: 'plan',
      chosenBuyer: {
        offerId: winnerOffer.id,
        providerAccountId: winnerOffer.provider_account_id,
        providerCode: winnerOffer.provider_code,
        offerCurrency: winnerOffer.currency,
        unitCostCents: winnerCostCents,
      },
      declaredStock,
      costInListingCurrencyCents,
      suggestion,
      walletDiagnostics: diagnostics,
    };
  }

  private async rank(offers: readonly JitCandidateOffer[]): Promise<RankedCandidate[]> {
    const ranked: RankedCandidate[] = [];
    for (const offer of offers) {
      if (offer.last_price_cents == null || offer.last_price_cents <= 0) continue;
      const usdUnit = await this.fx.toUsdCents(offer.last_price_cents, offer.currency);
      if (usdUnit == null || !Number.isFinite(usdUnit) || usdUnit <= 0) continue;
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

  /**
   * Convert `cents` from `fromCcy` to `toCcy` by routing through USD.
   *
   * `IProcurementFxConverter` only exposes the `→ USD` direction, so we
   * derive the USD→to rate from a high-precision probe (1,000,000 minor
   * units) to keep cent-rounding error below 1 cent for any realistic
   * listing price.
   *
   * Returns the source amount when conversion is impossible (rare — means
   * the listing currency is not in `currency_rates`); the caller decides
   * whether to fail the publish or retry with a different cost basis.
   */
  private async convertToListingCurrencyCents(
    cents: number,
    fromCcy: string,
    toCcy: string,
  ): Promise<number> {
    const from = fromCcy.trim().toUpperCase();
    const to = toCcy.trim().toUpperCase();
    if (from === to) return cents;

    const usdCents = await this.fx.toUsdCents(cents, from);
    if (usdCents == null || !Number.isFinite(usdCents)) return cents;

    if (to === 'USD') return Math.round(usdCents);

    // Probe `to → USD` with a large amount so the integer-rounding inside
    // the converter contributes <1ppm error to the inverse rate.
    const PROBE = 1_000_000;
    const probeUsd = await this.fx.toUsdCents(PROBE, to);
    if (probeUsd == null || !Number.isFinite(probeUsd) || probeUsd <= 0) return cents;
    const ratio = PROBE / probeUsd; // USD → to multiplier
    return Math.round(usdCents * ratio);
  }
}

function resolveDeclaredStock(available: number | null): number {
  if (available == null || !Number.isFinite(available) || available <= 0) {
    return DEFAULT_DECLARED_STOCK_WHEN_UNKNOWN;
  }
  return Math.floor(available);
}
