/**
 * HTTP cron entry: reconcile declared_stock on seller listings that mirror procurement supply.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase, QueryOptions } from '../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import type {
  IProcurementDeclaredStockReconcileService,
  ProcurementDeclaredStockReconcileDto,
  ProcurementDeclaredStockReconcileFailure,
  ProcurementDeclaredStockReconcileResult,
} from '../../core/ports/procurement-declared-stock-reconcile.port.js';
import { computeDeclaredStockTarget } from '../../core/shared/procurement-declared-stock.js';
import { loadBestProcurementQtyByVariant } from './load-procurement-offer-supply.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('procurement-declared-stock-reconcile');

const DEFAULT_BATCH_LIMIT = 500;

interface ListingRow {
  readonly id: string;
  readonly variant_id: string;
  readonly provider_account_id: string;
  readonly external_listing_id: string | null;
  readonly listing_type: string;
  readonly status: string;
  readonly declared_stock: number;
  readonly auto_sync_stock_follows_provider: boolean;
}

@injectable()
export class ProcurementDeclaredStockReconcileService implements IProcurementDeclaredStockReconcileService {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private readonly registry: IMarketplaceAdapterRegistry,
  ) {}

  async execute(requestId: string, dto: ProcurementDeclaredStockReconcileDto): Promise<ProcurementDeclaredStockReconcileResult> {
    const batchLimit = Math.min(Math.max(dto.batch_limit ?? DEFAULT_BATCH_LIMIT, 1), 5000);
    const dryRun = dto.dry_run === true;

    const listings = await this.loadEligibleListings(dto.variant_ids, batchLimit);
    if (listings.length === 0) {
      logger.info('No eligible procurement-linked seller listings', { requestId });
      return { dry_run: dryRun, scanned: 0, updated: 0, skipped: 0, failures: [] };
    }

    const variantIds = [...new Set(listings.map((l) => l.variant_id))];
    const internalMap = await this.computeAvailableStock(variantIds);
    const procurementMap = await loadBestProcurementQtyByVariant(this.db, variantIds);

    const accountIds = [...new Set(listings.map((l) => l.provider_account_id))];
    const accountCodes = await this.loadProviderCodes(accountIds);

    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    const failures: ProcurementDeclaredStockReconcileFailure[] = [];

    for (const listing of listings) {
      scanned++;
      const providerCode = accountCodes.get(listing.provider_account_id);
      if (!providerCode) {
        skipped++;
        continue;
      }
      if (!listing.external_listing_id) {
        skipped++;
        continue;
      }
      if (listing.listing_type !== 'declared_stock') {
        skipped++;
        continue;
      }

      const internalQty = internalMap.get(listing.variant_id) ?? 0;
      const procurementQty = procurementMap.get(listing.variant_id);
      const targetQty = computeDeclaredStockTarget({
        internalQty,
        procurementQtyRaw: procurementQty,
        followsProvider: listing.auto_sync_stock_follows_provider === true,
        listingType: listing.listing_type,
      });

      // Do not skip when target matches `seller_listings.declared_stock`. That column can match
      // the computed target while Eneba is still wrong (never pushed, partial failure, or manual
      // drift). This job must call declareStock to reconcile marketplace state.

      const adapter = this.registry.getDeclaredStockAdapter(providerCode);
      if (!adapter) {
        failures.push({
          listing_id: listing.id,
          reason: `no_declared_stock_adapter:${providerCode}`,
        });
        continue;
      }

      if (dryRun) {
        updated++;
        continue;
      }

      try {
        logger.info('Procurement reconcile pushing declared stock', {
          requestId,
          listingId: listing.id,
          providerCode,
          auctionId: listing.external_listing_id,
          targetQty,
          internalQty,
          procurementQty: procurementQty ?? null,
          dbDeclaredStock: listing.declared_stock,
        });
        const declareResult = await adapter.declareStock(listing.external_listing_id, targetQty);
        if (!declareResult.success) {
          failures.push({
            listing_id: listing.id,
            reason: declareResult.error ?? 'declare_stock_failed',
          });
          await this.db.update('seller_listings', { id: listing.id }, {
            error_message: `Procurement stock reconcile failed: ${declareResult.error ?? 'unknown'}`,
            last_synced_at: new Date().toISOString(),
          });
          continue;
        }

        const appliedQty = typeof declareResult.declaredQuantity === 'number' && Number.isFinite(declareResult.declaredQuantity)
          ? declareResult.declaredQuantity
          : targetQty;
        if (appliedQty !== targetQty) {
          // Marketplaces routinely cap declared quantities (e.g. Kinguin caps at 20 per
          // listing). This is normal operational behavior — not actionable — so we keep
          // it as `info` to avoid Sentry noise. The applied qty is persisted on the
          // listing row below for any downstream review.
          logger.info('Marketplace applied declared qty differs from target (provider cap or API behavior)', {
            requestId,
            listingId: listing.id,
            providerCode,
            targetQty,
            appliedQty,
          });
        }

        await this.db.update('seller_listings', { id: listing.id }, {
          declared_stock: appliedQty,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        });
        updated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const errName = err instanceof Error ? err.name : '';
        // Transient operational failures from upstream marketplaces (circuit breaker
        // open, rate-limit exceeded) are expected when a provider degrades. They are
        // already (a) recorded on the failures[] result returned to the caller and
        // (b) persisted on the listing's `error_message` column below for admin
        // visibility. Logging them at `info` keeps them out of Sentry — sustained
        // breaker-open state is a separate, dedicated alert. Real errors stay at
        // error so they continue to surface.
        const isTransient =
          errName === 'CircuitOpenError' ||
          errName === 'RateLimitExceededError' ||
          /^Circuit breaker open for /.test(msg) ||
          /^Rate limit exceeded for /.test(msg);
        failures.push({ listing_id: listing.id, reason: msg });
        const logFn = isTransient ? logger.info.bind(logger) : logger.error.bind(logger);
        logFn('Procurement declared stock reconcile failed', {
          requestId,
          listingId: listing.id,
          error: msg,
          transient: isTransient,
        });
        try {
          await this.db.update('seller_listings', { id: listing.id }, {
            error_message: `Procurement stock reconcile failed: ${msg}`,
            last_synced_at: new Date().toISOString(),
          });
        } catch {
          /* swallow */
        }
      }
    }

    logger.info('Procurement declared stock reconcile complete', {
      requestId,
      dryRun,
      scanned,
      updated,
      skipped,
      failures: failures.length,
    });

    return { dry_run: dryRun, scanned, updated, skipped, failures };
  }

  private async loadEligibleListings(
    variantIds: readonly string[] | undefined,
    batchLimit: number,
  ): Promise<ListingRow[]> {
    const eq: Array<[string, unknown]> = [
      ['auto_sync_stock', true],
      ['listing_type', 'declared_stock'],
      ['auto_sync_stock_follows_provider', true],
    ];

    const baseOpts: QueryOptions = { eq };
    if (variantIds && variantIds.length > 0) {
      baseOpts.in = [['variant_id', [...variantIds]]];
    }

    const rows = await this.db.query<Record<string, unknown>>('seller_listings', baseOpts);

    const activeOrPaused = rows.filter((r) => r.status === 'active' || r.status === 'paused');

    const mapped: ListingRow[] = activeOrPaused.map((r) => ({
      id: r.id as string,
      variant_id: r.variant_id as string,
      provider_account_id: r.provider_account_id as string,
      external_listing_id: (r.external_listing_id as string | null) ?? null,
      listing_type: r.listing_type as string,
      status: r.status as string,
      declared_stock: typeof r.declared_stock === 'number' ? r.declared_stock : 0,
      auto_sync_stock_follows_provider: r.auto_sync_stock_follows_provider === true,
    }));

    return mapped.slice(0, batchLimit);
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

  private async loadProviderCodes(accountIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = [...new Set(accountIds)];
    const BATCH = 100;
    for (let i = 0; i < unique.length; i += BATCH) {
      const chunk = unique.slice(i, i + BATCH);
      const rows = await this.db.query<{ id: string; provider_code: string }>('provider_accounts', {
        select: 'id, provider_code',
        in: [['id', chunk]],
      });
      for (const r of rows) {
        map.set(r.id, r.provider_code);
      }
    }
    return map;
  }
}
