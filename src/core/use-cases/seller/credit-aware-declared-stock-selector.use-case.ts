/**
 * CreditAwareDeclaredStockSelectorUseCase
 *
 * Pure function that decides "for one declared_stock listing, which buyer-
 * capable provider offer should we mirror onto the marketplace, given live
 * wallet credit and the listing's pricing-strategy floor — or do we have to
 * disable selling on this cycle?"
 *
 * Inputs:
 *   - `offers`: rows from `provider_variant_offers` filtered to buyer-
 *     capable accounts for this variant.
 *   - `snapshot`: per-run wallet balance snapshot keyed by
 *     `provider_account_id → currency → spendable cents`.
 *   - `config`: pricing-strategy context (sale price, commission, min floor,
 *     min profit margin, requested qty).
 *   - `fx`: USD normalizer (so we can rank cross-currency offers).
 *
 * Output: either a `declare` decision (which offer + how many to declare +
 * the cost basis to feed to auto-pricing) or a `disable` decision with a
 * reason the caller can persist as `error_message` and use to choose the
 * right per-marketplace "stop selling" call.
 *
 * No side effects. No I/O. Receives data, returns a decision. Tested in
 * isolation by `test/credit-aware-declared-stock-selector.use-case.test.ts`.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IProcurementFxConverter } from '../../ports/procurement-fx-converter.port.js';
import {
  type WalletSnapshot,
  getSpendableCentsFromSnapshot,
} from '../../ports/buyer-wallet-snapshot.port.js';
import { MAX_PROCUREMENT_DECLARED_STOCK } from '../../shared/procurement-declared-stock.js';

export interface DeclaredStockOfferRow {
  readonly id: string;
  readonly provider_code: string;
  readonly provider_account_id: string;
  readonly currency: string;
  readonly last_price_cents: number | null;
  readonly available_quantity: number | null;
  readonly prioritize_quote_sync: boolean;
}

export interface DeclaredStockPricingConfig {
  /**
   * Listing sale price normalized to USD cents — used as the upper bound
   * for the profitability gate. Pass 0 to disable the gate.
   */
  readonly sellerSalePriceUsdCents: number;
  /**
   * Minimum profit margin as a percent of the sale price (0–100). The
   * selector enforces `unitCostUsd <= sale * (1 - minProfitMarginPct/100)`.
   */
  readonly minProfitMarginPct: number;
  /**
   * Marketplace commission percentage (0–100). Used to bound the cost-basis
   * USD against the sale-grossed-up floor when the seller pricing strategy
   * cares about the post-commission take-home.
   */
  readonly commissionRatePercent: number;
  /**
   * `provider.seller_config.min_price_floor_cents` normalized to USD. The
   * selector treats this as a clamp on the OUTGOING listing price, not a
   * clamp on the cost — it is informational here for parity with
   * `seller-pricing.service.ts.enforceMinPrice`.
   */
  readonly minPriceFloorUsdCents: number;
  /**
   * Per-listing `seller_listings.min_price_cents` normalized to USD.
   * Same caveat as `minPriceFloorUsdCents`.
   */
  readonly listingMinUsdCents: number;
  /**
   * Per-sale flat fee charged by the marketplace, normalized to USD cents.
   * Subtracted BEFORE the margin gate, mirroring `seller-pricing-math.ts`'s
   * floor formula `(cost × (1 + margin) + fee) / (1 − commission)`.
   *
   * Sourced from `seller_config.fixed_fee_cents` after merging any per-listing
   * `pricing_overrides.fixed_fee_override_cents`. Optional for backward
   * compatibility; `undefined` is treated as zero.
   *
   * Ignored when `netPayoutUsdCents` is provided — the marketplace's own
   * calculator already accounts for both percentage commission and per-sale
   * fees in its post-fee figure.
   */
  readonly fixedFeeUsdCents?: number;
  /**
   * Authoritative post-fee seller take-home in USD cents, sourced from the
   * marketplace's own fee calculator (Eneba `S_calculatePrice`, G2A
   * `/v3/pricing/simulations`, Kinguin commission API, Gamivo
   * `calculate-customer-price`). When set, this value REPLACES the manual
   * `commissionRatePercent + fixedFeeUsdCents` math — the selector applies
   * only `minProfitMarginPct` on top of it.
   *
   * Provide this whenever the caller can reach the live calculator; fall
   * back to manual config only when no live API exists (e.g. Digiseller)
   * or the call genuinely failed. Optional for backward compatibility.
   */
  readonly netPayoutUsdCents?: number;
  /**
   * How many units the listing wants to declare/cover this cycle.
   * Wallet headroom must cover `unitCost * requestedQty`.
   */
  readonly requestedQty: number;
}

export interface DeclaredStockSelectorInput {
  readonly offers: ReadonlyArray<DeclaredStockOfferRow>;
  readonly snapshot: WalletSnapshot;
  readonly config: DeclaredStockPricingConfig;
}

export type DeclaredStockDisableReason = 'no_offer' | 'no_credit' | 'uneconomic';

export type DeclaredStockSelectorResult =
  | {
      readonly kind: 'declare';
      readonly offer: DeclaredStockOfferRow;
      readonly declaredQty: number;
      readonly costBasisUsdCents: number;
    }
  | {
      readonly kind: 'disable';
      readonly reason: DeclaredStockDisableReason;
    };

interface RankedRow {
  readonly offer: DeclaredStockOfferRow;
  readonly unitCostUsdCents: number;
}

@injectable()
export class CreditAwareDeclaredStockSelectorUseCase {
  constructor(@inject(TOKENS.ProcurementFxConverter) private readonly fx: IProcurementFxConverter) {}

  async execute(input: DeclaredStockSelectorInput): Promise<DeclaredStockSelectorResult> {
    const { offers, snapshot, config } = input;

    if (offers.length === 0) {
      return { kind: 'disable', reason: 'no_offer' };
    }

    const ranked = await this.rank(offers);
    if (ranked.length === 0) {
      return { kind: 'disable', reason: 'no_offer' };
    }

    const requestedQty = Math.max(1, Math.trunc(config.requestedQty || 1));
    const maxAcceptableUnitUsdCents = computeProfitabilityCeilingUsdCents(config);

    let sawAffordable = false;
    let sawCreditedButUneconomic = false;

    for (const candidate of ranked) {
      const spendable = getSpendableCentsFromSnapshot(
        snapshot,
        candidate.offer.provider_account_id,
        candidate.offer.currency,
      );
      const requiredCents =
        (candidate.offer.last_price_cents ?? 0) * requestedQty;

      if (spendable < requiredCents) {
        continue;
      }
      sawAffordable = true;

      if (
        maxAcceptableUnitUsdCents != null
        && candidate.unitCostUsdCents > maxAcceptableUnitUsdCents
      ) {
        sawCreditedButUneconomic = true;
        continue;
      }

      return {
        kind: 'declare',
        offer: candidate.offer,
        declaredQty: capDeclaredQty(candidate.offer.available_quantity),
        costBasisUsdCents: candidate.unitCostUsdCents,
      };
    }

    if (!sawAffordable) {
      return { kind: 'disable', reason: 'no_credit' };
    }
    if (sawCreditedButUneconomic) {
      return { kind: 'disable', reason: 'uneconomic' };
    }
    return { kind: 'disable', reason: 'no_credit' };
  }

  private async rank(
    offers: ReadonlyArray<DeclaredStockOfferRow>,
  ): Promise<RankedRow[]> {
    const out: RankedRow[] = [];
    for (const offer of offers) {
      if (
        offer.last_price_cents == null
        || !Number.isFinite(offer.last_price_cents)
        || offer.last_price_cents <= 0
      ) {
        continue;
      }
      const usd = await this.fx.toUsdCents(offer.last_price_cents, offer.currency);
      if (usd == null || !Number.isFinite(usd) || usd <= 0) {
        continue;
      }
      out.push({ offer, unitCostUsdCents: usd });
    }

    out.sort((a, b) => {
      if (a.unitCostUsdCents !== b.unitCostUsdCents) {
        return a.unitCostUsdCents - b.unitCostUsdCents;
      }
      const ap = a.offer.prioritize_quote_sync ? 1 : 0;
      const bp = b.offer.prioritize_quote_sync ? 1 : 0;
      return bp - ap;
    });

    return out;
  }
}

/**
 * Maximum acceptable per-unit USD buy cost given the sale and commission/margin
 * profile. Returns `null` when no sale price is supplied (i.e. the listing has
 * not been priced yet) — the selector then accepts any credited buyer.
 */
function computeProfitabilityCeilingUsdCents(
  config: DeclaredStockPricingConfig,
): number | null {
  const sale = config.sellerSalePriceUsdCents;
  if (typeof sale !== 'number' || !Number.isFinite(sale) || sale <= 0) {
    return null;
  }
  const margin = clampPercent(config.minProfitMarginPct);

  // Marketplace-authoritative path: when the caller has fetched the live
  // post-fee figure (Eneba `S_calculatePrice`, G2A pricing simulation, etc.),
  // skip the stale manual commission/fixed-fee math entirely.
  if (
    typeof config.netPayoutUsdCents === 'number'
    && Number.isFinite(config.netPayoutUsdCents)
    && config.netPayoutUsdCents > 0
  ) {
    const ceiling = config.netPayoutUsdCents * (1 - margin / 100);
    return Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : 0;
  }

  // Fallback path (no live calculator available, e.g. Digiseller).
  // Mirror of `seller-pricing-math.priceFloorFromCost`:
  //   gross = (cost * (1 + margin) + fee) / (1 - commission)
  //   ⇔   max_cost = (gross * (1 - commission) - fee) / (1 + margin)
  const commission = clampPercent(config.commissionRatePercent);
  const fixedFee = clampNonNegative(config.fixedFeeUsdCents);

  const afterCommission = sale * (1 - commission / 100);
  const afterFee = afterCommission - fixedFee;
  if (!Number.isFinite(afterFee) || afterFee <= 0) {
    return 0;
  }
  const ceiling = afterFee * (1 - margin / 100);
  return Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : 0;
}

function clampPercent(input: number | undefined): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return 0;
  if (input < 0) return 0;
  if (input > 100) return 100;
  return input;
}

function clampNonNegative(input: number | undefined): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return 0;
  if (input < 0) return 0;
  return input;
}

function capDeclaredQty(available: number | null): number {
  if (typeof available !== 'number' || !Number.isFinite(available)) {
    return 1;
  }
  if (available <= 0) return 1;
  return Math.min(Math.trunc(available), MAX_PROCUREMENT_DECLARED_STOCK);
}
