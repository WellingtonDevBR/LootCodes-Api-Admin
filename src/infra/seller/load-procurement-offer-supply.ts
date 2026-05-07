import type { IDatabase } from '../../core/ports/database.port.js';
import {
  compareProcurementOffersForDeclaredStockReconcile,
  type ProcurementOfferSortRow,
} from '../../core/shared/procurement-declared-stock.js';

interface OfferRow extends ProcurementOfferSortRow {
  readonly variant_id: string;
}

const BATCH = 500;

/** Normalize DB/driver shapes (Postgres int/bigint may arrive as string). */
export function coerceProcurementAvailableQuantity(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export async function loadBestProcurementQtyByVariant(
  db: IDatabase,
  variantIds: readonly string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (variantIds.length === 0) return result;

  const unique = [...new Set(variantIds)];
  const grouped = new Map<string, OfferRow[]>();

  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const rows = await db.query<Record<string, unknown>>('provider_variant_offers', {
      select: 'variant_id, prioritize_quote_sync, last_price_cents, available_quantity',
      eq: [['is_active', true]],
      in: [['variant_id', chunk]],
    });

    for (const raw of rows) {
      const vid = raw.variant_id as string;
      const row: OfferRow = {
        variant_id: vid,
        prioritize_quote_sync: raw.prioritize_quote_sync === true,
        last_price_cents: typeof raw.last_price_cents === 'number' ? raw.last_price_cents : null,
        available_quantity: coerceProcurementAvailableQuantity(raw.available_quantity),
      };
      const list = grouped.get(vid) ?? [];
      list.push(row);
      grouped.set(vid, list);
    }
  }

  for (const [vid, offers] of grouped) {
    if (offers.length === 0) continue;
    const sorted = [...offers].sort(compareProcurementOffersForDeclaredStockReconcile);
    const best = sorted[0];
    if (!best) continue;
    result.set(vid, best.available_quantity);
  }

  return result;
}
