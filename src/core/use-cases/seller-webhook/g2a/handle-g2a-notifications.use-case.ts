/**
 * G2A POST /notifications handler.
 *
 * Handles marketplace notifications such as auction_deactivated.
 * Updates listing status and emits domain events.
 *
 * Request: Array of { notification_type, date, data: { product_id, offer_id? } }
 * Response: 204 No Content
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type { G2ANotificationsDto } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:g2a:notifications');

@injectable()
export class HandleG2ANotificationsUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: G2ANotificationsDto): Promise<{ ok: true }> {
    const { notifications, providerAccountId } = dto;

    for (const notification of notifications) {
      if (notification.notification_type === 'auction_deactivated') {
        const productId = notification.data.product_id;
        const offerId = notification.data.offer_id;

        const eqClauses: Array<[string, string]> = [
          ['provider_account_id', providerAccountId],
        ];

        if (offerId) {
          eqClauses.push(['external_listing_id', offerId]);
        } else {
          eqClauses.push(['external_product_id', String(productId)]);
        }

        const listing = await this.db.queryOne<{
          id: string;
          external_listing_id: string | null;
          external_product_id: string | null;
        }>('seller_listings', {
          select: 'id, external_listing_id, external_product_id',
          eq: eqClauses,
          single: true,
        });

        if (listing) {
          await this.db.update('seller_listings', { id: listing.id }, {
            status: 'paused',
            error_message: 'Deactivated by G2A marketplace',
          });

          await this.events.emitSellerEvent({
            eventType: 'seller.listing_removed',
            aggregateId: listing.id,
            payload: {
              providerCode: 'g2a',
              externalListingId: listing.external_listing_id ?? '',
              reason: 'auction_deactivated',
            },
          });

          logger.info('G2A auction deactivated - listing paused', {
            listingId: listing.id, product_id: productId, offer_id: offerId,
          });
        } else {
          logger.warn('No listing found for G2A auction deactivation', {
            product_id: productId, offer_id: offerId,
          });
        }
      }
    }

    return { ok: true };
  }
}
