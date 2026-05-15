import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IAdminAlertsRepository } from '../../ports/admin-alerts-repository.port.js';
import type { SyncSellerListingPricingFrozenAlertsResult } from '../alerts/alerts.types.js';

/**
 * Reconciles `admin_alerts` with the current state of seller-side pricing.
 * Surfaces a `seller_listing_pricing_frozen` alert when a listing has been:
 *  - Blocked by `budget_exhausted` for >6 h (Eneba quota deadlock), OR
 *  - Priced below cost basis for >1 h (auto-pricer can't pull it back up).
 *
 * Stale alerts auto-resolve once the listing recovers. Invoked as a phase of
 * `ReconcileSellerListingsUseCase` so the CRM dashboard always reflects which
 * listings need operator intervention — operators no longer need to discover
 * frozen listings by hand.
 */
@injectable()
export class SyncSellerListingPricingFrozenAlertsUseCase {
  constructor(
    @inject(TOKENS.AdminAlertsRepository) private readonly repo: IAdminAlertsRepository,
  ) {}

  async execute(): Promise<SyncSellerListingPricingFrozenAlertsResult> {
    return this.repo.syncSellerListingPricingFrozenAlerts();
  }
}
