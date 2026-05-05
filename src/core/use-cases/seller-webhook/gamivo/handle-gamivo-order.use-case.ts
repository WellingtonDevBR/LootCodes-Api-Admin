/**
 * Gamivo POST /order handler.
 *
 * Provisions keys for a confirmed Gamivo order. Uses shared provision
 * orchestration for sale recording, events, and stock notifications.
 *
 * Key differences from G2A:
 *   - G2A delivers keys at reservation time
 *   - Gamivo delivers keys here (at order confirmation)
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type { GamivoOrderDto, GamivoOrderResult, GamivoKeyResponse } from '../seller-webhook.types.js';
import { countAvailableKeys } from '../../../shared/stock-queries.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:gamivo:order');

@injectable()
export class HandleGamivoOrderUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
  ) {}

  async execute(dto: GamivoOrderDto): Promise<GamivoOrderResult> {
    const { reservationId, gamivoOrderId } = dto;

    const reservation = await this.db.queryOne<{
      id: string;
      seller_listing_id: string;
      status: string;
      quantity: number;
      expires_at: string | null;
      external_reservation_id: string;
    }>('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity, expires_at, external_reservation_id',
      eq: [['id', reservationId]],
      single: true,
    });

    if (!reservation) {
      return { ok: false, code: 'not_found', message: 'Reservation not found', status: 404 };
    }

    const isExpiredByStatus = reservation.status === 'expired';
    const isExpiredByTimestamp =
      reservation.status === 'pending' &&
      reservation.expires_at &&
      new Date(reservation.expires_at) < new Date();

    if (isExpiredByStatus || isExpiredByTimestamp) {
      if (isExpiredByTimestamp) {
        logger.info('Reservation expired by timestamp before cron - releasing keys', {
          reservationId: reservation.id,
          expiresAt: reservation.expires_at,
        });
        await this.keyOps.releaseReservationKeys(reservation.id, 'expired').catch((err) => {
          logger.error('Failed to release keys for timestamp-expired reservation', err as Error, {
            reservationId: reservation.id,
          });
        });
      }
      return { ok: false, code: 'reservation_expired', message: 'Reservation has expired', status: 410 };
    }

    if (reservation.status === 'provisioned') {
      return this.returnExistingKeys(reservation.id);
    }

    await this.db.update('seller_stock_reservations', { id: reservation.id }, {
      external_order_id: gamivoOrderId,
    });

    const listing = await this.db.queryOne<{
      external_listing_id: string | null;
      variant_id: string;
      provider_account_id: string;
    }>('seller_listings', {
      select: 'external_listing_id, variant_id, provider_account_id',
      eq: [['id', reservation.seller_listing_id]],
      single: true,
    });

    let provisionResult;
    try {
      provisionResult = await this.keyOps.provisionFromPendingKeys(reservation.id);
    } catch (err) {
      logger.error('Gamivo order provision failed - releasing keys', err as Error, {
        reservationId, gamivoOrderId,
      });

      if (listing?.external_listing_id) {
        await this.healthPort.updateHealthCounters(listing.external_listing_id, 'provision', false);
      }

      await this.keyOps.releaseReservationKeys(reservation.id, 'failed').catch((releaseErr) => {
        logger.error('CRITICAL: Failed to release keys after provision failure', releaseErr as Error, {
          reservationId: reservation.id,
        });
      });

      return { ok: false, code: 'provision_failed', message: 'Failed to deliver keys', status: 500 };
    }

    if (listing?.external_listing_id) {
      await this.healthPort.updateHealthCounters(listing.external_listing_id, 'provision', true);
    }

    const variantData = listing?.variant_id
      ? await this.db.queryOne<{ product_id: string }>('product_variants', {
        select: 'product_id',
        eq: [['id', listing.variant_id]],
        single: true,
      })
      : null;

    await this.keyOps.completeProvisionOrchestration({
      reservationId: reservation.id,
      listingId: reservation.seller_listing_id,
      variantId: listing?.variant_id ?? '',
      productId: variantData?.product_id ?? '',
      providerCode: 'gamivo',
      externalOrderId: gamivoOrderId,
      keyIds: provisionResult.keyIds,
      keysProvisionedCount: provisionResult.decryptedKeys.length,
      priceCents: 0,
      currency: 'EUR',
    });

    const availableStock = listing?.variant_id && listing.provider_account_id
      ? await countAvailableKeys(this.db, listing.variant_id)
      : undefined;

    const keys: GamivoKeyResponse[] = provisionResult.keyIds.map((keyId, idx) => ({
      id: keyId,
      value: provisionResult.decryptedKeys[idx]?.plaintext ?? '',
      type: 'text' as const,
    }));

    logger.info('Gamivo order fulfilled', {
      reservationId, gamivoOrderId, keysDelivered: keys.length,
    });

    return {
      ok: true,
      providerOrderId: reservationId,
      keys,
      availableStock,
    };
  }

  private async returnExistingKeys(reservationId: string): Promise<GamivoOrderResult> {
    const provisions = await this.db.query<{ product_key_id: string }>('seller_key_provisions', {
      select: 'product_key_id',
      eq: [['reservation_id', reservationId], ['status', 'delivered']],
    });

    if (!provisions.length) {
      return { ok: false, code: 'already_fulfilled', message: 'Order already exists for reservation', status: 409 };
    }

    try {
      const decrypted = await this.keyOps.decryptDeliveredProvisionKeys(reservationId);
      const keys: GamivoKeyResponse[] = decrypted.decryptedKeys.map((d) => ({
        id: d.keyId,
        value: d.plaintext,
        type: 'text' as const,
      }));
      return { ok: true, providerOrderId: reservationId, keys };
    } catch {
      return { ok: false, code: 'already_fulfilled', message: 'Order already exists for reservation', status: 409 };
    }
  }

}
