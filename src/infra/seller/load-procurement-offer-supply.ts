import type { IDatabase } from '../../core/ports/database.port.js';
import {
  compareProcurementOffersForDeclaredStockReconcile,
  type ProcurementOfferSortRow,
} from '../../core/shared/procurement-declared-stock.js';
import type { DeclaredStockOfferRow } from '../../core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';

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

/**
 * Load buyer-capable `provider_variant_offers` rows for a set of variants,
 * filtered by `provider_accounts.is_enabled = true AND supports_seller = false`.
 *
 * Rows are returned grouped by `variant_id` and shaped for the
 * `CreditAwareDeclaredStockSelectorUseCase`. Sellers (Eneba, Kinguin, G2A,
 * Gamivo, Digiseller) are excluded — we never declare stock based on a
 * marketplace we are listing on.
 */
export async function loadBuyerCapableOffersByVariant(
  db: IDatabase,
  variantIds: readonly string[],
): Promise<Map<string, DeclaredStockOfferRow[]>> {
  const out = new Map<string, DeclaredStockOfferRow[]>();
  if (variantIds.length === 0) return out;

  const unique = [...new Set(variantIds)];

  // Pull every account up-front so the per-batch loop only joins in-memory.
  const accountRows = await db.query<{
    id: string;
    provider_code: string | null;
    is_enabled: boolean | null;
    supports_seller: boolean | null;
  }>('provider_accounts', {
    select: 'id, provider_code, is_enabled, supports_seller',
  });

  const buyerCodeByAccount = new Map<string, string>();
  for (const a of accountRows) {
    if (a.is_enabled !== true) continue;
    if (a.supports_seller === true) continue;
    const code = (a.provider_code ?? '').trim().toLowerCase();
    if (!code) continue;
    buyerCodeByAccount.set(a.id, code);
  }

  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const rows = await db.query<{
      id: string | null;
      variant_id: string | null;
      provider_account_id: string | null;
      currency: string | null;
      last_price_cents: number | null;
      available_quantity: number | string | null;
      prioritize_quote_sync: boolean | null;
    }>('provider_variant_offers', {
      select:
        'id, variant_id, provider_account_id, currency, last_price_cents, available_quantity, prioritize_quote_sync',
      eq: [['is_active', true]],
      in: [['variant_id', chunk]],
    });

    for (const r of rows) {
      const vid = typeof r.variant_id === 'string' ? r.variant_id : '';
      if (!vid) continue;
      const offerId = typeof r.id === 'string' ? r.id : '';
      if (!offerId) continue;
      const accountId = typeof r.provider_account_id === 'string' ? r.provider_account_id : '';
      if (!accountId) continue;
      const providerCode = buyerCodeByAccount.get(accountId);
      if (!providerCode) continue;

      const currency = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : '';
      if (!/^[A-Z]{3}$/.test(currency)) continue;

      const last_price_cents =
        typeof r.last_price_cents === 'number' && Number.isFinite(r.last_price_cents)
          ? r.last_price_cents
          : null;
      const available_quantity = coerceProcurementAvailableQuantity(r.available_quantity);

      const list = out.get(vid) ?? [];
      list.push({
        id: offerId,
        provider_code: providerCode,
        provider_account_id: accountId,
        currency,
        last_price_cents,
        available_quantity,
        prioritize_quote_sync: r.prioritize_quote_sync === true,
      });
      out.set(vid, list);
    }
  }

  return out;
}
