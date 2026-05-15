/**
 * Shared helper: compute a strategy-aware corrected price for a declared-stock
 * listing whose current price is below the procurement cost floor.
 *
 * Rules (matches user intent):
 * 1. Always declare stock when credit exists — never block on an uneconomic price.
 * 2. The minimum acceptable price is `offer_cost × (1 + margin%)`.
 * 3. ON TOP of that, apply the configured pricing strategy using cached competitor
 *    data from `seller_competitor_floors` (written by the pricing phase that runs
 *    before declared-stock). This avoids extra live API calls.
 * 4. Result = max(floor, strategyPrice).
 *
 * For `seller_price` adapters (Eneba `priceIWantToGet`):
 *   - Floor is NET: `cost × (1 + margin%)`
 *   - Strategy output is GROSS → convert to NET: `gross × (1 − commission) − fixedFee`
 *   - Final: max(floorNet, strategyNet)
 *
 * For `gross_price` adapters (G2A, Kinguin, …):
 *   - Floor is GROSS: `(cost × (1 + margin%) + fixedFee) / (1 − commission)`
 *   - Strategy output is GROSS → use directly
 *   - Final: max(floorGross, strategyGross)
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IProcurementFxConverter } from '../../core/ports/procurement-fx-converter.port.js';
import type { SellerPriceStrategy } from '../../core/use-cases/seller/seller.types.js';
import { SELLER_CONFIG_DEFAULTS } from '../../core/use-cases/seller/seller.types.js';
import { applySellerPriceStrategy } from '../../core/use-cases/seller/apply-seller-price-strategy.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('strategy-aware-correction');

interface StrategyAwareCorrectionParams {
  db: IDatabase;
  fx: IProcurementFxConverter;
  listingId: string;
  listingCurrency: string;
  /** USD cents paid to the procurement provider (Bamboo / AppRoute) per unit. */
  offerCostUsdCents: number;
  marginPct: number;
  commissionPct: number;
  fixedFeeCents: number;
  priceStrategy: SellerPriceStrategy;
  priceStrategyValue: number;
  /**
   * How the adapter submits prices to the marketplace.
   * 'seller_price' → net (e.g. Eneba `priceIWantToGet`): `listing.price_cents` is net.
   * 'gross_price' / undefined → gross (buyer-facing): `listing.price_cents` is gross.
   */
  pricingModel?: 'seller_price' | 'gross_price';
  /**
   * Max age (ms) of cached competitor data in `seller_competitor_floors`
   * before we ignore it and fall back to the cost floor.
   * Defaults to `SELLER_CONFIG_DEFAULTS.competitor_cache_max_age_ms` (4 h).
   */
  competitorCacheMaxAgeMs?: number;
}

/**
 * Returns the corrected price in the same units as `listing.price_cents` for
 * this provider (net for Eneba, gross for others).
 */
export async function computeStrategyAwareCorrectedPrice(
  params: StrategyAwareCorrectionParams,
): Promise<number> {
  const {
    db, fx, listingId, listingCurrency, offerCostUsdCents,
    marginPct, commissionPct, fixedFeeCents,
    priceStrategy, priceStrategyValue, pricingModel,
    competitorCacheMaxAgeMs = SELLER_CONFIG_DEFAULTS.competitor_cache_max_age_ms,
  } = params;

  const isSellerPrice = pricingModel === 'seller_price';
  const safeMargin = Math.max(0, marginPct ?? 0);
  const safeCommission = Math.max(0, Math.min(100, commissionPct ?? 0));
  const safeFee = Math.max(0, fixedFeeCents ?? 0);

  // ── Step 1: Convert offer USD cost to listing currency ────────────────
  const usdPer100Listing = await fx.toUsdCents(100, listingCurrency);
  const costInListing = usdPer100Listing != null && usdPer100Listing > 0
    ? (offerCostUsdCents / usdPer100Listing) * 100
    : offerCostUsdCents;

  // ── Step 2: Compute floor in correct "model" units ────────────────────
  // seller_price (Eneba): floor is NET → cost × (1 + margin%)
  // gross_price (others): floor is GROSS → (cost × (1 + margin%) + fee) / (1 - commission)
  const costFloorNet = Math.ceil(costInListing * (1 + safeMargin / 100));
  const commissionFactor = 1 - safeCommission / 100;
  const costFloorGross = commissionFactor > 0
    ? Math.ceil((costFloorNet + safeFee) / commissionFactor)
    : Math.ceil(costFloorNet * (1 + safeCommission / 100)) + safeFee;

  const floorInModelUnits = isSellerPrice ? costFloorNet : costFloorGross;

  // ── Step 3: Load cached competitor floors from DB (no API call) ──────
  // The pricing phase (which runs before declared-stock) writes both
  // `lowest_competitor_cents` (P1) and `second_lowest_cents` (P2) to
  // `seller_competitor_floors`. We need P2 for `smart_compete` so we can
  // target P2 − 1 (1 cent below the next price tier above our floor).
  let lowestCompetitorGross: number | null = null;
  let secondLowestCompetitorGross: number | null = null;
  try {
    const row = await db.queryOne<{
      lowest_competitor_cents: number | null;
      second_lowest_cents: number | null;
      updated_at: string | null;
    }>('seller_competitor_floors', {
      eq: [['seller_listing_id', listingId]],
    });

    if (row) {
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const ageMs = Date.now() - updatedAt;
      if (ageMs <= competitorCacheMaxAgeMs) {
        if (row.lowest_competitor_cents != null && row.lowest_competitor_cents > 0) {
          lowestCompetitorGross = row.lowest_competitor_cents;
        }
        if (row.second_lowest_cents != null && row.second_lowest_cents > 0) {
          secondLowestCompetitorGross = row.second_lowest_cents;
        }
      }
    }
  } catch (err) {
    logger.info('strategy-aware-correction: could not read competitor floor, using cost floor', {
      listingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Step 4: Apply pricing strategy ────────────────────────────────────
  // Strategy operates in GROSS terms (competitor prices are buyer-facing).
  // costFloorGross is the minimum gross price we'd accept.
  // For smart_compete: P2 (secondLowestCompetitorGross) enables the gap-exploit
  // logic — target = P2 − 1, staying 1 cent below the next price tier.
  const strategyGross = applySellerPriceStrategy(
    priceStrategy,
    priceStrategyValue ?? 0,
    costFloorGross,
    lowestCompetitorGross,
    secondLowestCompetitorGross,
  );

  // Strategy price should never go below our computed gross floor.
  const clampedStrategyGross = Math.max(costFloorGross, strategyGross);

  // ── Step 5: Convert strategy gross → model units ──────────────────────
  let finalPrice: number;
  if (isSellerPrice) {
    // Eneba: convert gross → net: net = gross × (1 - commission) - fixedFee
    const strategyNet = Math.floor(clampedStrategyGross * commissionFactor) - safeFee;
    finalPrice = Math.max(floorInModelUnits, strategyNet > 0 ? strategyNet : floorInModelUnits);
  } else {
    finalPrice = clampedStrategyGross; // already in gross units
  }

  if (lowestCompetitorGross != null) {
    logger.info('strategy-aware-correction: applied strategy', {
      listingId,
      pricingModel: pricingModel ?? 'gross_price',
      priceStrategy,
      offerCostUsdCents,
      costInListing: Math.round(costInListing),
      costFloorNet,
      costFloorGross,
      lowestCompetitorGross,
      secondLowestCompetitorGross,
      strategyGross,
      clampedStrategyGross,
      finalPrice,
    });
  }

  return finalPrice;
}
