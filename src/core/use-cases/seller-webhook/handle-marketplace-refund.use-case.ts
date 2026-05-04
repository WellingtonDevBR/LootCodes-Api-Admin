/**
 * Marketplace refund handler (Gamivo refund, G2A return, Kinguin RETURNED).
 *
 * Provider-agnostic: callers pass providerCode and reason.
 * Supports partial refunds via refundedKeysCount.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { MarketplaceRefundDto, MarketplaceRefundResult } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:refund');

@injectable()
export class HandleMarketplaceRefundUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
  ) {}

  async execute(dto: MarketplaceRefundDto): Promise<MarketplaceRefundResult> {
    const { externalOrderId, reservationId, providerCode, reason, refundedKeysCount, refundEventId } = dto;

    try {
      let resId = reservationId;

      if (!resId) {
        const row = await this.db.queryOne<{ id: string }>(
          'seller_stock_reservations',
          {
            select: 'id',
            eq: [['external_order_id', externalOrderId]],
            order: { column: 'created_at', ascending: false },
            single: true,
          },
        );
        resId = row?.id;
      }

      if (!resId) {
        logger.warn('Reservation not found for refund', { externalOrderId, providerCode });
        return { success: false, keysRestocked: 0 };
      }

      const reservation = await this.db.queryOne<{
        id: string;
        seller_listing_id: string;
        status: string;
        quantity: number;
      }>(
        'seller_stock_reservations',
        { select: 'id, seller_listing_id, status, quantity', eq: [['id', resId]], single: true },
      );

      if (!reservation) {
        logger.warn('Reservation row not found', { reservationId: resId, providerCode });
        return { success: false, keysRestocked: 0 };
      }

      if (reservation.status !== 'provisioned') {
        logger.warn('Reservation not in provisioned state for refund', {
          reservationId: resId, status: reservation.status, providerCode,
        });
        return { success: false, keysRestocked: 0 };
      }

      const keysRestocked = await this.keyOps.handlePostProvisionReturn({
        reservation,
        providerCode,
        externalOrderId,
        reason,
        maxKeysToRestock: refundedKeysCount,
        refundEventId,
      });

      logger.info('Marketplace refund processed', {
        externalOrderId, reservationId: resId, providerCode, keysRestocked,
      });

      return { success: true, keysRestocked };
    } catch (err) {
      logger.error('Unexpected error in refund handler', err as Error, { externalOrderId, providerCode });
      return { success: false, keysRestocked: 0 };
    }
  }
}
