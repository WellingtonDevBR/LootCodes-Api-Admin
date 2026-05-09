export interface BuyerOfferSnapshotSyncResult {
  readonly scanned: number;
  readonly updated: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs: number;
}

export interface IBuyerOfferSnapshotSyncService {
  /**
   * Fetches live quotes from all active buyer providers (Bamboo, AppRoute, …)
   * and writes fresh `available_quantity`, `last_price_cents`, `currency`, and
   * `last_checked_at` back to `provider_variant_offers`.
   *
   * Safe to call before `declared-stock` reconcile to guarantee the snapshot
   * table contains current stock before making declare/disable decisions.
   */
  syncAll(requestId: string): Promise<BuyerOfferSnapshotSyncResult>;
}
