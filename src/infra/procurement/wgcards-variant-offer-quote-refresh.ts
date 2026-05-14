/**
 * WGCards offer snapshot refresh.
 *
 * `getItemAndStock` returns both live price and availability for all SKUs under
 * a parent item (SPU) in a single call. We group linked offers by their parent
 * item ID (`external_parent_product_id`) and call `getItemAndStock` once per
 * unique parent. Rate limit: 5 calls / 60 s (13 s inter-call gap → ≤4.6/60 s).
 *
 * Side-effect: also refreshes `provider_product_catalog.min_price_cents`, `qty`,
 * and `available_to_buy` for each SKU that appears in the response — these rows
 * are seeded with 0 / null by `getAllItem` (which carries no price or stock data).
 *
 * Flow per account:
 *   1. Gather active offer rows (external_offer_id = skuId, external_parent_product_id = itemId).
 *   2. For offers missing a parent ID, look it up from provider_product_catalog.
 *   3. Group offers by parent item ID; call getItemAndStock({ itemId, currencyCode: 'USD' }).
 *   4. Update provider_product_catalog rows with fresh price, qty, available_to_buy.
 *   5. Update provider_variant_offers rows with last_price_cents, available_quantity, last_checked_at.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import type { WgcardsManualBuyer } from './wgcards/wgcards-manual-buyer.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('wgcards-offer-refresh');

/** Keep well inside the 5 / 60 s rate limit (13 s gap → ≤ 4.6 calls / 60 s). */
const INTER_ITEM_DELAY_MS = 13_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WgcardsOfferRefreshRow {
  readonly id: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string;
  readonly currency: string | null;
  /** WGCards parent item (SPU) ID — the key for getItemAndStock. */
  external_parent_product_id?: string | null;
}

export interface WgcardsOfferRefreshResult {
  readonly updated: number;
  readonly failed: number;
}

/**
 * Resolves `external_parent_product_id` for offers that have it set to null/empty.
 * Falls back to `provider_product_catalog` via the skuId → external_parent_product_id link.
 */
async function resolveParentIds(
  db: IDatabase,
  providerAccountId: string,
  offers: readonly WgcardsOfferRefreshRow[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const needLookup: string[] = [];

  for (const offer of offers) {
    const parent = offer.external_parent_product_id?.trim();
    if (parent) {
      result.set(offer.external_offer_id.trim(), parent);
    } else {
      needLookup.push(offer.external_offer_id.trim());
    }
  }

  if (needLookup.length === 0) return result;

  try {
    const catalogRows = await db.queryAll<{
      external_product_id: string;
      external_parent_product_id: string | null;
    }>('provider_product_catalog', {
      select: 'external_product_id, external_parent_product_id',
      filter: { provider_account_id: providerAccountId },
      in: [['external_product_id', needLookup]],
    });

    for (const row of catalogRows) {
      const parent = row.external_parent_product_id?.trim();
      if (parent) result.set(row.external_product_id.trim(), parent);
    }
  } catch (err) {
    logger.warn('WGCards offer refresh: catalog parent ID lookup failed', err instanceof Error ? err : new Error(String(err)), {
      providerAccountId,
      needLookupCount: needLookup.length,
    });
  }

  return result;
}

/**
 * Refreshes `provider_variant_offers` rows for a single WGCards account.
 *
 * Calls `getItemAndStock` per unique parent item to obtain live prices and stock.
 * Also back-fills `provider_product_catalog.min_price_cents` / `qty` / `available_to_buy`
 * so those rows reflect real data instead of the zero-placeholder left by `getAllItem`.
 */
export async function refreshWgcardsOfferSnapshots(
  db: IDatabase,
  buyer: WgcardsManualBuyer,
  providerAccountId: string,
  offerRows: readonly WgcardsOfferRefreshRow[],
  requestId: string,
): Promise<WgcardsOfferRefreshResult> {
  if (offerRows.length === 0) return { updated: 0, failed: 0 };

  const parentIdBySkuId = await resolveParentIds(db, providerAccountId, offerRows);

  // Build parent → offers[] map, skipping offers with no resolvable parent ID.
  const offersByParent = new Map<string, WgcardsOfferRefreshRow[]>();
  let skippedNoParent = 0;
  for (const offer of offerRows) {
    const skuId = offer.external_offer_id.trim();
    const parentId = parentIdBySkuId.get(skuId);
    if (!parentId) {
      skippedNoParent++;
      logger.debug('WGCards offer refresh: no parent item ID, skipping', {
        requestId,
        offerRowId: offer.id,
        skuId,
      });
      continue;
    }
    const list = offersByParent.get(parentId) ?? [];
    list.push(offer);
    offersByParent.set(parentId, list);
  }

  if (skippedNoParent > 0) {
    logger.warn('WGCards offer refresh: some offers skipped — no external_parent_product_id in offers or catalog', {
      requestId,
      providerAccountId,
      skippedNoParent,
    });
  }

  let updated = 0;
  let failed = 0;
  const now = new Date().toISOString();
  let callIndex = 0;

  for (const [parentId, parentOffers] of offersByParent) {
    if (callIndex > 0) await sleep(INTER_ITEM_DELAY_MS);
    callIndex++;

    let skuInfoMap: Map<string, { priceCents: number; currency: string; stock: number }>;

    try {
      const page = await buyer.fetchItemPricesAndStock(parentId, 'USD');

      skuInfoMap = new Map();
      for (const item of page.records) {
        for (const sku of item.skuInfos ?? []) {
          const priceCents = sku.skuPrice > 0 ? Math.round(sku.skuPrice * 100) : 0;
          skuInfoMap.set(sku.skuId, {
            priceCents,
            currency: sku.skuPriceCurrency || 'USD',
            stock: sku.stock ?? 0,
          });
        }
      }

      logger.debug('WGCards getItemAndStock succeeded', {
        requestId,
        providerAccountId,
        parentId,
        skuCount: skuInfoMap.size,
      });
    } catch (err) {
      logger.warn('WGCards getItemAndStock failed for parent item', err instanceof Error ? err : new Error(String(err)), {
        requestId,
        providerAccountId,
        parentId,
        offersAffected: parentOffers.length,
      });
      failed += parentOffers.length;
      continue;
    }

    // Back-fill provider_product_catalog with fresh prices + stock.
    for (const [skuId, info] of skuInfoMap) {
      if (info.priceCents <= 0) continue; // no meaningful price to write
      try {
        await db.update(
          'provider_product_catalog',
          {
            provider_account_id: providerAccountId,
            external_product_id: skuId,
          } as Record<string, unknown>,
          {
            min_price_cents: info.priceCents,
            wholesale_price_cents: info.priceCents,
            qty: info.stock === -1 ? 999 : Math.max(0, info.stock),
            available_to_buy: info.stock === -1 || info.stock > 0,
            currency: info.currency,
            updated_at: now,
          },
        );
      } catch {
        // Catalog back-fill is best-effort; don't fail the offer update.
      }
    }

    // Update each offer row.
    for (const offer of parentOffers) {
      const skuId = offer.external_offer_id.trim();
      const info = skuInfoMap.get(skuId);

      if (!info) {
        logger.warn('WGCards offer refresh: skuId not found in getItemAndStock response', {
          requestId,
          offerRowId: offer.id,
          skuId,
          parentId,
        });
        failed++;
        continue;
      }

      // -1 = unlimited stock → null in our convention.
      const availableQuantity = info.stock === -1 ? null : info.stock;

      try {
        await db.update(
          'provider_variant_offers',
          { id: offer.id },
          {
            last_price_cents: info.priceCents > 0 ? info.priceCents : null,
            available_quantity: availableQuantity,
            currency: info.currency,
            last_checked_at: now,
            updated_at: now,
            // Persist the resolved parent ID so future refreshes skip the catalog lookup.
            ...(!offer.external_parent_product_id?.trim() ? { external_parent_product_id: parentId } : {}),
          },
        );
        updated++;
      } catch (err) {
        logger.warn('WGCards offer snapshot update failed', err instanceof Error ? err : new Error(String(err)), {
          requestId,
          offerRowId: offer.id,
          skuId,
        });
        failed++;
      }
    }
  }

  logger.info('WGCards offer snapshot refresh complete', {
    requestId,
    providerAccountId,
    updated,
    failed,
    skippedNoParent,
    parentItemsQueried: callIndex,
  });

  return { updated, failed };
}
