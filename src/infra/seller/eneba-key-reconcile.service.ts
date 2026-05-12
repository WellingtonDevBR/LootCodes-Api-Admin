/**
 * Eneba key inventory reconciliation service.
 *
 * Runs as the `eneba-key-reconcile` phase in the seller housekeeping cron.
 * Compares our internal key provisions against Eneba's live `S_keys` data.
 *
 * Two reconciliation passes per listing (combined into a single efficient scan):
 *
 * Pass 1 — REPORTED keys (query by stockId, state: REPORTED)
 *   → Hash the plaintext key value (SHA-256) → look up product_keys.raw_key_hash
 *   → Mark matching key `faulty`.
 *
 * Pass 2 — Orphaned provisions (our DB shows `delivered`, Eneba says not SOLD)
 *   → Load delivered provisions within LOOKBACK_DAYS whose reservation is
 *     still `provisioned` (CANCEL never processed correctly).
 *   → ONLY verifiable provisions (those with a stored raw_key_hash) are checked.
 *     Provisions without a hash cannot be matched against Eneba's returned key values
 *     and are skipped with an info log to prevent false-positive restocks.
 *   → Batch-query Eneba `S_keys(ordersNumbers: [...])` per provision's
 *     external_order_id.
 *   → Provisions whose key Eneba returns as SOLD/REPORTED = delivered correctly
 *     (REPORTED provisions are also marked faulty here).
 *   → Provisions whose order Eneba returns nothing for = orphaned → restock key.
 *
 * Batch-safety:
 *   - All raw_key_hash lookups are pre-loaded in one DB query (no per-key loops).
 *   - getKeysByOrders batched in groups of MAX_ORDER_BATCH.
 *   - Per-listing errors are isolated; other listings still run.
 *
 * Financial note:
 *   When orphans are restocked, a Sentry-visible warning is emitted.
 *   Admins must verify the associated order has a matching debit transaction.
 *   The CANCEL webhook (if it eventually arrives) creates that debit; this cron
 *   only corrects the physical key state — it does NOT create financial ledger entries.
 */
import { createHash } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import type { IEnebaKeyReconcileService, EnebaKeyReconcileResult } from '../../core/ports/eneba-key-reconcile.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('eneba-key-reconcile');

/** Only check provisions created within this many days to avoid touching settled records. */
const LOOKBACK_DAYS = 14;

/** Max Eneba order IDs per `getKeysByOrders` API call. */
const MAX_ORDER_BATCH = 50;

/**
 * Key states the batch_restock_seller_keys / restock_seller_key RPCs accept.
 * Must match the function's `p_restockable_states` filter.
 */
const RESTOCKABLE_STATES = ['seller_provisioned', 'seller_reserved', 'seller_uploaded'];

interface EnebaListingRow {
  id: string;
  external_listing_id: string;
}

interface ProvisionedReservation {
  id: string;
  external_order_id: string;
}

interface DeliveredProvision {
  id: string;
  product_key_id: string;
  reservation_id: string;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

@injectable()
export class EnebaKeyReconcileService implements IEnebaKeyReconcileService {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private readonly registry: IMarketplaceAdapterRegistry,
  ) {}

  async execute(requestId: string): Promise<EnebaKeyReconcileResult> {
    const result: EnebaKeyReconcileResult = {
      listings_checked: 0,
      reported_keys_found: 0,
      reported_keys_marked_faulty: 0,
      orphaned_provisions_found: 0,
      orphaned_provisions_restocked: 0,
    };

    const enebaAdapter = this.registry.getKeyReconcileAdapter('eneba');
    if (!enebaAdapter) {
      logger.warn('[eneba-key-reconcile] Eneba key-reconcile adapter not registered — skipping', { requestId });
      return result;
    }

    const listings = await this.loadEnebaListings();
    if (listings.length === 0) {
      logger.info('[eneba-key-reconcile] No active Eneba declared_stock listings found', { requestId });
      return result;
    }

    logger.info('[eneba-key-reconcile] Starting reconciliation', {
      requestId,
      listingCount: listings.length,
    });

    for (const listing of listings) {
      try {
        const sub = await this.reconcileListing(requestId, listing, enebaAdapter);
        result.listings_checked++;
        result.reported_keys_found += sub.reported_keys_found;
        result.reported_keys_marked_faulty += sub.reported_keys_marked_faulty;
        result.orphaned_provisions_found += sub.orphaned_provisions_found;
        result.orphaned_provisions_restocked += sub.orphaned_provisions_restocked;
      } catch (err) {
        logger.error('[eneba-key-reconcile] Listing reconciliation failed — skipping', err as Error, {
          requestId,
          listingId: listing.id,
          externalListingId: listing.external_listing_id,
        });
      }
    }

    logger.info('[eneba-key-reconcile] Reconciliation complete', { requestId, ...result });
    return result;
  }

  // ─── Per-listing reconciliation ─────────────────────────────────────

  private async reconcileListing(
    requestId: string,
    listing: EnebaListingRow,
    adapter: NonNullable<ReturnType<typeof this.registry.getKeyReconcileAdapter>>,
  ): Promise<EnebaKeyReconcileResult> {
    const sub: EnebaKeyReconcileResult = {
      listings_checked: 0,
      reported_keys_found: 0,
      reported_keys_marked_faulty: 0,
      orphaned_provisions_found: 0,
      orphaned_provisions_restocked: 0,
    };

    // ── Pre-load delivered provisions + key hashes in one pass ────────
    const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const reservations = await this.loadProvisionedReservations(listing.id, cutoff);
    const reservationMap = new Map<string, ProvisionedReservation>(
      reservations.map((r) => [r.id, r]),
    );

    const deliveredProvisions = await this.loadDeliveredProvisions(reservations.map((r) => r.id));

    // Batch-load raw_key_hash for all provision keys in one query — no per-key loops
    const keyHashes = await this.loadKeyHashes(deliveredProvisions.map((p) => p.product_key_id));
    // hash → provision (for O(1) lookup when iterating Eneba keys)
    const hashToProvision = new Map<string, DeliveredProvision>();
    for (const prov of deliveredProvisions) {
      const hash = keyHashes.get(prov.product_key_id);
      if (hash) hashToProvision.set(hash, prov);
    }

    // Pass 2 can only verify provisions whose key has a stored hash.
    // Keys without raw_key_hash cannot be matched against Eneba returned values — they
    // would always appear "orphaned" regardless of their actual state, causing false restocks.
    const provisionIdsWithHash = new Set(Array.from(hashToProvision.values()).map((p) => p.id));
    const verifiableProvisions = deliveredProvisions.filter((p) => provisionIdsWithHash.has(p.id));
    const unverifiableCount = deliveredProvisions.length - verifiableProvisions.length;
    if (unverifiableCount > 0) {
      logger.info('[eneba-key-reconcile] Provisions skipped — key has no raw_key_hash, cannot verify against Eneba', {
        requestId,
        listingId: listing.id,
        skippedCount: unverifiableCount,
        totalDelivered: deliveredProvisions.length,
      });
    }

    // ── Pass 1: REPORTED keys (query by stockId, state=REPORTED) ──────
    const { keys: reportedKeys } = await adapter.getAllStockKeys(listing.external_listing_id, 'REPORTED');
    sub.reported_keys_found = reportedKeys.length;

    for (const enebaKey of reportedKeys) {
      if (!enebaKey.value) continue;
      const hash = sha256Hex(enebaKey.value);

      // Fast path: provision key hash already loaded
      const knownProv = hashToProvision.get(hash);
      if (knownProv) {
        await this.markKeyFaulty(requestId, knownProv.product_key_id, enebaKey.reportReason, listing.id);
        sub.reported_keys_marked_faulty++;
        continue;
      }

      // Slow path: REPORTED key is outside our lookback window or from a different listing
      const dbKey = await this.db.queryOne<{ id: string; key_state: string }>('product_keys', {
        select: 'id, key_state',
        filter: { raw_key_hash: hash },
      });
      if (!dbKey) {
        logger.warn('[eneba-key-reconcile] Reported key not found in product_keys by hash', {
          requestId,
          listingId: listing.id,
          enebaKeyId: enebaKey.id,
        });
        continue;
      }
      if (dbKey.key_state !== 'faulty') {
        await this.markKeyFaulty(requestId, dbKey.id, enebaKey.reportReason, listing.id);
        sub.reported_keys_marked_faulty++;
      } else {
        sub.reported_keys_marked_faulty++;
      }
    }

    if (verifiableProvisions.length === 0) return sub;

    // ── Pass 2: Orphaned provisions (delivered here, not SOLD on Eneba) ─
    // Only check verifiable provisions (those with a known raw_key_hash).
    // Provisions without a hash are excluded above to prevent false-positive restocks.
    const externalOrderIds = [
      ...new Set(
        verifiableProvisions
          .map((p) => reservationMap.get(p.reservation_id)?.external_order_id)
          .filter((id): id is string => !!id),
      ),
    ];

    if (externalOrderIds.length === 0) return sub;

    // Batch-query Eneba by order numbers. Build confirmed-delivered set (SOLD or REPORTED).
    // We use the hash map to trace each returned Eneba key back to our provision.
    const confirmedProvisionIds = new Set<string>();
    const reportedViaOrdersProvisionIds = new Set<string>();

    for (const batch of chunk(externalOrderIds, MAX_ORDER_BATCH)) {
      try {
        const { keys } = await adapter.getKeysByOrders(batch);
        for (const enebaKey of keys) {
          if (!enebaKey.value) continue;
          const hash = sha256Hex(enebaKey.value);
          const prov = hashToProvision.get(hash);
          if (!prov) continue;
          if (enebaKey.state === 'SOLD') {
            confirmedProvisionIds.add(prov.id);
          } else if (enebaKey.state === 'REPORTED') {
            confirmedProvisionIds.add(prov.id);
            reportedViaOrdersProvisionIds.add(prov.id);
          }
        }
      } catch (err) {
        logger.warn('[eneba-key-reconcile] getKeysByOrders batch failed — skipping batch', err as Error, {
          requestId,
          listingId: listing.id,
          batchSize: batch.length,
        });
      }
    }

    // Mark REPORTED provisions as faulty (complement Pass 1 for within-lookback-window keys)
    for (const provId of reportedViaOrdersProvisionIds) {
      const prov = deliveredProvisions.find((p) => p.id === provId);
      if (prov) {
        await this.markKeyFaulty(requestId, prov.product_key_id, 'Eneba buyer report (detected via order query)', listing.id);
      }
    }

    // Orphaned = verifiable provisions NOT confirmed as SOLD or REPORTED on Eneba
    const orphanedProvisions = verifiableProvisions.filter((p) => !confirmedProvisionIds.has(p.id));
    sub.orphaned_provisions_found = orphanedProvisions.length;

    if (orphanedProvisions.length === 0) return sub;

    logger.warn('[eneba-key-reconcile] Orphaned provisions found — keys provided but not SOLD on Eneba', {
      requestId,
      listingId: listing.id,
      count: orphanedProvisions.length,
      provisionIds: orphanedProvisions.map((p) => p.id),
    });

    sub.orphaned_provisions_restocked = await this.restockOrphanedProvisions(
      requestId,
      listing.id,
      orphanedProvisions,
    );

    return sub;
  }

  // ─── Restock orphaned keys ───────────────────────────────────────────

  private async restockOrphanedProvisions(
    requestId: string,
    listingId: string,
    provisions: DeliveredProvision[],
  ): Promise<number> {
    const keyIds = provisions.map((p) => p.product_key_id);
    let restockedCount = 0;

    try {
      const restocked = await this.db.rpc<Array<{ id: string }>>('batch_restock_seller_keys', {
        p_key_ids: keyIds,
        p_restockable_states: RESTOCKABLE_STATES,
      });
      restockedCount = Array.isArray(restocked) ? restocked.length : 0;
    } catch (batchErr) {
      logger.warn(
        '[eneba-key-reconcile] batch_restock_seller_keys failed; trying per-key fallback',
        batchErr as Error,
        { requestId, listingId, keyCount: keyIds.length },
      );
      for (const keyId of keyIds) {
        try {
          const r = await this.db.rpc<{ success: boolean }>('restock_seller_key', {
            p_key_id: keyId,
            p_restockable_states: RESTOCKABLE_STATES,
          });
          if (r?.success) restockedCount++;
        } catch (perKeyErr) {
          logger.warn('[eneba-key-reconcile] Per-key restock failed', perKeyErr as Error, {
            keyId, requestId,
          });
        }
      }
    }

    if (restockedCount === 0) return 0;

    // Flip provisions delivered → refunded
    for (const prov of provisions) {
      await this.db
        .update('seller_key_provisions', { id: prov.id, status: 'delivered' }, { status: 'refunded' })
        .catch((err) =>
          logger.warn('[eneba-key-reconcile] Failed to flip provision to refunded', err as Error, {
            provisionId: prov.id, requestId,
          }),
        );
    }

    // Cancel the affected reservations
    const reservationIds = [...new Set(provisions.map((p) => p.reservation_id))];
    for (const resId of reservationIds) {
      await this.db
        .update('seller_stock_reservations', { id: resId, status: 'provisioned' }, { status: 'cancelled' })
        .catch((err) =>
          logger.warn('[eneba-key-reconcile] Failed to cancel orphaned reservation', err as Error, {
            reservationId: resId, requestId,
          }),
        );
    }

    logger.warn(
      '[eneba-key-reconcile] Orphaned provisions restocked — check orders for missing debit transactions',
      {
        requestId,
        listingId,
        restockedCount,
        provisionIds: provisions.map((p) => p.id),
        reservationIds,
        action: 'MANUAL_REVIEW_REQUIRED: verify associated orders have matching debit transactions',
      },
    );

    return restockedCount;
  }

  // ─── Mark key faulty ─────────────────────────────────────────────────

  private async markKeyFaulty(
    requestId: string,
    keyId: string,
    reportReason: string | null | undefined,
    listingId: string,
  ): Promise<void> {
    const reason = reportReason
      ? `Eneba buyer report: ${reportReason}`
      : 'Eneba buyer report (no reason provided)';

    // Fetch current state to skip no-op updates and get log context
    const dbKey = await this.db.queryOne<{ id: string; key_state: string }>('product_keys', {
      select: 'id, key_state',
      filter: { id: keyId },
    });

    if (!dbKey || dbKey.key_state === 'faulty') return;

    await this.db
      .update(
        'product_keys',
        { id: keyId },
        {
          key_state: 'faulty',
          marked_faulty_at: new Date().toISOString(),
          marked_faulty_reason: reason,
        },
      )
      .catch((err) =>
        logger.error('[eneba-key-reconcile] Failed to mark key faulty', err as Error, {
          keyId, requestId, listingId,
        }),
      );

    logger.info('[eneba-key-reconcile] Marked key faulty (Eneba buyer report)', {
      requestId,
      keyId,
      prevState: dbKey.key_state,
      reason,
      listingId,
    });
  }

  // ─── Data loaders ─────────────────────────────────────────────────────

  private async loadEnebaListings(): Promise<EnebaListingRow[]> {
    const rows = await this.db.query<{
      id: string;
      external_listing_id: string | null;
      provider_account_id: string;
    }>('seller_listings', {
      select: 'id, external_listing_id, provider_account_id',
      eq: [
        ['status', 'active'],
        ['listing_type', 'declared_stock'],
      ],
    });

    // Resolve provider_code for all unique accounts in one batch query
    const accountIds = [...new Set(rows.map((r) => r.provider_account_id))];
    const accountMap = new Map<string, string>();
    if (accountIds.length > 0) {
      const accounts = await this.db.query<{ id: string; provider_code: string }>('provider_accounts', {
        select: 'id, provider_code',
        in: [['id', accountIds]],
      });
      for (const a of accounts) accountMap.set(a.id, a.provider_code);
    }

    return rows
      .filter((r) => r.external_listing_id && accountMap.get(r.provider_account_id) === 'eneba')
      .map((r) => ({
        id: r.id,
        external_listing_id: r.external_listing_id as string,
      }));
  }

  private async loadProvisionedReservations(
    listingId: string,
    cutoff: string,
  ): Promise<ProvisionedReservation[]> {
    const rows = await this.db.query<{
      id: string;
      external_order_id: string | null;
    }>('seller_stock_reservations', {
      select: 'id, external_order_id',
      eq: [
        ['seller_listing_id', listingId],
        ['status', 'provisioned'],
      ],
      gte: [['created_at', cutoff]],
    });

    return rows
      .filter((r): r is { id: string; external_order_id: string } => r.external_order_id != null)
      .map((r) => ({
        id: r.id,
        external_order_id: r.external_order_id,
      }));
  }

  private async loadDeliveredProvisions(reservationIds: string[]): Promise<DeliveredProvision[]> {
    if (reservationIds.length === 0) return [];
    // reservation_id is nullable on seller_key_provisions — null rows won't match IN clause
    const rows = await this.db.query<{
      id: string;
      product_key_id: string;
      reservation_id: string | null;
    }>('seller_key_provisions', {
      select: 'id, product_key_id, reservation_id',
      eq: [['status', 'delivered']],
      in: [['reservation_id', reservationIds]],
    });

    return rows
      .filter((r): r is DeliveredProvision & { reservation_id: string } => r.reservation_id != null)
      .map((r) => ({
        id: r.id,
        product_key_id: r.product_key_id,
        reservation_id: r.reservation_id,
      }));
  }

  /**
   * Batch-load raw_key_hash for multiple product_key ids in a single DB query.
   * Returns Map<key_id, hash>. Keys with null hashes are omitted.
   */
  private async loadKeyHashes(keyIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (keyIds.length === 0) return out;

    const rows = await this.db.query<{ id: string; raw_key_hash: string | null }>(
      'product_keys',
      {
        select: 'id, raw_key_hash',
        in: [['id', keyIds]],
      },
    );

    for (const r of rows) {
      if (r.raw_key_hash) out.set(r.id, r.raw_key_hash);
    }
    return out;
  }
}
