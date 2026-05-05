/**
 * Port for cross-channel variant unavailability propagation.
 *
 * When a variant runs out of both local stock and profitable procurement
 * candidates, this port pushes zero stock to every linked sales channel
 * so all marketplaces stop accepting orders for that product.
 */

export type UnavailabilityReason = 'jit_failed' | 'all_unprofitable' | 'manual';

export interface PropagationResult {
  updated: number;
  failed: number;
  skipped: number;
}

export interface IVariantUnavailabilityPort {
  /**
   * Push zero stock to every active auto-sync listing for the given variant.
   *
   * Non-blocking from the caller's perspective — errors for individual
   * listings are logged but do not prevent other listings from being updated.
   */
  propagateVariantUnavailable(
    variantId: string,
    reason: UnavailabilityReason,
  ): Promise<PropagationResult>;
}
