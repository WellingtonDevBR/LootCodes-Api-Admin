/**
 * Inventory callback handler (G2A stock/price check).
 *
 * G2A periodically queries our inventory endpoint to verify stock
 * availability and current pricing for a listing.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { InventoryCallbackDto, InventoryCallbackResult } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:inventory');

@injectable()
export class HandleInventoryCallbackUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async execute(dto: InventoryCallbackDto): Promise<InventoryCallbackResult> {
    const { externalListingId, providerCode } = dto;

    try {
      const listing = await this.db.queryOne<{
        id: string;
        variant_id: string;
        status: string;
        declared_stock: number;
      }>(
        'seller_listings',
        {
          select: 'id, variant_id, status, declared_stock',
          eq: [['external_listing_id', externalListingId]],
          single: true,
        },
      );

      if (!listing || listing.status !== 'active') {
        return { available: false, quantity: 0 };
      }

      const keys = await this.db.query<{ id: string }>(
        'product_keys',
        {
          select: 'id',
          eq: [['variant_id', listing.variant_id], ['key_state', 'available']],
        },
      );

      const quantity = keys.length;

      logger.debug('Inventory callback processed', {
        externalListingId, providerCode, quantity, listingId: listing.id,
      });

      return { available: quantity > 0, quantity };
    } catch (err) {
      logger.error('Unexpected error in inventory callback', err as Error, { externalListingId, providerCode });
      return { available: false, quantity: 0 };
    }
  }
}
