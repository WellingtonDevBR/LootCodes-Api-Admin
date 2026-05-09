/** Max declared quantity mirrored from procurement when internal inventory is zero. */
export const MAX_PROCUREMENT_DECLARED_STOCK = 9999;

export interface ProcurementOfferSortRow {
  readonly prioritize_quote_sync: boolean;
  readonly last_price_cents: number | null;
  readonly available_quantity: number | null;
}

/**
 * Pick the preferred procurement row per variant: `prioritize_quote_sync` first, then lowest `last_price_cents`.
 */
export function compareProcurementOffers(a: ProcurementOfferSortRow, b: ProcurementOfferSortRow): number {
  const pa = a.prioritize_quote_sync === true ? 1 : 0;
  const pb = b.prioritize_quote_sync === true ? 1 : 0;
  if (pa !== pb) return pb - pa;
  const ap = a.last_price_cents ?? Number.MAX_SAFE_INTEGER;
  const bp = b.last_price_cents ?? Number.MAX_SAFE_INTEGER;
  return ap - bp;
}

/**
 * Supplier-reported quantity tiers for declared-stock reconciliation:
 * - tier 2: provider has confirmed positive stock (best signal)
 * - tier 1: provider explicitly reported 0 — known state; safe to declare 0
 * - tier 0: quantity is null/unknown — noisy; risk of over-declaring undeliverable stock
 */
function procurementQuantityConfidenceTier(row: ProcurementOfferSortRow): number {
  const q = row.available_quantity;
  if (typeof q !== 'number' || !Number.isFinite(q)) return 0;
  if (q > 0) return 2;
  return 1;
}

/**
 * Pick procurement rows for mirroring onto marketplace declared stock: **known in-stock signal first**,
 * then `prioritize_quote_sync`, then lowest `last_price_cents` (same as `compareProcurementOffers`).
 */
export function compareProcurementOffersForDeclaredStockReconcile(
  a: ProcurementOfferSortRow,
  b: ProcurementOfferSortRow,
): number {
  const ta = procurementQuantityConfidenceTier(a);
  const tb = procurementQuantityConfidenceTier(b);
  if (ta !== tb) return tb - ta;
  return compareProcurementOffers(a, b);
}

/**
 * Target marketplace declared quantity for `declared_stock` listings.
 * When `followsProvider` is true and internal keys are zero, use capped procurement quantity (unknown qty → 0).
 */
export function computeDeclaredStockTarget(params: {
  readonly internalQty: number;
  readonly procurementQtyRaw: number | null | undefined;
  readonly followsProvider: boolean;
  readonly listingType: string;
}): number {
  const { internalQty, procurementQtyRaw, followsProvider, listingType } = params;
  if (listingType !== 'declared_stock') {
    return internalQty;
  }
  if (!followsProvider) {
    return internalQty;
  }
  if (internalQty > 0) {
    return internalQty;
  }
  if (procurementQtyRaw == null) {
    return 0;
  }
  return Math.min(procurementQtyRaw, MAX_PROCUREMENT_DECLARED_STOCK);
}
