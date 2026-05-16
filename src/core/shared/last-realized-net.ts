/**
 * Single source of truth for "what is the marketplace ACTUALLY paying us per
 * unit?" for a seller listing.
 *
 * Why this exists
 * ---------------
 * `seller_listings.price_cents` is the price WE want to receive (or the gross
 * price WE pushed). It does not always match what the marketplace's live
 * auction is realising — Eneba and Gamivo can show stale prices, apply
 * smart-competition discounts, or queue our price-update API calls. When the
 * gap grows, the reconcile cron's economic gate (which trusts
 * `listing.price_cents`) declares stock that JIT will subsequently refuse —
 * producing the out_of_stock infinite loop documented in
 * `procurement-declared-stock-reconcile.service.ts`.
 *
 * The fix is observational: every RESERVE callback gives us empirical evidence
 * of what the auction realised (`priceWithoutCommission` for Eneba,
 * `unit_price - commission` for Gamivo). Persist it on the listing and let
 * the reconcile cron use the lower of (intended price, last realised net) as
 * a pessimistic gate. Self-healing once the next price-push catches up.
 *
 * Storage layout (`seller_listings.provider_metadata.lastRealizedNet`)
 * --------------------------------------------------------------------
 *   {
 *     centsPerUnit: number,    // per-unit seller-net in the listing's currency
 *     currency: string,        // ISO 4217, must match listing.currency
 *     at: ISO timestamp,       // when this RESERVE was observed
 *   }
 *
 * Pure helpers — no DB I/O. The actual write is done by callers (use cases)
 * through the IDatabase port to respect the inward-flowing dependency rule
 * (`core/` cannot import from `infra/`).
 */

export interface LastRealizedNet {
  readonly centsPerUnit: number;
  readonly currency: string;
  readonly at: string;
}

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readLastRealizedNet(
  metadata: Record<string, unknown> | null | undefined,
): LastRealizedNet | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).lastRealizedNet;
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const centsPerUnit = obj.centsPerUnit;
  const currency = obj.currency;
  const at = obj.at;
  if (
    typeof centsPerUnit !== 'number'
    || !Number.isFinite(centsPerUnit)
    || centsPerUnit <= 0
    || typeof currency !== 'string'
    || currency.length === 0
    || typeof at !== 'string'
  ) {
    return null;
  }
  // Reject stale records: a listing with no realised sale in 7 days no longer
  // has trustworthy observational data — cost basis, FX, marketplace strategy
  // may all have moved. Fall back to listing.price_cents.
  const ageMs = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > MAX_AGE_MS) return null;
  return { centsPerUnit, currency, at };
}

/**
 * Pessimistic per-unit sale price for economic gates: the lower of
 * (intended `listing.price_cents`, last observed marketplace realised net).
 * Returns the intended price when no realised observation exists.
 *
 * Currency mismatch (which would only happen if the listing currency was
 * changed after a sale) treats the realised value as null — we don't try to
 * cross-FX-convert a per-unit float here; the next sale will refresh it.
 */
export function pessimisticSaleCents(
  intendedCentsPerUnit: number,
  intendedCurrency: string,
  realised: LastRealizedNet | null,
): number {
  if (!realised) return intendedCentsPerUnit;
  if (realised.currency.toUpperCase() !== intendedCurrency.toUpperCase()) {
    return intendedCentsPerUnit;
  }
  return Math.min(intendedCentsPerUnit, realised.centsPerUnit);
}

/**
 * Builds the next provider_metadata payload by overlaying the new realised
 * net on top of any existing metadata keys. Pure — caller persists.
 */
export function withLastRealizedNet(
  existing: Record<string, unknown> | null | undefined,
  realised: LastRealizedNet,
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  base.lastRealizedNet = { ...realised };
  return base;
}
