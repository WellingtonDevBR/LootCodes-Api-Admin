/**
 * Listing deactivation handler (Gamivo deactivation callback).
 *
 * Marks the local seller_listing as deactivated when the marketplace
 * reports the listing has been removed/disabled.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type { ListingDeactivationDto, ListingDeactivationResult } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:deactivation');

@injectable()
export class HandleListingDeactivationUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: ListingDeactivationDto): Promise<ListingDeactivationResult> {
    const { externalListingId, providerCode, reason } = dto;

    try {
      const listing = await this.db.queryOne<{ id: string; variant_id: string; provider_account_id: string }>(
        'seller_listings',
        {
          select: 'id, variant_id, provider_account_id',
          eq: [['external_listing_id', externalListingId]],
          single: true,
        },
      );

      if (!listing) {
        logger.warn('Listing not found for deactivation', { externalListingId, providerCode });
        return { success: false };
      }

      await this.db.update('seller_listings', { id: listing.id }, {
        status: 'deactivated',
        error_message: reason ?? `Deactivated by ${providerCode}`,
        updated_at: new Date().toISOString(),
      });

      await this.events.emitSellerEvent({
        eventType: 'seller.listing_removed',
        aggregateId: listing.id,
        payload: {
          providerCode,
          externalListingId,
          reason: reason ?? 'marketplace_deactivation',
          listing_id: listing.id,
          variant_id: listing.variant_id,
          provider_account_id: listing.provider_account_id,
        },
      });

      logger.info('Listing deactivated via marketplace callback', {
        listingId: listing.id, externalListingId, providerCode,
      });

      return { success: true, listingId: listing.id };
    } catch (err) {
      logger.error('Unexpected error in deactivation handler', err as Error, { externalListingId, providerCode });
      return { success: false };
    }
  }
}
