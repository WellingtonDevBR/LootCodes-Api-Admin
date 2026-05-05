/**
 * G2A POST /order handler.
 *
 * Confirms a sale based on an existing reservation. Since G2A delivers keys
 * at reservation time, this handler records the sale via shared orchestration
 * and returns the already-provisioned keys.
 *
 * Request: { reservation_id, g2a_order_id }
 * Response 200: { order_id, stock: [...] }
 * Response 202: Order created without stock
 * Response 409: Order already exists for reservation
 * Response 410: Reservation expired
 */
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { IKeyDecryptionPort } from '../../../ports/key-decryption.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type {
  G2AOrderDto,
  G2AOrderCreatedResponse,
  G2AStockItem,
} from '../seller-webhook.types.js';
import {
  buildStockInventoryItem,
  buildStockItem,
  buildOrderResponse,
} from './g2a-parser.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:g2a:order');

interface ReservationRow {
  id: string;
  seller_listing_id: string;
  status: string;
  quantity: number;
  expires_at: string | null;
  external_order_id: string | null;
}

interface ListingRow {
  id: string;
  variant_id: string;
  external_listing_id: string | null;
  external_product_id: string | null;
  price_cents: number;
  currency: string;
}

@injectable()
export class HandleG2AOrderUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.KeyDecryption) private readonly keyDecryption: IKeyDecryptionPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
  ) {}

  async execute(dto: G2AOrderDto): Promise<
    | { ok: true; response: G2AOrderCreatedResponse; status: number }
    | { ok: false; code: string; message: string; status: number }
  > {
    const { reservation_id, g2a_order_id } = dto;

    const reservations = await this.db.query<ReservationRow>('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity, expires_at, external_order_id',
      eq: [['external_reservation_id', reservation_id]],
    });

    if (!reservations.length) {
      return { ok: false, code: 'BR02', message: 'Reservation not found', status: 404 };
    }

    const now = new Date();
    for (const r of reservations) {
      if (r.status === 'expired') {
        return { ok: false, code: 'BR02', message: 'Reservation expired', status: 410 };
      }
      if (r.status === 'pending' && r.expires_at && new Date(r.expires_at) < now) {
        return { ok: false, code: 'BR02', message: 'Reservation expired', status: 410 };
      }
    }

    const orderId = randomUUID();
    const stockItems: G2AStockItem[] = [];

    for (const reservation of reservations) {
      const hasExistingOrder =
        reservation.external_order_id &&
        reservation.external_order_id !== reservation_id &&
        reservation.status === 'provisioned';

      if (hasExistingOrder) {
        return { ok: false, code: 'BR02', message: 'Order already exists for reservation', status: 409 };
      }

      await this.db.update('seller_stock_reservations', { id: reservation.id }, {
        external_order_id: String(g2a_order_id),
      });

      const listing = await this.db.queryOne<ListingRow>('seller_listings', {
        select: 'id, variant_id, external_listing_id, external_product_id, price_cents, currency',
        eq: [['id', reservation.seller_listing_id]],
        single: true,
      });

      if (!listing) {
        logger.error('Listing not found for reservation', {
          reservationId: reservation.id, listingId: reservation.seller_listing_id,
        });
        continue;
      }

      const provisions = await this.db.query<{ product_key_id: string; status: string }>(
        'seller_key_provisions',
        {
          select: 'product_key_id, status',
          eq: [['reservation_id', reservation.id], ['status', 'delivered']],
        },
      );

      const keyIds = provisions.map((p) => p.product_key_id);

      await this.keyOps.completeProvisionOrchestration({
        reservationId: reservation.id,
        listingId: listing.id,
        variantId: listing.variant_id,
        productId: '',
        providerCode: 'g2a',
        externalOrderId: String(g2a_order_id),
        keyIds,
        keysProvisionedCount: keyIds.length,
        priceCents: listing.price_cents,
        currency: listing.currency,
      });

      if (listing.external_listing_id) {
        await this.healthPort.updateHealthCounters(listing.external_listing_id, 'provision', true);
      }

      if (keyIds.length > 0) {
        try {
          const decrypted = await this.keyDecryption.decryptKeysByIds(keyIds);
          const inventoryItems = decrypted.map((d) =>
            buildStockInventoryItem(d.keyId, d.plaintext),
          );
          stockItems.push(
            buildStockItem(Number(listing.external_product_id), keyIds.length, inventoryItems),
          );
        } catch (decryptErr) {
          logger.error('Failed to decrypt keys for order response', decryptErr as Error, {
            orderId, reservationId: reservation.id,
          });
          stockItems.push(
            buildStockItem(Number(listing.external_product_id), keyIds.length, []),
          );
        }
      }

      logger.info('G2A order item confirmed', {
        orderId, g2a_order_id, reservationId: reservation.id, keysProvisioned: keyIds.length,
      });
    }

    const noStock = stockItems.length === 0 || stockItems.every((s) => s.inventory.length === 0);
    const responseStatus = noStock ? 202 : 200;

    return { ok: true, response: buildOrderResponse(orderId, stockItems), status: responseStatus };
  }
}
