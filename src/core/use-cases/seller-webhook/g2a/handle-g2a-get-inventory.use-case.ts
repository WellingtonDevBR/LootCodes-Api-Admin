/**
 * G2A GET /order/:id/inventory handler.
 *
 * Idempotent key retrieval for completed orders. Re-decrypts provisioned keys
 * and returns them in G2A's inventory format.
 *
 * Response: [{ product_id, inventory_size, inventory: [{ id, value, kind }] }]
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { IKeyDecryptionPort } from '../../../ports/key-decryption.port.js';
import type { G2AGetInventoryDto, G2AStockItem } from '../seller-webhook.types.js';
import { buildStockInventoryItem } from './g2a-parser.js';
import { countAvailableKeys } from '../../../shared/stock-queries.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:g2a:get-inventory');

interface ReservationRow {
  id: string;
  seller_listing_id: string;
  external_order_id: string | null;
}

interface ListingRow {
  external_product_id: string | null;
  variant_id: string;
  provider_account_id: string;
}

@injectable()
export class HandleG2AGetInventoryUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.KeyDecryption) private readonly keyDecryption: IKeyDecryptionPort,
  ) {}

  async execute(dto: G2AGetInventoryDto): Promise<
    | { ok: true; response: G2AStockItem[] }
    | { ok: false; code: string; message: string; status: number }
  > {
    const { orderId } = dto;

    const byOrder = await this.db.query<ReservationRow>('seller_stock_reservations', {
      select: 'id, seller_listing_id, external_order_id',
      eq: [['external_order_id', orderId]],
    });

    const byReservation = await this.db.query<ReservationRow>('seller_stock_reservations', {
      select: 'id, seller_listing_id, external_order_id',
      eq: [['external_reservation_id', orderId]],
    });

    const seenIds = new Set(byOrder.map((r) => r.id));
    const reservations = [...byOrder, ...byReservation.filter((r) => !seenIds.has(r.id))];

    if (!reservations.length) {
      return { ok: false, code: 'BR02', message: 'Order not found', status: 404 };
    }

    const result: G2AStockItem[] = [];

    for (const reservation of reservations) {
      const listing = await this.db.queryOne<ListingRow>('seller_listings', {
        select: 'external_product_id, variant_id, provider_account_id',
        eq: [['id', reservation.seller_listing_id]],
        single: true,
      });

      if (!listing?.provider_account_id) continue;

      const provisions = await this.db.query<{ product_key_id: string }>(
        'seller_key_provisions',
        {
          select: 'product_key_id',
          eq: [['reservation_id', reservation.id], ['status', 'delivered']],
        },
      );

      if (!provisions.length) continue;

      const keyIds = provisions.map((p) => p.product_key_id);

      try {
        const decrypted = await this.keyDecryption.decryptKeysByIds(keyIds);
        const inventory = decrypted.map((d) => buildStockInventoryItem(d.keyId, d.plaintext));

        const availableCount = await countAvailableKeys(this.db, listing.variant_id);

        result.push({
          product_id: Number(listing.external_product_id),
          inventory_size: availableCount,
          inventory,
        });
      } catch (err) {
        logger.error('Failed to decrypt keys for get-inventory', err as Error, {
          orderId, reservationId: reservation.id,
        });
      }
    }

    return { ok: true, response: result };
  }

}
