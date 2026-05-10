/**
 * Single orchestrated cron entry point for seller-side marketplace maintenance.
 *
 * Runs the following phases per request, in order:
 *   1. expire-reservations    — release stale `seller_stock_reservations`
 *   2. cost-basis             — refresh `seller_listings.cost_basis_cents` from
 *                               the AVERAGE real cost of available keys (or
 *                               cheapest active buyer offer for declared-stock
 *                               listings with no physical inventory)
 *   3. pricing                — recompute prices (manual + strategy + smart) and
 *                               push to marketplaces
 *   4. declared-stock         — reconcile declared-stock target and push to
 *                               marketplaces
 *   5. remote-stock           — pull remote stock for `auto_sync_stock=true`
 *                               listings
 *   6. paused-listing-alerts  — sync `admin_alerts` of type `seller_listing_paused`
 *                               so the CRM surfaces every paused/failed listing
 *                               as an actionable alert
 *
 * NOT gated by `platform_settings.fulfillment_mode` — that flag controls
 * user-facing checkout/key delivery, not admin-owned marketplace listings.
 *
 * Live buyer-catalog quote refresh is owned by the standalone
 * `POST /internal/cron/sync-buyer-catalog` endpoint and is intentionally
 * NOT a phase here — schedule that endpoint independently (recommended
 * cadence: every 5 minutes, immediately before this cron).
 *
 * Per-phase failures are isolated: one phase's exception is logged and
 * recorded in the result's PhaseOutcome.error, but does not abort later phases.
 */
import { injectable, inject } from 'tsyringe';
import { UC_TOKENS, TOKENS } from '../../../di/tokens.js';
import type {
  ISellerAutoPricingService,
  ISellerStockSyncService,
} from '../../ports/seller-pricing.port.js';
import type { IProcurementDeclaredStockReconcileService } from '../../ports/procurement-declared-stock-reconcile.port.js';
import { ExpireReservationsUseCase } from './expire-reservations.use-case.js';
import { SyncSellerListingPausedAlertsUseCase } from './sync-seller-listing-paused-alerts.use-case.js';
import {
  RECONCILE_PHASES,
  type PhaseOutcome,
  type ReconcilePhase,
  type ReconcileSellerListingsDto,
  type ReconcileSellerListingsResult,
} from './reconcile-seller-listings.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('reconcile-seller-listings');

@injectable()
export class ReconcileSellerListingsUseCase {
  constructor(
    @inject(TOKENS.SellerAutoPricingService)
    private readonly autoPricing: ISellerAutoPricingService,
    @inject(TOKENS.ProcurementDeclaredStockReconcileService)
    private readonly declaredStock: IProcurementDeclaredStockReconcileService,
    @inject(TOKENS.SellerStockSyncService)
    private readonly stockSync: ISellerStockSyncService,
    @inject(UC_TOKENS.ExpireReservations)
    private readonly expireReservations: ExpireReservationsUseCase,
    @inject(UC_TOKENS.SyncSellerListingPausedAlerts)
    private readonly syncPausedAlerts: SyncSellerListingPausedAlertsUseCase,
  ) {}

  async execute(
    requestId: string,
    dto: ReconcileSellerListingsDto,
  ): Promise<ReconcileSellerListingsResult> {
    const startedAt = Date.now();
    const phases = makeEmptyPhases();

    const allowed = resolveAllowedPhases(dto.phases);
    logger.info('Starting reconcile-seller-listings run', {
      requestId,
      phases: [...allowed],
      dryRun: dto.dry_run === true,
      variantFilterCount: dto.variant_ids?.length ?? 0,
    });

    for (const phase of RECONCILE_PHASES) {
      if (!allowed.has(phase)) {
        phases[phase] = { ran: false, skipped_reason: 'phase_filter', duration_ms: 0 };
        continue;
      }
      phases[phase] = await this.runPhase(phase, requestId, dto);
    }

    return finalize(requestId, phases, startedAt);
  }

  private async runPhase(
    phase: ReconcilePhase,
    requestId: string,
    dto: ReconcileSellerListingsDto,
  ): Promise<PhaseOutcome> {
    const phaseStart = Date.now();
    try {
      const result = await this.dispatch(phase, requestId, dto);
      const duration = Date.now() - phaseStart;
      logger.info('Phase complete', { requestId, phase, durationMs: duration });
      return { ran: true, result, duration_ms: duration };
    } catch (err) {
      const duration = Date.now() - phaseStart;
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Phase '${phase}' failed`, err as Error, { requestId, phase });
      return { ran: true, error: message, duration_ms: duration };
    }
  }

  private async dispatch(
    phase: ReconcilePhase,
    requestId: string,
    dto: ReconcileSellerListingsDto,
  ): Promise<unknown> {
    switch (phase) {
      case 'expire-reservations':
        return this.expireReservations.execute({ admin_id: requestId });
      case 'cost-basis':
        return this.autoPricing.refreshAllCostBases(requestId);
      case 'pricing':
        return this.autoPricing.refreshAllPrices(requestId);
      case 'declared-stock':
        return this.declaredStock.execute(requestId, {
          variant_ids: dto.variant_ids,
          dry_run: dto.dry_run,
          batch_limit: dto.batch_limit,
        });
      case 'remote-stock':
        return this.stockSync.refreshAllStock(requestId);
      case 'paused-listing-alerts':
        return this.syncPausedAlerts.execute();
    }
  }
}

function makeEmptyPhases(): Record<ReconcilePhase, PhaseOutcome> {
  const out = {} as Record<ReconcilePhase, PhaseOutcome>;
  for (const phase of RECONCILE_PHASES) {
    out[phase] = { ran: false, duration_ms: 0 };
  }
  return out;
}

function resolveAllowedPhases(
  filter: readonly ReconcilePhase[] | undefined,
): ReadonlySet<ReconcilePhase> {
  // `undefined` = caller did not specify a filter → run every phase.
  // An explicit (possibly empty) array is honoured as-is so callers can
  // intentionally request a no-op run without us silently falling back
  // to "run everything".
  if (filter == null) return new Set(RECONCILE_PHASES);
  return new Set(filter);
}

function finalize(
  requestId: string,
  phases: Record<ReconcilePhase, PhaseOutcome>,
  startedAt: number,
): ReconcileSellerListingsResult {
  return {
    request_id: requestId,
    total_duration_ms: Date.now() - startedAt,
    phases,
  };
}
