/**
 * RESERVE handler for declared-stock marketplaces (Eneba, Kinguin declared-stock).
 *
 * Flow:
 *   1. Validate listing exists and is active
 *   2. Deduplicate against existing live reservations
 *   3. Atomic key claim via SellerKeyOperations (with JIT fallback)
 *   4. Emit seller.stock_reserved + inventory.stock_changed
 *   5. Return reservation confirmation
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type {
  DeclaredStockReserveDto,
  DeclaredStockReserveResult,
  ListingRow,
} from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:reserve');

const THREE_CALENDAR_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

@injectable()
export class HandleDeclaredStockReserveUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: DeclaredStockReserveDto): Promise<DeclaredStockReserveResult> {
    const { orderId, originalOrderId, auctions, wholesale, providerCode } = dto;

    if (!auctions || auctions.length === 0) {
      logger.error('RESERVE with no auctions', { orderId });
      return { success: false, orderId };
    }

    try {
      for (const auction of auctions) {
        const { auctionId, keyCount } = auction;

        const listing = await this.db.queryOne<ListingRow>('seller_listings', {
          select: 'id, variant_id, status, provider_account_id, price_cents, currency, min_jit_margin_cents',
          eq: [['external_listing_id', auctionId]],
          single: true,
        });

        if (!listing) {
          logger.error('Listing not found for auctionId', { auctionId, orderId });
          await this.updateHealthCounters(auctionId, 'reservation', false);
          return { success: false, orderId };
        }

        if (!listing.provider_account_id) {
          logger.error('Listing missing provider_account_id', { auctionId, orderId });
          await this.updateHealthCounters(auctionId, 'reservation', false);
          return { success: false, orderId };
        }

        if (listing.status !== 'active') {
          logger.warn('Listing not active, rejecting reservation', {
            auctionId, orderId, status: listing.status,
          });
          return { success: false, orderId };
        }

        const candidates = this.buildOrderIdCandidates(orderId, originalOrderId);
        const existingRows = await this.db.query<{ id: string; status: string; external_order_id: string }>(
          'seller_stock_reservations',
          {
            select: 'id, status, external_order_id',
            in: [['external_order_id', candidates]],
            eq: [['seller_listing_id', listing.id]],
          },
        );

        const liveExisting = existingRows.find(
          (r) => r.status === 'pending' || r.status === 'provisioned',
        );

        if (liveExisting) {
          logger.debug('Duplicate reservation detected, returning success', {
            orderId, originalOrderId, existingId: liveExisting.id, existingStatus: liveExisting.status,
          });
          return { success: true, orderId };
        }

        const expiresAt = new Date(Date.now() + THREE_CALENDAR_DAYS_MS).toISOString();

        const priceMoney = auction.price;
        const salePriceCents = typeof priceMoney.amount === 'number'
          ? Math.round(priceMoney.amount * 100)
          : Math.round(parseFloat(String(priceMoney.amount)) * 100);

        const outcome = await this.keyOps.claimKeysForReservation({
          variantId: listing.variant_id,
          listingId: listing.id,
          providerAccountId: listing.provider_account_id,
          quantity: keyCount,
          externalReservationId: orderId,
          externalOrderId: orderId,
          expiresAt,
          providerMetadata: {
            originalOrderId,
            auctionId,
            price: { amount: salePriceCents, currency: priceMoney.currency },
            wholesale: wholesale ?? false,
          },
          salePriceCents,
          minMarginCents: listing.min_jit_margin_cents ?? undefined,
        });

        await this.updateHealthCounters(auctionId, 'reservation', true);

        await this.events.emitSellerEvent({
          eventType: 'seller.stock_reserved',
          aggregateId: listing.id,
          payload: {
            reservationId: outcome.reservationId,
            listingId: listing.id,
            variantId: listing.variant_id,
            quantity: keyCount,
            providerCode,
            viaJit: outcome.viaJit,
          },
        });

        const variantData = await this.db.queryOne<{ product_id: string }>('product_variants', {
          select: 'product_id',
          eq: [['id', listing.variant_id]],
          single: true,
        });

        if (variantData?.product_id) {
          await this.events.emitInventoryStockChanged({
            productIds: [variantData.product_id],
            variantIds: [listing.variant_id],
            reason: 'seller_reserved',
          });
        }

        logger.debug('Reservation completed', {
          orderId, auctionId,
          reservationId: outcome.reservationId,
          keysReserved: outcome.keyIds.length,
          viaJit: outcome.viaJit,
        });
      }

      return { success: true, orderId };
    } catch (err) {
      logger.error('Unexpected error in reservation handler', err as Error, { orderId });
      if (auctions[0]) {
        await this.updateHealthCounters(auctions[0].auctionId, 'reservation', false);
      }
      return { success: false, orderId };
    }
  }

  private buildOrderIdCandidates(orderId: string, originalOrderId: string | null): string[] {
    const set = new Set([orderId]);
    if (originalOrderId && originalOrderId !== orderId) set.add(originalOrderId);
    return Array.from(set);
  }

  private async updateHealthCounters(
    externalListingId: string,
    type: 'reservation' | 'provision',
    success: boolean,
  ): Promise<void> {
    try {
      const col = success
        ? `${type}_success_count`
        : `${type}_failure_count`;

      await this.db.rpc('increment_seller_listing_health_counter', {
        p_external_listing_id: externalListingId,
        p_counter: col,
      });
    } catch (err) {
      logger.warn('Failed to update health counters', err as Error, { externalListingId, type });
    }
  }
}
