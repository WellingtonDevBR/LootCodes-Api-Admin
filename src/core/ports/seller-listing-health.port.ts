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
   * `failureReason` — when `success=false`, pass the reason code so the
   * health service can distinguish genuine listing errors from expected
   * market events. `'out_of_stock'` (JIT margin-gate / no provider stock)
   * is a transient market condition and must NOT increment the consecutive-
   * failure counter used by the circuit breaker — doing so causes listings
   * to be auto-paused on perfectly normal pricing fluctuations. It still
   * increments `reservation_failure_count` so the log-ratio monitor can
   * detect persistent pricing problems over a longer window.
   *
   * Non-throwing: errors are logged internally but never propagate
   * to the caller — health tracking must not affect the webhook response.
   */
  updateHealthCounters(
    externalListingId: string,
    callbackType: CallbackType,
    success: boolean,
    failureReason?: string,
  ): Promise<void>;
}
