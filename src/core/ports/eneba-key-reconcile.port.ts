/**
 * Port for Eneba key inventory reconciliation.
 *
 * The reconcile service compares our internal key provision records against
 * Eneba's live `S_keys` data to surface and auto-correct two categories of
 * discrepancy:
 *
 *   1. REPORTED keys  — buyer reported a key on Eneba; mark our key as `faulty`.
 *   2. Orphaned provisions — our system recorded a key as `delivered` (we sent
 *      it in a PROVIDE) but Eneba never marked it as SOLD (race-CANCEL, Eneba
 *      drop, etc.); restock the key to `available` so it can be re-sold.
 */

export interface EnebaKeyReconcileResult {
  listings_checked: number;
  /** Eneba keys found with state = REPORTED across all checked listings. */
  reported_keys_found: number;
  /** Keys successfully marked `faulty` in our DB because Eneba reported them. */
  reported_keys_marked_faulty: number;
  /** Provisions where the key was not SOLD on Eneba; keys restocked to `available`. */
  orphaned_provisions_found: number;
  orphaned_provisions_restocked: number;
}

export interface IEnebaKeyReconcileService {
  execute(requestId: string): Promise<EnebaKeyReconcileResult>;
}
