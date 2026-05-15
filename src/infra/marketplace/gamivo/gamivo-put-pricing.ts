/**
 * Pure helpers for Gamivo PUT /api/public/v1/offers/{id}.
 *
 * Gamivo accepts a `seller_price` (net) field on PUT, but also accepts
 * `tier_one_seller_price` / `tier_two_seller_price`. Sending only `seller_price`
 * without realigning the tier seller nets is what causes Gamivo to keep stale
 * wholesale tier prices while the retail price moves — and that's what the
 * auto-pricing cron will be doing on every tick.
 *
 * To keep the three nets internally consistent we go through Gamivo's
 * `calculate-customer-price` / `calculate-seller-price` endpoints whenever we
 * touch pricing. The flow is:
 *
 *   1. base seller net → calculate-customer-price → uniform customer gross
 *   2. uniform customer gross → calculate-seller-price → aligned three nets
 *
 * Ported (1:1, no behaviour drift) from
 * `supabase/functions/provider-procurement/providers/gamivo/gamivo-put-pricing.ts`
 * in the storefront repo. Keeping the two implementations in lockstep is the
 * point — diverging will silently break PUT semantics.
 */
import type {
  GamivoCalculatePriceResponse,
  GamivoEditOfferRequest,
  GamivoOfferDetail,
} from './types.js';

/**
 * True iff the override only touches stock or status — i.e. nothing
 * price-related. In that case the existing customer-facing prices are still
 * accurate and we just recompute the matching seller nets from them.
 */
export function isGamivoPricingSafeOverrides(
  overrides: Partial<GamivoEditOfferRequest>,
): boolean {
  for (const key of Object.keys(overrides) as Array<keyof GamivoEditOfferRequest>) {
    if (key !== 'keys' && key !== 'status') {
      return false;
    }
  }
  return true;
}

/**
 * Customer-facing EUR prices to feed into the calculator. Wholesale tier
 * customer prices of 0 fall back to retail (Gamivo may omit tiers on some
 * offers).
 */
export function gamivoCustomerPricesForCalculator(
  preUpdate: GamivoOfferDetail,
): {
  price: number;
  tierOne: number;
  tierTwo: number;
} {
  const retail = preUpdate.retail_price;
  const t1 = preUpdate.wholesale_price_tier_one > 0
    ? preUpdate.wholesale_price_tier_one
    : retail;
  const t2 = preUpdate.wholesale_price_tier_two > 0
    ? preUpdate.wholesale_price_tier_two
    : retail;
  return { price: retail, tierOne: t1, tierTwo: t2 };
}

/** Query string for GET .../calculate-seller-price/{id}?... */
export function buildCalculateSellerPriceQuery(preUpdate: GamivoOfferDetail): string {
  const { price, tierOne, tierTwo } = gamivoCustomerPricesForCalculator(preUpdate);
  const p = new URLSearchParams();
  p.set('price', price.toFixed(2));
  p.set('tier_one_price', tierOne.toFixed(2));
  p.set('tier_two_price', tierTwo.toFixed(2));
  return p.toString();
}

/**
 * Uniform customer gross for retail + both wholesale tiers — used after we
 * have resolved customer_price from a target base seller net so the tier
 * seller nets stay aligned with that gross.
 */
export function buildCalculateSellerPriceQueryFromUniformCustomerGross(
  customerGrossEur: number,
): string {
  const g = customerGrossEur.toFixed(2);
  const p = new URLSearchParams();
  p.set('price', g);
  p.set('tier_one_price', g);
  p.set('tier_two_price', g);
  return p.toString();
}

export function mapCalculatorResponseToPutSellerFields(
  resp: GamivoCalculatePriceResponse,
): Pick<GamivoEditOfferRequest, 'seller_price' | 'tier_one_seller_price' | 'tier_two_seller_price'> {
  return {
    seller_price: resp.seller_price,
    tier_one_seller_price: resp.wholesale_seller_price_tier_one,
    tier_two_seller_price: resp.wholesale_seller_price_tier_two,
  };
}

export function sellerFieldsFromOfferGet(
  preUpdate: GamivoOfferDetail,
): Pick<GamivoEditOfferRequest, 'seller_price' | 'tier_one_seller_price' | 'tier_two_seller_price'> {
  return {
    seller_price: preUpdate.seller_price,
    tier_one_seller_price: preUpdate.wholesale_seller_price_tier_one,
    tier_two_seller_price: preUpdate.wholesale_seller_price_tier_two,
  };
}
