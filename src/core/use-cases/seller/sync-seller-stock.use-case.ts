import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'crypto';
import { TOKENS } from '../../../di/tokens.js';
import type { ISellerStockSyncService } from '../../ports/seller-pricing.port.js';
import type { SyncSellerStockDto, SyncSellerStockResult } from './seller-listing.types.js';

/**
 * Manual "Sync Stock Now" trigger from the CRM.
 *
 * Delegates to the same {@link ISellerStockSyncService} used by the cron so
 * a manual sync goes through the full pipeline (inventory-source-aware key
 * counting → marketplace adapter declareStock/syncStockLevel → DB persist),
 * not just a DB write.
 */
@injectable()
export class SyncSellerStockUseCase {
  constructor(
    @inject(TOKENS.SellerStockSyncService) private stockSync: ISellerStockSyncService,
  ) {}

  async execute(dto: SyncSellerStockDto): Promise<SyncSellerStockResult> {
    if (!dto.listing_id) throw new Error('listing_id is required');

    const requestId = `manual-sync-${randomUUID()}`;
    const result = await this.stockSync.refreshOneListing(requestId, dto.listing_id);

    return {
      listing_id: dto.listing_id,
      stock_updated: result.stockUpdated > 0,
      errors: result.errors,
      synced_at: new Date().toISOString(),
    };
  }
}
