/**
 * G2A DELETE /reservation/:id handler.
 *
 * Releases reserved keys back to available stock.
 *
 * Two flows depending on reservation state:
 *   pending     -> release claimed keys via releaseReservationKeys
 *   provisioned -> restock keys via handlePostProvisionReturn
 *
 * Response: 204 No Content (success) or 404 (not found)
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { G2ACancelReservationDto } from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:g2a:cancel-reservation');

interface ReservationRow {
  id: string;
  seller_listing_id: string;
  status: string;
  quantity: number;
  external_order_id: string | null;
}

@injectable()
export class HandleG2ACancelReservationUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
  ) {}

  async execute(dto: G2ACancelReservationDto): Promise<
    | { ok: true }
    | { ok: false; code: string; message: string; status: number }
  > {
    const { externalReservationId } = dto;

    const reservations = await this.db.query<ReservationRow>('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity, external_order_id',
      eq: [['external_reservation_id', externalReservationId]],
    });

    if (!reservations.length) {
      return { ok: false, code: 'BR02', message: 'Reservation not found', status: 404 };
    }

    for (const reservation of reservations) {
      if (reservation.status === 'provisioned') {
        const keysRestocked = await this.keyOps.handlePostProvisionReturn({
          reservation: {
            id: reservation.id,
            seller_listing_id: reservation.seller_listing_id,
            quantity: reservation.quantity,
          },
          providerCode: 'g2a',
          externalOrderId: reservation.external_order_id ?? externalReservationId,
          reason: 'g2a_post_provision_cancel',
        });

        logger.info('G2A cancel reservation after provision - keys restocked', {
          reservationId: reservation.id, keysRestocked,
        });
        continue;
      }

      if (reservation.status !== 'pending') {
        logger.info('Reservation not pending - skipping cancel', {
          reservationId: reservation.id, status: reservation.status,
        });
        continue;
      }

      const keysReleased = await this.keyOps.releaseReservationKeys(
        reservation.id,
        'cancelled',
      );

      logger.info('G2A reservation cancelled', {
        reservationId: reservation.id, keysReleased,
      });
    }

    return { ok: true };
  }
}
