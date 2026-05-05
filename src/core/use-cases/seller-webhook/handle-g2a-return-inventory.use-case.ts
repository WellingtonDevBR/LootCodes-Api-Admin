/**
 * G2A DELETE /order/:id/inventory handler.
 *
 * Returns specific inventory items (keys) back to stock. Used for refunds.
 * G2A sends item IDs as query params: id[]=uuid1&id[]=uuid2.
 *
 * Response: 204 No Content
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type { G2AReturnInventoryDto } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:g2a:return-inventory');

interface ProvisionRow {
  id: string;
  product_key_id: string;
  reservation_id: string;
  seller_listing_id: string;
  status: string;
}

@injectable()
export class HandleG2AReturnInventoryUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: G2AReturnInventoryDto): Promise<
    | { ok: true }
    | { ok: false; code: string; message: string; status: number }
  > {
    const { orderId, itemIds } = dto;

    if (!itemIds.length) {
      return { ok: false, code: 'BR02', message: 'No item IDs provided', status: 400 };
    }

    const provisions = await this.db.query<ProvisionRow>('seller_key_provisions', {
      select: 'id, product_key_id, reservation_id, seller_listing_id, status',
      in: [['product_key_id', itemIds]],
      eq: [['status', 'delivered']],
    });

    if (!provisions.length) {
      return { ok: false, code: 'BR02', message: 'No matching items found', status: 404 };
    }

    const variantIds = new Set<string>();
    const productIds = new Set<string>();

    for (const provision of provisions) {
      await this.db.update('product_keys', { id: provision.product_key_id }, {
        key_state: 'available',
      });

      await this.db.update('seller_key_provisions', { id: provision.id }, {
        status: 'refunded',
      });

      const listing = await this.db.queryOne<{
        variant_id: string;
      }>('seller_listings', {
        select: 'variant_id',
        eq: [['id', provision.seller_listing_id]],
        single: true,
      });

      if (listing) {
        variantIds.add(listing.variant_id);

        const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
          select: 'product_id',
          eq: [['id', listing.variant_id]],
          single: true,
        });
        if (variant?.product_id) productIds.add(variant.product_id);
      }

      logger.info('Key returned to stock', {
        keyId: provision.product_key_id, provisionId: provision.id, orderId,
      });
    }

    if (provisions[0]?.seller_listing_id) {
      await this.events.emitSellerEvent({
        eventType: 'seller.sale_refunded',
        aggregateId: provisions[0].seller_listing_id,
        payload: {
          providerCode: 'g2a',
          externalOrderId: orderId,
          refunded_keys_count: provisions.length,
          refunded_at: new Date().toISOString(),
        },
      });
    }

    if (variantIds.size > 0 && productIds.size > 0) {
      await this.events.emitInventoryStockChanged({
        productIds: [...productIds],
        variantIds: [...variantIds],
        reason: 'seller_cancelled',
      }).catch((err) => logger.warn('Failed to emit stock changed after refund return', { err }));
    }

    return { ok: true };
  }
}
