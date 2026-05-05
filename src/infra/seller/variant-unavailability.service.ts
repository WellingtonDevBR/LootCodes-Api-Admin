/**
 * Cross-channel variant unavailability propagation.
 *
 * When a variant runs out of both local stock and profitable JIT candidates,
 * pushes zero declared stock to every active auto-sync listing so marketplaces
 * stop accepting orders for that product.
 *
 * Simplified port of the Edge Function `unavailability-propagator.service.ts`.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { ISellerDomainEventPort } from '../../core/ports/seller-domain-event.port.js';
import type {
  IVariantUnavailabilityPort,
  UnavailabilityReason,
  PropagationResult,
} from '../../core/ports/variant-unavailability.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('variant-unavailability');

const CONCURRENCY_CHUNK_SIZE = 5;

interface ActiveListingRow {
  id: string;
  external_listing_id: string;
  listing_type: string;
  provider_account_id: string;
}

interface ProviderAccountRow {
  id: string;
  provider_code: string;
}

@injectable()
export class VariantUnavailabilityService implements IVariantUnavailabilityPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async propagateVariantUnavailable(
    variantId: string,
    reason: UnavailabilityReason,
  ): Promise<PropagationResult> {
    const result: PropagationResult = { updated: 0, failed: 0, skipped: 0 };

    try {
      const listings = await this.db.query<ActiveListingRow>('seller_listings', {
        select: 'id, external_listing_id, listing_type, provider_account_id',
        eq: [
          ['variant_id', variantId],
          ['status', 'active'],
          ['auto_sync', true],
        ],
      });

      if (listings.length === 0) {
        logger.debug('No active auto-sync listings to propagate unavailability', { variantId });
        return result;
      }

      logger.info('Propagating variant unavailability', {
        variantId,
        reason,
        listingCount: listings.length,
      });

      const chunks = this.chunkArray(listings, CONCURRENCY_CHUNK_SIZE);

      for (const chunk of chunks) {
        const outcomes = await Promise.allSettled(
          chunk.map((listing) => this.pushZeroStock(listing, variantId)),
        );

        for (const outcome of outcomes) {
          if (outcome.status === 'fulfilled') {
            if (outcome.value) result.updated++;
            else result.skipped++;
          } else {
            result.failed++;
          }
        }
      }

      await this.events.emitSellerEvent({
        eventType: 'seller.variant_unavailable_propagated',
        aggregateId: variantId,
        payload: {
          variantId,
          reason,
          updated: result.updated,
          failed: result.failed,
          skipped: result.skipped,
          listingsChecked: listings.length,
        },
      });

      logger.info('Variant unavailability propagation complete', {
        variantId,
        reason,
        ...result,
      });
    } catch (err) {
      logger.error('Failed to propagate variant unavailability', err as Error, {
        variantId,
        reason,
      });
    }

    return result;
  }

  /**
   * Push zero stock to a single listing via the `provider-procurement` Edge Function.
   * Returns true if successfully updated, false if skipped/no-op.
   */
  private async pushZeroStock(listing: ActiveListingRow, variantId: string): Promise<boolean> {
    try {
      const provider = await this.db.queryOne<ProviderAccountRow>('provider_accounts', {
        select: 'id, provider_code',
        eq: [['id', listing.provider_account_id]],
        single: true,
      });

      if (!provider) {
        logger.warn('Provider account not found for listing', {
          listingId: listing.id,
          providerAccountId: listing.provider_account_id,
        });
        return false;
      }

      const subAction = listing.listing_type === 'declared_stock' ? 'declare-stock' : 'sync';

      await this.db.invokeFunction('provider-procurement', {
        action: 'seller-stock',
        sub_action: subAction,
        provider_account_id: provider.id,
        provider_code: provider.provider_code,
        variant_id: variantId,
        listing_id: listing.id,
        external_listing_id: listing.external_listing_id,
        quantity: 0,
        reason: 'variant_unavailable',
      });

      return true;
    } catch (err) {
      logger.error('Failed to push zero stock to listing', err as Error, {
        listingId: listing.id,
        variantId,
      });
      throw err;
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
