/**
 * G2A PUT /reservation/:id handler.
 *
 * Renews an existing reservation, extending its expiry. If the reservation
 * is still valid (pending/provisioned), just update the expiry and return
 * the current stock. If expired, attempt to re-claim and re-provision.
 *
 * Response: { reservation_id, stock: [...] } (same shape as POST /reservation)
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { IKeyDecryptionPort } from '../../../ports/key-decryption.port.js';
import type {
  G2ARenewReservationDto,
  G2AReservationResponse,
  G2AStockItem,
} from '../seller-webhook.types.js';
import {
  buildStockInventoryItem,
  buildStockItem,
  buildReservationResponse,
} from './g2a-parser.js';
import { countAvailableKeys, MARKETPLACE_RESERVATION_EXPIRY_MS } from '../../../shared/stock-queries.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:g2a:renew-reservation');

interface ReservationRow {
  id: string;
  seller_listing_id: string;
  status: string;
  quantity: number;
  expires_at: string | null;
  provider_metadata: Record<string, unknown> | null;
}

interface ListingRow {
  id: string;
  variant_id: string;
  external_product_id: string | null;
  provider_account_id: string;
}

@injectable()
export class HandleG2ARenewReservationUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.KeyDecryption) private readonly keyDecryption: IKeyDecryptionPort,
  ) {}

  async execute(dto: G2ARenewReservationDto): Promise<
    | { ok: true; response: G2AReservationResponse }
    | { ok: false; code: string; message: string; status: number }
  > {
    const { externalReservationId, providerAccountId } = dto;

    const reservations = await this.db.query<ReservationRow>('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity, expires_at, provider_metadata',
      eq: [['external_reservation_id', externalReservationId]],
    });

    if (!reservations.length) {
      return { ok: false, code: 'BR02', message: 'Reservation not found', status: 404 };
    }

    const newExpiresAt = new Date(Date.now() + MARKETPLACE_RESERVATION_EXPIRY_MS).toISOString();
    const stockItems: G2AStockItem[] = [];

    for (const reservation of reservations) {
      const isExpired =
        reservation.status === 'expired' ||
        (reservation.expires_at && new Date(reservation.expires_at) < new Date());

      if (isExpired) {
        const renewed = await this.reClaimAndProvision(reservation, externalReservationId, providerAccountId);
        if (renewed) {
          stockItems.push(renewed);
        } else {
          return { ok: false, code: 'BR02', message: 'Insufficient stock to renew', status: 400 };
        }
        continue;
      }

      await this.db.update('seller_stock_reservations', { id: reservation.id }, {
        expires_at: newExpiresAt,
      });

      const stock = await this.buildStockForReservation(reservation);
      if (stock) stockItems.push(stock);
    }

    return { ok: true, response: buildReservationResponse(externalReservationId, stockItems) };
  }

  private async buildStockForReservation(
    reservation: ReservationRow,
  ): Promise<G2AStockItem | null> {
    const listing = await this.db.queryOne<ListingRow>('seller_listings', {
      select: 'external_product_id, variant_id, provider_account_id',
      eq: [['id', reservation.seller_listing_id]],
      single: true,
    });

    if (!listing?.provider_account_id) return null;

    const provisions = await this.db.query<{ product_key_id: string; status: string }>(
      'seller_key_provisions',
      {
        select: 'product_key_id, status',
        eq: [['reservation_id', reservation.id]],
        in: [['status', ['pending', 'delivered']]],
      },
    );

    const keyIds = provisions.map((p) => p.product_key_id);
    if (!keyIds.length) return null;

    try {
      const decrypted = await this.keyDecryption.decryptKeysByIds(keyIds);
      const inventory = decrypted.map((d) => buildStockInventoryItem(d.keyId, d.plaintext));

      const availableCount = await countAvailableKeys(this.db, listing.variant_id);

      return buildStockItem(Number(listing.external_product_id), availableCount, inventory);
    } catch (err) {
      logger.error('Failed to build stock for reservation', err as Error, {
        reservationId: reservation.id,
      });
      return null;
    }
  }

  private async reClaimAndProvision(
    reservation: ReservationRow,
    externalReservationId: string,
    _providerAccountId: string,
  ): Promise<G2AStockItem | null> {
    const listing = await this.db.queryOne<ListingRow>('seller_listings', {
      select: 'id, variant_id, external_product_id, provider_account_id',
      eq: [['id', reservation.seller_listing_id]],
      single: true,
    });

    if (!listing?.provider_account_id) return null;

    await this.db.update('seller_stock_reservations', { id: reservation.id }, {
      status: 'expired',
    });

    try {
      const claimResult = await this.keyOps.claimKeysForReservation({
        variantId: listing.variant_id,
        listingId: listing.id,
        providerAccountId: listing.provider_account_id,
        quantity: reservation.quantity,
        externalReservationId,
        externalOrderId: externalReservationId,
        expiresAt: new Date(Date.now() + MARKETPLACE_RESERVATION_EXPIRY_MS).toISOString(),
        providerMetadata: {
          ...(reservation.provider_metadata ?? {}),
          renewed_from: reservation.id,
          provider: 'g2a',
        },
      });

      const provisionResult = await this.keyOps.provisionFromPendingKeys(claimResult.reservationId);

      const availableCount = await countAvailableKeys(this.db, listing.variant_id);

      const inventory = provisionResult.keyIds.map((keyId, idx) =>
        buildStockInventoryItem(keyId, provisionResult.decryptedKeys[idx]?.plaintext ?? ''),
      );

      return buildStockItem(Number(listing.external_product_id), availableCount, inventory);
    } catch (err) {
      logger.error('Failed to re-claim and provision on renewal', err as Error, {
        reservationId: reservation.id, externalReservationId,
      });
      return null;
    }
  }

}
