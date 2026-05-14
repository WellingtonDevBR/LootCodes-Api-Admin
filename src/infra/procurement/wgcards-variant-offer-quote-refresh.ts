/**
 * WGCards offer snapshot refresh.
 *
 * Groups active offer rows by `external_parent_product_id` (WGCards itemId), then
 * calls `getItemAndStock(itemId)` once per unique parent to get both live price
 * (`skuPrice`) and stock in a single request. This is the ONLY WGCards endpoint
 * that returns prices — `getStock` returns availability only.
 *
 * Rate limit: 5 per 60 seconds. We pace at 14 s between parent-item calls.
 *
 * Side effects:
 *   - Updates `provider_variant_offers.last_price_cents / available_quantity`
 *   - Upserts `provider_product_catalog.min_price_cents / qty` as a by-product
 *     so the catalog stays warm for cost-estimation queries.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import type { WgcardsManualBuyer } from './wgcards/wgcards-manual-buyer.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('wgcards-offer-refresh');

/** 5/60s limit → 12 s/call minimum. 14 s gives comfortable headroom. */
const INTER_PARENT_DELAY_MS = 14_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WgcardsOfferRefreshRow {
  readonly id: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string;
  /** WGCards itemId — parent of the SKU. Required to call getItemAndStock. */
  readonly external_parent_product_id: string | null;
  readonly currency: string | null;
}

export interface WgcardsOfferRefreshResult {
  readonly updated: number;
  readonly failed: number;
}

/**
 * Refreshes `provider_variant_offers` rows for a single WGCards account.
 * Calls `getItemAndStock(itemId)` once per unique parent item to obtain
 * live prices and stock for all linked SKUs in that item.
 */
export async function refreshWgcardsOfferSnapshots(
  db: IDatabase,
  buyer: WgcardsManualBuyer,
  providerAccountId: string,
  offerRows: readonly WgcardsOfferRefreshRow[],
  requestId: string,
): Promise<WgcardsOfferRefreshResult> {
  if (offerRows.length === 0) return { updated: 0, failed: 0 };

  // ── Group offers by parent itemId ────────────────────────────────────────
  const byParent = new Map<string, WgcardsOfferRefreshRow[]>();
  const noParent: WgcardsOfferRefreshRow[] = [];

  for (const row of offerRows) {
    const parentId = row.external_parent_product_id?.trim();
    if (!parentId) {
      noParent.push(row);
      continue;
    }
    const existing = byParent.get(parentId) ?? [];
    existing.push(row);
    byParent.set(parentId, existing);
  }

  if (noParent.length > 0) {
    logger.warn('WGCards refresh: offers missing external_parent_product_id — skipped', {
      requestId,
      providerAccountId,
      count: noParent.length,
      skuIds: noParent.map((r) => r.external_offer_id),
    });
  }

  // ── Per-parent getItemAndStock calls ─────────────────────────────────────
  /** skuId → { priceCents, currency, stock } */
  const skuData = new Map<string, { priceCents: number; currency: string; stock: number }>();

  let parentIndex = 0;
  for (const [parentId, rows] of byParent) {
    if (parentIndex > 0) await sleep(INTER_PARENT_DELAY_MS);
    parentIndex++;

    // Infer request currency from the offer rows (default USD)
    const offerCurrency = rows[0]?.currency?.trim().toUpperCase() ?? 'USD';

    try {
      const skuInfos = await buyer.getItemAndStockByParent(parentId, offerCurrency);
      for (const sku of skuInfos) {
        const priceCents = sku.skuPrice > 0 ? Math.round(sku.skuPrice * 100) : 0;
        skuData.set(sku.skuId, {
          priceCents,
          currency: sku.skuPriceCurrency || offerCurrency,
          stock: sku.stock,
        });
      }
      logger.debug('WGCards refresh: getItemAndStock succeeded', {
        requestId,
        parentId,
        skuCount: skuInfos.length,
      });
    } catch (err) {
      logger.warn(
        'WGCards refresh: getItemAndStock failed for parent item',
        err instanceof Error ? err : new Error(String(err)),
        { requestId, providerAccountId, parentId, affectedSkus: rows.map((r) => r.external_offer_id) },
      );
    }
  }

  // ── Update offer rows + catalog ──────────────────────────────────────────
  let updated = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const offer of offerRows) {
    if (!offer.external_parent_product_id) continue;

    const skuId = offer.external_offer_id.trim();
    const data = skuData.get(skuId);

    // -1 from WGCards means unlimited — map to null (our "no limit" convention)
    const availableQuantity = data === undefined
      ? null
      : data.stock === -1 ? null : data.stock;

    const priceCents = data?.priceCents ?? null;
    const currency = data?.currency ?? offer.currency ?? 'USD';

    try {
      await db.update(
        'provider_variant_offers',
        { id: offer.id },
        {
          last_price_cents: priceCents && priceCents > 0 ? priceCents : null,
          available_quantity: availableQuantity,
          currency,
          last_checked_at: now,
          updated_at: now,
        },
      );
      updated++;
    } catch (err) {
      logger.warn(
        'WGCards offer snapshot update failed',
        err instanceof Error ? err : new Error(String(err)),
        { requestId, offerRowId: offer.id, skuId },
      );
      failed++;
      continue;
    }

    // ── Warm up catalog price as a by-product ──────────────────────────────
    if (priceCents && priceCents > 0) {
      try {
        await db.upsert(
          'provider_product_catalog',
          {
            provider_account_id: providerAccountId,
            external_product_id: skuId,
            min_price_cents: priceCents,
            currency,
            qty: availableQuantity ?? -1,
            updated_at: now,
          },
          'provider_account_id,external_product_id',
        );
      } catch {
        // Non-critical — offer row already updated; catalog warmup is best-effort
      }
    }
  }

  logger.info('WGCards offer snapshot refresh complete', {
    requestId,
    providerAccountId,
    updated,
    failed,
    parentItems: byParent.size,
    skuCount: offerRows.length,
  });

  return { updated, failed };
}
