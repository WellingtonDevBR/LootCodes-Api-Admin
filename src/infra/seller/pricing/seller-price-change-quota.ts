import type { IDatabase } from '../../../core/ports/database.port.js';

/**
 * Pure helpers + a thin recorder that keep `seller_listings.provider_metadata.price_change_timestamps`
 * in sync with marketplace pushes. Single source of truth for our local view of the
 * marketplace price-change quota (Eneba 10 free / 24 h). Used by:
 *   - `SellerAutoPricingService.refreshAllPrices` (cron pushes)
 *   - `BatchUpdatePricesUseCase` (manual admin batch pushes)
 *
 * Why this exists: previously the cron updated `provider_metadata` inline after each
 * batch push, while the manual `POST /listings/batch-prices` flow did not — manual
 * drops would burn Eneba's real quota but never increment our local counter, leaving
 * the auto-pricer with a stale view of remaining budget.
 */

export function getPriceChangeTimestamps(metadata: Record<string, unknown> | null | undefined): string[] {
  const ts = metadata?.price_change_timestamps;
  if (!Array.isArray(ts)) return [];
  return ts.filter((v): v is string => typeof v === 'string');
}

export function pruneOldTimestamps(timestamps: string[], windowHours: number): string[] {
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  return timestamps.filter((t) => new Date(t).getTime() > cutoff);
}

export function buildUpdatedMetadata(
  existing: Record<string, unknown> | null | undefined,
  windowHours: number,
  nowIso: string = new Date().toISOString(),
): Record<string, unknown> {
  const base = existing ?? {};
  const timestamps = getPriceChangeTimestamps(base);
  const pruned = pruneOldTimestamps(timestamps, windowHours);
  pruned.push(nowIso);
  return { ...base, price_change_timestamps: pruned };
}

/**
 * Records a price-change timestamp on a single listing's `provider_metadata`,
 * pruning entries older than the provider's `price_change_window_hours`. Reads
 * the current row to merge metadata so we never clobber unrelated fields.
 *
 * Caller must have already confirmed the marketplace push succeeded — this
 * helper is a quota bookkeeping write only.
 */
export async function recordSellerListingPriceChangeTimestamp(
  db: IDatabase,
  listingId: string,
  windowHours: number,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const rows = await db.query<{ provider_metadata: Record<string, unknown> | null }>(
    'seller_listings',
    { filter: { id: listingId }, select: 'provider_metadata', limit: 1 },
  );
  const existing = rows[0]?.provider_metadata ?? {};
  const updated = buildUpdatedMetadata(existing, windowHours, nowIso);
  await db.update('seller_listings', { id: listingId }, {
    provider_metadata: updated,
  });
}
