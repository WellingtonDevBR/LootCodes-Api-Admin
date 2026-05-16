/**
 * Gamivo POST /offer-deactivation handler.
 *
 * Processes offer deactivation notifications - pauses the local listing,
 * creates an admin alert, and emits a seller.listing_removed event.
 * Returns 204 No Content per Gamivo spec.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { GamivoOfferDeactivationDto } from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:gamivo:offer-deactivation');

@injectable()
export class HandleGamivoOfferDeactivationUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: GamivoOfferDeactivationDto): Promise<{ status: number }> {
    const { offerId, productName, reason, providerAccountId } = dto;
    const offerIdStr = String(offerId);

    // Look up the listing FIRST — domain_events.aggregate_id is UUID-typed,
    // and Gamivo's offerId is a numeric string (e.g. "3413536"), which would
    // raise `invalid input syntax for type uuid` on the seller event insert.
    // The listing UUID is the correct aggregate id for `seller.listing_removed`.
    const listing = await this.db.queryOne<{ id: string }>('seller_listings', {
      select: 'id',
      eq: [['external_listing_id', offerIdStr], ['provider_account_id', providerAccountId]],
      single: true,
    });

    if (listing) {
      await this.db.update('seller_listings', { id: listing.id }, {
        status: 'paused',
        error_message: `Deactivated by Gamivo: ${reason || 'unknown reason'}`,
        updated_at: new Date().toISOString(),
      });

      await this.events.emitSellerEvent({
        eventType: 'seller.listing_removed',
        aggregateId: listing.id,
        payload: {
          providerCode: 'gamivo',
          externalListingId: offerIdStr,
          product_name: productName,
          reason,
        },
      });
    } else {
      // No matching listing — skip the seller event entirely. There is no
      // listing aggregate to attach the event to, and inserting with a
      // synthetic id would just hide the orphaned-deactivation signal.
      logger.warn('Listing not found for Gamivo deactivation', { offerId, providerAccountId });
    }

    try {
      await this.db.insert('admin_alerts', {
        alert_type: 'marketplace_listing_deactivated',
        severity: 'medium',
        title: 'Gamivo offer deactivated',
        message: `Gamivo deactivated offer ${offerId} (${productName || 'unknown'}): ${reason || 'no reason provided'}.`,
        metadata: {
          provider_code: 'gamivo',
          offer_id: offerId,
          product_name: productName,
          reason,
        },
      });
    } catch (err) {
      logger.warn('Failed to create admin alert for Gamivo deactivation', err as Error);
    }

    return { status: 204 };
  }
}
