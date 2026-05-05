/**
 * Port for seller listing health monitoring.
 *
 * Mirrors the Edge Function's `health.ts` semantics:
 *   - Per-listing success/failure counters for reservation and provision callbacks
 *   - Reservation circuit breaker (consecutive failure auto-pause)
 *   - Log-ratio threshold auto-pause with admin alerts
 */

export type CallbackType = 'reservation' | 'provision';

export interface IListingHealthPort {
  /**
   * Update health counters for a seller listing callback.
   *
   * Evaluates circuit breaker (reservation only) and log-ratio thresholds
   * after incrementing counters. May auto-pause the listing and create
   * admin alerts when thresholds are breached.
   *
   * Non-throwing: errors are logged internally but never propagate
   * to the caller — health tracking must not affect the webhook response.
   */
  updateHealthCounters(
    externalListingId: string,
    callbackType: CallbackType,
    success: boolean,
  ): Promise<void>;
}
