/**
 * Seller stock sync service — cron-driven stock refresh.
 *
 * Queries all active listings with auto_sync_stock=true, computes
 * available key count per variant, and calls marketplace adapter
 * declareStock() or syncStockLevel().
 *
 * Listings with listing_type=declared_stock and auto_sync_stock_follows_provider=true
 * use procurement `provider_variant_offers` supply when internal inventory is zero
 * (capped at MAX_PROCUREMENT_DECLARED_STOCK).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../../../core/ports/marketplace-adapter.port.js';
import type { ISellerStockSyncService, RefreshStockResult } from '../../../core/ports/seller-pricing.port.js';
import { computeDeclaredStockTarget } from '../../../core/shared/procurement-declared-stock.js';
import { loadBestProcurementQtyByVariant } from '../load-procurement-offer-supply.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('seller-stock-sync');

interface StockListingRow {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_listing_id: string | null;
  listing_type: string;
  status: string;
  declared_stock: number;
  provider_code: string;
  follows_provider: boolean;
}

@injectable()
export class SellerStockSyncService implements ISellerStockSyncService {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private registry: IMarketplaceAdapterRegistry,
  ) {}

  async refreshAllStock(requestId: string): Promise<RefreshStockResult> {
    const listings = await this.getAutoSyncStockListings();
    if (!listings.length) {
      logger.info('No active auto-sync-stock listings', { requestId });
      return { listingsProcessed: 0, stockUpdated: 0, errors: 0 };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const stockMap = await this.computeAvailableStock(variantIds);

    const variantIdsProcurement = [
      ...new Set(
        listings
          .filter((l) => l.listing_type === 'declared_stock' && l.follows_provider)
          .map((l) => l.variant_id),
      ),
    ];
    const procurementMap = await loadBestProcurementQtyByVariant(this.db, variantIdsProcurement);

    const result: RefreshStockResult = { listingsProcessed: 0, stockUpdated: 0, errors: 0 };

    for (const listing of listings) {
      result.listingsProcessed++;
      if (!listing.external_listing_id) continue;

      try {
        const internalQty = stockMap.get(listing.variant_id) ?? 0;
        const procurementQty = procurementMap.get(listing.variant_id);
        const targetQty = computeDeclaredStockTarget({
          internalQty,
          procurementQtyRaw: procurementQty,
          followsProvider: listing.follows_provider,
          listingType: listing.listing_type,
        });

        if (listing.listing_type === 'declared_stock') {
          const adapter = this.registry.getDeclaredStockAdapter(listing.provider_code);
          if (!adapter) continue;

          if (targetQty !== listing.declared_stock) {
            const declareResult = await adapter.declareStock(listing.external_listing_id, targetQty);
            if (declareResult.success) {
              await this.db.update('seller_listings', { id: listing.id }, {
                declared_stock: targetQty,
                last_synced_at: new Date().toISOString(),
                error_message: null,
              });
              result.stockUpdated++;
            }
          }
        } else {
          const adapter = this.registry.getStockSyncAdapter(listing.provider_code);
          if (!adapter) continue;

          const syncResult = await adapter.syncStockLevel(listing.external_listing_id, internalQty);
          if (syncResult.success) {
            await this.db.update('seller_listings', { id: listing.id }, {
              declared_stock: internalQty,
              last_synced_at: new Date().toISOString(),
              error_message: null,
            });
            result.stockUpdated++;
          }
        }
      } catch (err) {
        result.errors++;
        const errMsg = err instanceof Error ? err.message : String(err);
        // Circuit-breaker / rate-limit failures are expected operational state when an
        // upstream marketplace is degraded; log as warn so they don't fire Sentry alerts.
        // Real adapter/contract errors stay at error level.
        const errName = err instanceof Error ? err.name : '';
        const isTransient =
          errName === 'CircuitOpenError' ||
          errName === 'RateLimitExceededError' ||
          /^Circuit breaker open for /.test(errMsg) ||
          /^Rate limit exceeded for /.test(errMsg);
        const logFn = isTransient ? logger.warn.bind(logger) : logger.error.bind(logger);
        logFn('Failed to sync stock for listing', {
          requestId, listingId: listing.id,
          error: errMsg,
          transient: isTransient,
        });
        try {
          await this.db.update('seller_listings', { id: listing.id }, {
            error_message: `Stock sync failed: ${errMsg || 'unknown'}`,
            last_synced_at: new Date().toISOString(),
          });
        } catch { /* swallow update error */ }
      }
    }

    logger.info('Stock sync refresh complete', { requestId, ...result });
    return result;
  }

  private async computeAvailableStock(variantIds: string[]): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();
    if (variantIds.length === 0) return stockMap;

    try {
      const data = await this.db.rpc<Array<{ variant_id: string; available_count: number }>>(
        'get_batch_available_keys_count',
        { variant_uuids: variantIds },
      );

      for (const row of data ?? []) {
        stockMap.set(row.variant_id, row.available_count);
      }
    } catch (err) {
      logger.error('Failed to compute available stock', {
        variantCount: variantIds.length,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return stockMap;
  }

  private async getAutoSyncStockListings(): Promise<StockListingRow[]> {
    const rows = await this.db.query<Record<string, unknown>>('seller_listings', {
      eq: [
        ['auto_sync_stock', true],
      ],
    });

    const activeOrPaused = rows.filter((r) =>
      r.status === 'active' || r.status === 'paused',
    );

    const accountIds = [...new Set(activeOrPaused.map((r) => r.provider_account_id as string))];
    const accountMap = new Map<string, string>();

    for (const accountId of accountIds) {
      const account = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
        filter: { id: accountId },
      });
      if (account) accountMap.set(accountId, account.provider_code);
    }

    const enriched: StockListingRow[] = [];
    for (const row of activeOrPaused) {
      const providerCode = accountMap.get(row.provider_account_id as string);
      if (!providerCode) continue;
      enriched.push({
        id: row.id as string,
        variant_id: row.variant_id as string,
        provider_account_id: row.provider_account_id as string,
        external_listing_id: (row.external_listing_id as string) ?? null,
        listing_type: row.listing_type as string,
        status: row.status as string,
        declared_stock: (row.declared_stock as number) ?? 0,
        provider_code: providerCode,
        follows_provider: row.auto_sync_stock_follows_provider === true,
      });
    }

    return enriched;
  }
}
