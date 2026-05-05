/**
 * CANCEL handler for declared-stock marketplaces (Eneba).
 *
 * Two flows depending on reservation state:
 *   pending     → release claimed keys back to available (normal cancel)
 *   provisioned → restock keys + ledger refund via handlePostProvisionReturn
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type {
  DeclaredStockCancelDto,
  DeclaredStockCancelResult,
} from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:cancel');

@injectable()
export class HandleDeclaredStockCancelUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: DeclaredStockCancelDto): Promise<DeclaredStockCancelResult> {
    const { orderId, originalOrderId, providerCode } = dto;

    try {
      const candidates = this.buildOrderIdCandidates(orderId, originalOrderId);

      const rows = await this.db.query<{
        id: string;
        seller_listing_id: string;
        status: string;
        quantity: number;
        external_order_id: string;
        created_at: string;
      }>(
        'seller_stock_reservations',
        {
          select: 'id, seller_listing_id, status, quantity, external_order_id, created_at',
          in: [['external_order_id', candidates]],
          order: { column: 'created_at', ascending: false },
          limit: 2,
        },
      );

      if (!rows.length) {
        logger.warn('Reservation not found for CANCEL — may already be cleaned up', {
          orderId, originalOrderId, candidates,
        });
        return { success: true };
      }

      const reservation = rows.find((r) => r.external_order_id === orderId) ?? rows[0];

      if (reservation.status === 'provisioned') {
        const keysRestocked = await this.keyOps.handlePostProvisionReturn({
          reservation,
          providerCode,
          externalOrderId: orderId,
          reason: `${providerCode}_post_provision_cancel`,
        });

        logger.info('CANCEL after provision — keys restocked', {
          orderId, reservationId: reservation.id, keysRestocked,
        });
        return { success: true, keysReleased: keysRestocked };
      }

      if (reservation.status !== 'pending') {
        logger.info('Reservation not pending for CANCEL, skipping', {
          orderId, reservationId: reservation.id, status: reservation.status,
        });
        return { success: true };
      }

      const keysReleased = await this.keyOps.releaseReservationKeys(reservation.id, 'cancelled');

      await this.events.emitSellerEvent({
        eventType: 'seller.stock_cancelled',
        aggregateId: reservation.seller_listing_id,
        payload: {
          reservationId: reservation.id,
          reason: `${providerCode}_cancel`,
          providerCode,
          keysReleased,
        },
      });

      if (keysReleased > 0) {
        const listing = await this.db.queryOne<{ variant_id: string }>(
          'seller_listings',
          { select: 'variant_id', eq: [['id', reservation.seller_listing_id]], single: true },
        );
        if (listing?.variant_id) {
          const variant = await this.db.queryOne<{ product_id: string }>(
            'product_variants',
            { select: 'product_id', eq: [['id', listing.variant_id]], single: true },
          );
          if (variant?.product_id) {
            await this.events.emitInventoryStockChanged({
              productIds: [variant.product_id],
              variantIds: [listing.variant_id],
              reason: 'seller_cancelled',
            });
          }
        }
      }

      logger.info('Cancellation completed', { orderId, reservationId: reservation.id, keysReleased });
      return { success: true, keysReleased };
    } catch (err) {
      logger.error('Unexpected error in cancellation handler', err as Error, { orderId });
      return { success: true };
    }
  }

  private buildOrderIdCandidates(orderId: string, originalOrderId: string | null): string[] {
    const set = new Set([orderId]);
    if (originalOrderId && originalOrderId !== orderId) set.add(originalOrderId);
    return Array.from(set);
  }
}
