/**
 * Gamivo GET /order/{id}/keys handler.
 *
 * Idempotent retrieval of keys for an existing Gamivo order.
 * Returns decrypted keys + available_stock.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { GamivoGetKeysDto, GamivoGetKeysResult, GamivoKeyResponse } from '../seller-webhook.types.js';
import { countAvailableKeys } from '../../../shared/stock-queries.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:gamivo:get-keys');

@injectable()
export class HandleGamivoGetKeysUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
  ) {}

  async execute(dto: GamivoGetKeysDto): Promise<GamivoGetKeysResult> {
    const { providerOrderId } = dto;

    const provisions = await this.db.query<{
      product_key_id: string;
      reservation_id: string;
    }>('seller_key_provisions', {
      select: 'product_key_id, reservation_id',
      eq: [['reservation_id', providerOrderId], ['status', 'delivered']],
    });

    if (!provisions.length) {
      return { ok: false, code: 'not_found', message: 'No keys found for this order', status: 404 };
    }

    const reservationId = provisions[0].reservation_id;

    let decryptedKeys;
    try {
      const result = await this.keyOps.decryptDeliveredProvisionKeys(reservationId);
      decryptedKeys = result.decryptedKeys;
    } catch (err) {
      logger.error('Failed to decrypt keys for Gamivo get-keys', err as Error, { providerOrderId });
      return { ok: false, code: 'decrypt_failed', message: 'Failed to retrieve keys', status: 500 };
    }

    const reservation = await this.db.queryOne<{ seller_listing_id: string }>('seller_stock_reservations', {
      select: 'seller_listing_id',
      eq: [['id', reservationId]],
      single: true,
    });

    let availableStock: number | undefined;
    if (reservation?.seller_listing_id) {
      const listing = await this.db.queryOne<{
        variant_id: string;
        provider_account_id: string;
      }>('seller_listings', {
        select: 'variant_id, provider_account_id',
        eq: [['id', reservation.seller_listing_id]],
        single: true,
      });

      if (listing?.variant_id) {
        availableStock = await countAvailableKeys(this.db, listing.variant_id);
      }
    }

    const keys: GamivoKeyResponse[] = decryptedKeys.map((d) => ({
      id: d.keyId,
      value: d.plaintext,
      type: 'text' as const,
    }));

    return { ok: true, keys, availableStock };
  }
}
