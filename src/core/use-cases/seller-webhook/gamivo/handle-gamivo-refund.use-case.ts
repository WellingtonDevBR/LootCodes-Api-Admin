/**
 * Gamivo POST /refund handler.
 *
 * Two distinct flows depending on reservation state:
 *   pending     -> release claimed keys back to available
 *   provisioned -> cumulative refund with FIFO partial restock
 *
 * Per Gamivo spec, refunded_keys_count is cumulative (total keys with
 * refunded status), not the delta. We compute the newly refunded count
 * by subtracting provisions already marked refunded locally so repeat
 * notifications stay idempotent.
 *
 * Returns 204 No Content on all success paths per Gamivo spec.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { GamivoRefundDto } from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:gamivo:refund');

@injectable()
export class HandleGamivoRefundUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: GamivoRefundDto): Promise<{ status: number }> {
    const { orderId, reservationId, refundedAt, refundedKeysCount } = dto;

    const reservation = await this.db.queryOne<{
      id: string;
      seller_listing_id: string;
      status: string;
      quantity: number;
    }>('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity',
      eq: [['id', reservationId]],
      single: true,
    });

    if (!reservation) {
      logger.warn('Reservation not found for Gamivo refund - may already be cleaned up', {
        reservationId, orderId,
      });
      return { status: 204 };
    }

    await this.events.emitSellerEvent({
      eventType: 'seller.sale_refunded',
      aggregateId: reservationId,
      payload: {
        providerCode: 'gamivo',
        externalOrderId: orderId,
        reservationId,
        refunded_at: refundedAt,
        refunded_keys_count: refundedKeysCount,
      },
    });

    if (reservation.status === 'provisioned') {
      const provisions = await this.db.query<{ id: string; status: string }>('seller_key_provisions', {
        select: 'id, status',
        eq: [['reservation_id', reservation.id]],
      });

      const deliveredCount = provisions.filter((p) => p.status === 'delivered').length;
      const alreadyRefundedCount = provisions.filter((p) => p.status === 'refunded').length;
      const totalProvisioned = deliveredCount + alreadyRefundedCount;

      const targetRefundedTotal = Math.min(refundedKeysCount, totalProvisioned);
      const newlyRefundedCount = Math.max(0, targetRefundedTotal - alreadyRefundedCount);

      if (newlyRefundedCount === 0) {
        logger.info('Gamivo refund - no new keys to restock (idempotent replay)', {
          reservationId, orderId, refundedKeysCount, alreadyRefundedCount, totalProvisioned,
        });
        return { status: 204 };
      }

      const refundEventId = `gamivo:${reservation.id}:${targetRefundedTotal}`;

      const keysRestocked = await this.keyOps.handlePostProvisionReturn({
        reservation,
        providerCode: 'gamivo',
        externalOrderId: orderId,
        reason: 'gamivo_refund',
        maxKeysToRestock: newlyRefundedCount,
        refundEventId,
      });

      logger.info('Gamivo refund after provision - keys restocked', {
        reservationId, orderId, keysRestocked, newlyRefundedCount,
        cumulativeRefundedCount: refundedKeysCount, totalProvisioned,
        partial: targetRefundedTotal < totalProvisioned,
        refundEventId,
      });

      return { status: 204 };
    }

    if (reservation.status === 'pending') {
      const keysReleased = await this.keyOps.releaseReservationKeys(reservation.id, 'cancelled');

      logger.info('Gamivo refund - released pending keys', {
        reservationId, orderId, keysReleased,
      });

      return { status: 204 };
    }

    await this.db.update('seller_stock_reservations', { id: reservation.id }, {
      status: 'cancelled',
    });

    logger.info('Gamivo refund - reservation already in terminal state', {
      reservationId, orderId, status: reservation.status,
    });

    return { status: 204 };
  }
}
