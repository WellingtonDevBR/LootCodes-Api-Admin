import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlertsRepository } from '../../ports/admin-alerts-repository.port.js';
import type { SyncSellerListingPausedAlertsResult } from '../alerts/alerts.types.js';

/**
 * Reconciles `admin_alerts` with the current `seller_listings.status` so every paused / failed
 * listing surfaces as a `seller_listing_paused` alert in the CRM, and stale alerts auto-close
 * once the listing is back to active. Invoked by `ReconcileSellerListingsUseCase` as the final
 * cron phase so operators always see "needs recovery" warnings without depending on edge-triggered
 * alerts that may have been dismissed before the underlying listing recovered.
 */
@injectable()
export class SyncSellerListingPausedAlertsUseCase {
  constructor(
    @inject(TOKENS.AdminAlertsRepository) private readonly repo: IAdminAlertsRepository,
  ) {}

  async execute(): Promise<SyncSellerListingPausedAlertsResult> {
    return this.repo.syncSellerListingPausedAlerts();
  }
}
