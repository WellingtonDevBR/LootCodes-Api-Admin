/**
 * Listing health monitoring — full port of Edge Function `seller-webhook/health.ts`.
 *
 * 1) Reservation circuit breaker: 2 consecutive RESERVE failures → auto-pause + admin alert
 * 2) Log-ratio thresholds:
 *      Reservation: log(failed) / log(completed) >= 0.4 → auto-pause
 *      Provision:   log(failed) / log(completed) >= 0.2 → auto-pause
 * 3) Warning at 80% of threshold → admin alert (severity high)
 *
 * Alerts are edge-triggered: a warning / breach alert fires only on the event that
 * pushes the ratio across the band boundary. Subsequent events that stay inside the
 * same band — including successful operations that mathematically can only improve
 * the ratio — do NOT emit duplicate alerts. The DB pause action is still idempotent
 * (only flips active → paused, never re-pauses).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import type { IListingHealthPort, CallbackType } from '../../core/ports/seller-listing-health.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('listing-health');

const THRESHOLDS: Record<CallbackType, number> = {
  reservation: 0.4,
  provision: 0.2,
};

const WARNING_BUFFER = 0.8;
const RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT = 2;
/**
 * Threshold for `out_of_stock` failures specifically. Higher than the genuine-
 * error threshold (2) because OOS is partially driven by transient market
 * noise (live JIT cost spikes, brief provider stockouts). At 5 consecutive,
 * however, the listing is structurally broken (cost > sale price, or a stale
 * marketplace auction price) — auto-pause + admin alert + push 0 to the
 * marketplace so the reconcile cron stops re-declaring stock.
 *
 * Without this circuit, the reconcile cron sees declared_stock=0 (set by
 * the variant-unavailability propagation), runs its credit-aware selector,
 * passes the (paper) margin gate, and re-pushes positive stock 5 minutes
 * later — guaranteeing the next sale also fails. See LOOTCODES-API-? in
 * Sentry where a single broken listing produced 54 events in one hour.
 */
const RESERVATION_OUT_OF_STOCK_PAUSE_AT = 5;
const AUTO_PAUSE_PREFIX = 'Auto-paused:';

/**
 * log(failure)/log(success) with a safe definition for the boundary cases
 * `success < 2` and `failure < 1` — those rows aren't yet eligible for the
 * threshold check, so we treat the ratio as 0 (healthy).
 */
function computeLogRatio(successCount: number, failureCount: number): number {
  if (successCount < 2 || failureCount < 1) return 0;
  return Math.log(failureCount) / Math.log(successCount);
}

interface ListingHealthRow {
  id: string;
  external_listing_id: string;
  status: string;
  listing_type: string;
  provider_account_id: string;
  reservation_consecutive_failures: number;
  reservation_success_count: number;
  reservation_failure_count: number;
  provision_success_count: number;
  provision_failure_count: number;
  provider_metadata: Record<string, unknown> | null;
}

interface HealthMetricsState {
  out_of_stock_consecutive_failures: number;
}

function readHealthMetrics(meta: Record<string, unknown> | null | undefined): HealthMetricsState {
  if (!meta || typeof meta !== 'object') return { out_of_stock_consecutive_failures: 0 };
  const raw = (meta as Record<string, unknown>).healthMetrics;
  if (!raw || typeof raw !== 'object') return { out_of_stock_consecutive_failures: 0 };
  const oos = (raw as Record<string, unknown>).out_of_stock_consecutive_failures;
  return {
    out_of_stock_consecutive_failures: typeof oos === 'number' && Number.isFinite(oos) ? oos : 0,
  };
}

function withHealthMetrics(
  meta: Record<string, unknown> | null | undefined,
  next: HealthMetricsState,
): Record<string, unknown> {
  const base = meta && typeof meta === 'object' ? { ...meta } : {};
  base.healthMetrics = { ...(base.healthMetrics as Record<string, unknown> | undefined), ...next };
  return base;
}

@injectable()
export class ListingHealthService implements IListingHealthPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.MarketplaceAdapterRegistry) private readonly registry: IMarketplaceAdapterRegistry,
  ) {}

  async updateHealthCounters(
    externalListingId: string,
    callbackType: CallbackType,
    success: boolean,
    failureReason?: string,
  ): Promise<void> {
    try {
      const listing = await this.db.queryOne<ListingHealthRow>('seller_listings', {
        select: [
          'id', 'external_listing_id', 'status', 'listing_type', 'provider_account_id',
          'reservation_consecutive_failures',
          'reservation_success_count', 'reservation_failure_count',
          'provision_success_count', 'provision_failure_count',
          'provider_metadata',
        ].join(', '),
        eq: [['external_listing_id', externalListingId]],
        single: true,
      });

      if (!listing) {
        logger.warn('Could not fetch listing for health check', { externalListingId });
        return;
      }

      const successCol = `${callbackType}_success_count` as keyof ListingHealthRow;
      const failureCol = `${callbackType}_failure_count` as keyof ListingHealthRow;

      const currentSuccess = (listing[successCol] as number) ?? 0;
      const currentFailure = (listing[failureCol] as number) ?? 0;

      const prevHealth = readHealthMetrics(listing.provider_metadata);
      const isOutOfStock = !success && failureReason === 'out_of_stock';
      const isReservation = callbackType === 'reservation';

      // out_of_stock has its OWN circuit breaker (separate threshold) so a brief
      // market hiccup doesn't pause healthy listings, but a structurally broken
      // listing (cost > sale price, stale auction, etc.) gets paused before it
      // floods Sentry. Genuine errors (listing_not_found, misconfigured, …) keep
      // using the existing tighter threshold via reservation_consecutive_failures.
      let nextOos = prevHealth.out_of_stock_consecutive_failures;
      if (isReservation) {
        if (success) nextOos = 0;
        else if (isOutOfStock) nextOos = prevHealth.out_of_stock_consecutive_failures + 1;
      }

      // out_of_stock is excluded from `reservation_failure_count` and the
      // log-ratio counters because those drive the existing 0.4 ratio threshold —
      // mixing market-noise failures with genuine errors would over-pause healthy
      // listings whenever a competitor briefly undercuts our cost basis.
      // It is, however, tracked separately above for the dedicated OOS circuit.
      const skipGenericCounters = isOutOfStock;

      const newSuccess = success ? currentSuccess + 1 : currentSuccess;
      const newFailure = success || skipGenericCounters ? currentFailure : currentFailure + 1;

      const prevConsecutive = listing.reservation_consecutive_failures ?? 0;
      // Reservation counter: success resets, genuine errors increment, OOS leaves alone.
      const newReservationConsecutive = isReservation
        ? (success ? 0 : (skipGenericCounters ? prevConsecutive : prevConsecutive + 1))
        : prevConsecutive;

      const updatePayload: Record<string, unknown> = {
        last_health_check_at: new Date().toISOString(),
      };
      if (!skipGenericCounters || success) {
        updatePayload[`${callbackType}_success_count`] = newSuccess;
        updatePayload[`${callbackType}_failure_count`] = newFailure;
      }
      if (isReservation) {
        updatePayload.reservation_consecutive_failures = newReservationConsecutive;
      }
      if (isReservation && nextOos !== prevHealth.out_of_stock_consecutive_failures) {
        updatePayload.provider_metadata = withHealthMetrics(listing.provider_metadata, {
          out_of_stock_consecutive_failures: nextOos,
        });
      }

      await this.db.update('seller_listings', { id: listing.id }, updatePayload);

      // ─── Out-of-stock circuit breaker ───
      if (
        isReservation
        && isOutOfStock
        && nextOos >= RESERVATION_OUT_OF_STOCK_PAUSE_AT
        && listing.status === 'active'
      ) {
        await this.tripOutOfStockCircuit(listing, nextOos);
        return;
      }
      if (
        isReservation
        && isOutOfStock
        && nextOos >= RESERVATION_OUT_OF_STOCK_PAUSE_AT
      ) {
        // Already paused on a previous tick; nothing else to do.
        return;
      }
      if (isOutOfStock) {
        // Genuine failure path below should not run for OOS — return after the
        // counters above have been persisted.
        return;
      }

      // ─── Reservation circuit breaker ───
      if (
        callbackType === 'reservation' &&
        !success &&
        newReservationConsecutive >= RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT
      ) {
        if (listing.status === 'active') {
          await this.db.update('seller_listings', { id: listing.id }, {
            status: 'paused',
            error_message: `${AUTO_PAUSE_PREFIX} ${RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT} consecutive reservation failures — paused to limit marketplace callback errors`,
          });
        }

        if (newReservationConsecutive === RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT) {
          logger.error('Reservation circuit breaker — consecutive failures threshold', {
            listingId: listing.id,
            externalListingId,
            consecutiveFailures: newReservationConsecutive,
          });

          await this.createAdminAlert({
            alertType: 'seller_reservation_circuit_tripped',
            severity: 'critical',
            title: 'Seller listing auto-paused: consecutive reservation failures',
            message: `Listing ${externalListingId} reached ${RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT} consecutive failed RESERVE callbacks and was auto-paused (this listing only).`,
            metadata: {
              listingId: listing.id,
              externalListingId,
              consecutiveFailures: newReservationConsecutive,
              reservationSuccessCount: newSuccess,
              reservationFailureCount: newFailure,
            },
          });
        }

        return;
      }

      // ─── Log-ratio thresholds ───
      if (newSuccess < 2 || newFailure < 1) return;

      const threshold = THRESHOLDS[callbackType];
      const warningLine = threshold * WARNING_BUFFER;
      const ratio = computeLogRatio(newSuccess, newFailure);
      const prevRatio = computeLogRatio(currentSuccess, currentFailure);
      const justBreached = ratio >= threshold && prevRatio < threshold;
      const justWarned =
        ratio >= warningLine && ratio < threshold && prevRatio < warningLine;

      if (ratio >= threshold) {
        if (listing.status === 'active') {
          await this.db.update('seller_listings', { id: listing.id }, {
            status: 'paused',
            error_message: `${AUTO_PAUSE_PREFIX} ${callbackType} failure ratio ${ratio.toFixed(3)} >= ${threshold}`,
          });
        }

        if (justBreached) {
          logger.error('Health threshold BREACHED — auto-pausing listing', {
            listingId: listing.id,
            externalListingId,
            callbackType,
            ratio: ratio.toFixed(3),
            threshold,
            successCount: newSuccess,
            failureCount: newFailure,
          });

          await this.createAdminAlert({
            alertType: 'seller_health_threshold_breached',
            severity: 'critical',
            title: `Seller listing auto-paused: ${callbackType} threshold breached`,
            message: `Listing ${externalListingId} auto-paused. ${callbackType} failure ratio ${ratio.toFixed(3)} >= ${threshold}. Success: ${newSuccess}, Failure: ${newFailure}.`,
            metadata: {
              listingId: listing.id,
              externalListingId,
              callbackType,
              ratio: ratio.toFixed(3),
              threshold,
              successCount: newSuccess,
              failureCount: newFailure,
            },
          });
        }
      } else if (justWarned) {
        logger.warn('Health threshold approaching', {
          listingId: listing.id,
          externalListingId,
          callbackType,
          ratio: ratio.toFixed(3),
          threshold,
          warningAt: warningLine.toFixed(3),
        });

        await this.createAdminAlert({
          alertType: 'seller_health_threshold_warning',
          severity: 'high',
          title: `Seller listing health warning: ${callbackType} ratio approaching threshold`,
          message: `Listing ${externalListingId} approaching ${callbackType} failure threshold. Ratio ${ratio.toFixed(3)} (threshold: ${threshold}). Success: ${newSuccess}, Failure: ${newFailure}.`,
          metadata: {
            listingId: listing.id,
            externalListingId,
            callbackType,
            ratio: ratio.toFixed(3),
            threshold,
            successCount: newSuccess,
            failureCount: newFailure,
          },
        });
      }
    } catch (err) {
      logger.error('Health counter update failed', err as Error, {
        externalListingId,
        callbackType,
      });
    }
  }

  /**
   * Auto-pause + marketplace declared_stock=0 push for a listing that has
   * crossed the out-of-stock circuit threshold. Pushing 0 to the marketplace
   * is essential — without it the listing keeps accepting RESERVE callbacks
   * (Eneba sells whatever stock the auction shows, regardless of our DB
   * status). See variant-unavailability.service.ts for the per-sale push;
   * this is the durable post-circuit-breaker push so the cron-driven
   * reconciler doesn't immediately re-enable.
   */
  private async tripOutOfStockCircuit(
    listing: ListingHealthRow,
    consecutiveOos: number,
  ): Promise<void> {
    const errorMessage =
      `${AUTO_PAUSE_PREFIX} ${consecutiveOos} consecutive out_of_stock — `
      + 'investigate cost basis vs sale price (live JIT cost may exceed marketplace auction price)';

    await this.db.update('seller_listings', { id: listing.id }, {
      status: 'paused',
      declared_stock: 0,
      error_message: errorMessage,
      last_synced_at: new Date().toISOString(),
    });

    // Push 0 to the marketplace so the auction is hidden / stops accepting
    // RESERVE callbacks. Failure here is non-fatal: the DB is the source of
    // truth, and reconcile cron will retry the push on the next tick.
    if (listing.listing_type === 'declared_stock' && listing.external_listing_id) {
      try {
        const provider = await this.db.queryOne<{ provider_code: string }>('provider_accounts', {
          select: 'provider_code',
          eq: [['id', listing.provider_account_id]],
          single: true,
        });
        const providerCode = provider?.provider_code?.trim().toLowerCase();
        if (providerCode) {
          const adapter = this.registry.getDeclaredStockAdapter(providerCode);
          if (adapter) {
            await adapter.declareStock(listing.external_listing_id, 0);
          }
        }
      } catch (err) {
        logger.warn('Out-of-stock circuit: marketplace zero-push failed (DB still paused)', err as Error, {
          listingId: listing.id,
          externalListingId: listing.external_listing_id,
        });
      }
    }

    logger.error('Out-of-stock circuit BREACHED — auto-paused listing', {
      listingId: listing.id,
      externalListingId: listing.external_listing_id,
      consecutiveOutOfStockFailures: consecutiveOos,
    });

    await this.createAdminAlert({
      alertType: 'seller_out_of_stock_circuit_tripped',
      severity: 'critical',
      title: 'Seller listing auto-paused: repeated out_of_stock',
      message:
        `Listing ${listing.external_listing_id} hit ${consecutiveOos} consecutive out_of_stock failures and was auto-paused. `
        + 'Likely cause: live JIT cost has risen above the listing sale price, OR the marketplace auction is selling at a stale (lower) price than our DB reflects. '
        + 'Manual review required — adjust min_profit_margin_pct, raise listing price, or unblock the listing once cost basis recovers.',
      metadata: {
        listingId: listing.id,
        externalListingId: listing.external_listing_id,
        consecutiveOutOfStockFailures: consecutiveOos,
      },
    });
  }

  private async createAdminAlert(params: {
    alertType: string;
    severity: string;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.insert('admin_alerts', {
        alert_type: params.alertType,
        severity: params.severity,
        title: params.title,
        message: params.message,
        metadata: params.metadata,
      });
    } catch (err) {
      logger.warn('Failed to create admin alert', err as Error, {
        alertType: params.alertType,
      });
    }
  }
}
