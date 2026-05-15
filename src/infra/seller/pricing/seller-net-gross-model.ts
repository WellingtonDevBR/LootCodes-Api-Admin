/**
 * NET/GROSS pricing model helpers — Eneba-only today, but provider-agnostic by
 * design so future marketplaces that publish a buyer-facing GROSS price while
 * accepting a seller-facing NET price (or vice-versa) can plug in.
 *
 * The "ratio" is `gross / net` for the same listing. Derived from one of two
 * authoritative sources:
 *
 *   1. The marketplace's own competition response (our offer's `priceCents` is
 *      the GROSS we published; `listing.price_cents` is the NET we stored).
 *      Preferred — it reflects the marketplace's actual fee calculation at the
 *      exact price point we care about.
 *   2. Stock-level GROSS from `S_stock`. Used when our own offer is hidden
 *      from competition (Eneba hides declared_stock=0 listings).
 *
 * @see seller-auto-pricing.service.ts for the round-trip explanation of why we
 *      cannot simply call S_calculatePrice (Eneba's commission is applied
 *      asymmetrically on NET→GROSS vs GROSS→NET, so a round-trip drifts ~1%).
 */
import type { CompetitorPrice } from '../../../core/ports/marketplace-adapter.port.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-net-gross-model');

export interface NetGrossListingContext {
  listingId: string;
  externalListingId: string | null;
  providerCode: string;
  storedNetPriceCents: number;
}

export interface NetGrossResolveOptions {
  /** Live competitors from the marketplace (may include `isOwnOffer`). */
  competitors: readonly CompetitorPrice[];
  /** GROSS prices from S_stock, keyed by external listing id. */
  grossPriceByListing: ReadonlyMap<string, number>;
  /** Cron request id — included in logs for correlation. */
  requestId: string;
}

/**
 * Resolves the GROSS/NET ratio for a NET-priced listing.
 *
 * @returns Ratio (> 0) when resolvable, `null` when we should skip the listing
 *   this tick. Callers must treat `null` as a hard skip — pushing a NET price
 *   without the correct ratio would either over- or under-charge buyers.
 */
export function resolveNetGrossRatio(
  ctx: NetGrossListingContext,
  options: NetGrossResolveOptions,
): number | null {
  if (ctx.storedNetPriceCents <= 0) return null;

  const ownOffer = options.competitors.find((c) => c.isOwnOffer === true);
  if (ownOffer && ownOffer.priceCents > 0) {
    return ownOffer.priceCents / ctx.storedNetPriceCents;
  }

  if (!ctx.externalListingId) {
    logger.error('NET pricing: own offer absent and no external listing id', {
      listingId: ctx.listingId, providerCode: ctx.providerCode,
      requestId: options.requestId,
    });
    return null;
  }

  const stockGross = options.grossPriceByListing.get(ctx.externalListingId);
  if (stockGross && stockGross > 0) {
    const ratio = stockGross / ctx.storedNetPriceCents;
    logger.info('NET pricing: using S_stock gross for ratio (own offer absent from competition)', {
      requestId: options.requestId,
      listingId: ctx.listingId,
      providerCode: ctx.providerCode,
      externalListingId: ctx.externalListingId,
      stockGross,
      storedNet: ctx.storedNetPriceCents,
      ratio,
    });
    return ratio;
  }

  logger.error('NET pricing: own offer absent from competition and no S_stock gross price available', {
    requestId: options.requestId,
    listingId: ctx.listingId,
    providerCode: ctx.providerCode,
    externalListingId: ctx.externalListingId,
    storedNet: ctx.storedNetPriceCents,
  });
  return null;
}

/**
 * GROSS → NET conversion using the resolved ratio. Used to translate the
 * smart-pricing engine's output (which works in GROSS space, matching what
 * competitors publish) back into the NET price we send to the marketplace.
 */
export function convertGrossToNet(gross: number, ratio: number, listingId: string): number {
  if (ratio <= 0) {
    throw new Error(`NET pricing model gross→net conversion has no ratio for listing ${listingId}`);
  }
  return Math.round(gross / ratio);
}
