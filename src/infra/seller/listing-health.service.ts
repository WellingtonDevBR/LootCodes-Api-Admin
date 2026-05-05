/**
 * Listing health monitoring — full port of Edge Function `seller-webhook/health.ts`.
 *
 * 1) Reservation circuit breaker: 2 consecutive RESERVE failures → auto-pause + admin alert
 * 2) Log-ratio thresholds:
 *      Reservation: log(failed) / log(completed) >= 0.4 → auto-pause
 *      Provision:   log(failed) / log(completed) >= 0.2 → auto-pause
 * 3) Warning at 80% of threshold → admin alert (severity high)
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IListingHealthPort, CallbackType } from '../../core/ports/seller-listing-health.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('listing-health');

const THRESHOLDS: Record<CallbackType, number> = {
  reservation: 0.4,
  provision: 0.2,
};

const WARNING_BUFFER = 0.8;
const RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT = 2;
const AUTO_PAUSE_PREFIX = 'Auto-paused:';

interface ListingHealthRow {
  id: string;
  external_listing_id: string;
  status: string;
  reservation_consecutive_failures: number;
  reservation_success_count: number;
  reservation_failure_count: number;
  provision_success_count: number;
  provision_failure_count: number;
}

@injectable()
export class ListingHealthService implements IListingHealthPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async updateHealthCounters(
    externalListingId: string,
    callbackType: CallbackType,
    success: boolean,
  ): Promise<void> {
    try {
      const listing = await this.db.queryOne<ListingHealthRow>('seller_listings', {
        select: [
          'id', 'external_listing_id', 'status',
          'reservation_consecutive_failures',
          'reservation_success_count', 'reservation_failure_count',
          'provision_success_count', 'provision_failure_count',
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

      const newSuccess = success ? currentSuccess + 1 : currentSuccess;
      const newFailure = success ? currentFailure : currentFailure + 1;

      const prevConsecutive = listing.reservation_consecutive_failures ?? 0;
      const newReservationConsecutive =
        callbackType === 'reservation' ? (success ? 0 : prevConsecutive + 1) : prevConsecutive;

      const updatePayload: Record<string, unknown> = {
        [`${callbackType}_success_count`]: newSuccess,
        [`${callbackType}_failure_count`]: newFailure,
        last_health_check_at: new Date().toISOString(),
      };
      if (callbackType === 'reservation') {
        updatePayload.reservation_consecutive_failures = newReservationConsecutive;
      }

      await this.db.update('seller_listings', { id: listing.id }, updatePayload);

      // ─── Reservation circuit breaker ───
      if (
        callbackType === 'reservation' &&
        !success &&
        newReservationConsecutive >= RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT
      ) {
        logger.error('Reservation circuit breaker — consecutive failures threshold', {
          listingId: listing.id,
          externalListingId,
          consecutiveFailures: newReservationConsecutive,
        });

        if (listing.status === 'active') {
          await this.db.update('seller_listings', { id: listing.id }, {
            status: 'paused',
            error_message: `${AUTO_PAUSE_PREFIX} ${RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT} consecutive reservation failures — paused to limit marketplace callback errors`,
          });
        }

        if (newReservationConsecutive === RESERVATION_CONSECUTIVE_FAILURE_PAUSE_AT) {
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

      const ratio = Math.log(newFailure) / Math.log(newSuccess);
      const threshold = THRESHOLDS[callbackType];

      if (ratio >= threshold) {
        logger.error('Health threshold BREACHED — auto-pausing listing', {
          listingId: listing.id,
          externalListingId,
          callbackType,
          ratio: ratio.toFixed(3),
          threshold,
          successCount: newSuccess,
          failureCount: newFailure,
        });

        if (listing.status === 'active') {
          await this.db.update('seller_listings', { id: listing.id }, {
            status: 'paused',
            error_message: `${AUTO_PAUSE_PREFIX} ${callbackType} failure ratio ${ratio.toFixed(3)} >= ${threshold}`,
          });
        }

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
      } else if (ratio >= threshold * WARNING_BUFFER) {
        logger.warn('Health threshold approaching', {
          listingId: listing.id,
          externalListingId,
          callbackType,
          ratio: ratio.toFixed(3),
          threshold,
          warningAt: (threshold * WARNING_BUFFER).toFixed(3),
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
