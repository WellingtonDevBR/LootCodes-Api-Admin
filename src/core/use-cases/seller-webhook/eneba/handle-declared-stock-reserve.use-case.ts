/**
 * RESERVE handler for declared-stock marketplaces (Eneba, Kinguin declared-stock).
 *
 * Flow:
 *   1. Validate listing exists and is active
 *   2. Deduplicate against existing live reservations
 *   3. Atomic key claim via SellerKeyOperations (with JIT fallback)
 *   4. Health monitoring via IListingHealthPort
 *   5. On total failure: propagate variant unavailability via IVariantUnavailabilityPort
 *   6. Emit seller.stock_reserved + inventory.stock_changed
 *   7. Return reservation confirmation
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type { IVariantUnavailabilityPort } from '../../../ports/variant-unavailability.port.js';
import { buildOrderIdCandidates } from './eneba-helpers.js';
import type {
  DeclaredStockReserveDto,
  DeclaredStockReserveResult,
  ListingRow,
} from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:reserve');

const THREE_CALENDAR_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

@injectable()
export class HandleDeclaredStockReserveUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
    @inject(TOKENS.VariantUnavailability) private readonly unavailability: IVariantUnavailabilityPort,
  ) {}

  async execute(dto: DeclaredStockReserveDto): Promise<DeclaredStockReserveResult> {
    const { orderId, originalOrderId, auctions, wholesale, providerCode, feesCents } = dto;

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
          await this.healthPort.updateHealthCounters(auctionId, 'reservation', false);
          return { success: false, orderId };
        }

        if (!listing.provider_account_id) {
          logger.error('Listing missing provider_account_id', { auctionId, orderId });
          await this.healthPort.updateHealthCounters(auctionId, 'reservation', false);
          return { success: false, orderId };
        }

        if (listing.status !== 'active') {
          logger.warn('Listing not active, rejecting reservation', {
            auctionId, orderId, status: listing.status,
          });
          return { success: false, orderId };
        }

        const candidates = buildOrderIdCandidates(orderId, originalOrderId);
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
          ? priceMoney.amount
          : parseInt(String(priceMoney.amount), 10);
        const salePriceCurrency = typeof priceMoney.currency === 'string' && priceMoney.currency.trim().length > 0
          ? priceMoney.currency.trim().toUpperCase()
          : undefined;

        const providerMetadata: Record<string, unknown> = {
          originalOrderId,
          auctionId,
          price: { amount: salePriceCents, currency: priceMoney.currency },
          wholesale: wholesale ?? false,
        };

        if (auction.marketplaceFinancials) {
          providerMetadata.marketplaceFinancials = auction.marketplaceFinancials;
        }

        let outcome;
        try {
          outcome = await this.keyOps.claimKeysForReservation({
            variantId: listing.variant_id,
            listingId: listing.id,
            providerAccountId: listing.provider_account_id,
            quantity: keyCount,
            externalReservationId: orderId,
            externalOrderId: orderId,
            expiresAt,
            providerMetadata,
            salePriceCents,
            salePriceCurrency,
            minMarginCents: listing.min_jit_margin_cents ?? undefined,
            feesCents,
          });
        } catch (claimErr) {
          logger.error('Key claim failed — propagating variant unavailability', claimErr as Error, {
            orderId, auctionId, variantId: listing.variant_id,
          });

          await this.healthPort.updateHealthCounters(auctionId, 'reservation', false);

          await this.unavailability.propagateVariantUnavailable(
            listing.variant_id,
            'jit_failed',
          );

          return { success: false, orderId };
        }

        await this.healthPort.updateHealthCounters(auctionId, 'reservation', true);

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
        await this.healthPort.updateHealthCounters(auctions[0].auctionId, 'reservation', false);
      }
      return { success: false, orderId };
    }
  }

}
