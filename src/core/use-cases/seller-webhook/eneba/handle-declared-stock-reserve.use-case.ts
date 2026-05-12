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
    const { orderId, originalOrderId, auctions, wholesale, providerCode } = dto;

    if (!auctions || auctions.length === 0) {
      logger.error('RESERVE with no auctions', { orderId });
      return { success: false, orderId, reason: 'no_auctions' };
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
          return { success: false, orderId, reason: 'listing_not_found' };
        }

        if (!listing.provider_account_id) {
          logger.error('Listing missing provider_account_id', { auctionId, orderId });
          await this.healthPort.updateHealthCounters(auctionId, 'reservation', false);
          return { success: false, orderId, reason: 'listing_misconfigured' };
        }

        if (listing.status !== 'active') {
          // Listing being deactivated mid-RESERVE is rare but expected when
          // an admin or the reconcile cron has just taken it offline.
          logger.info('Listing not active, rejecting reservation', {
            auctionId, orderId, status: listing.status,
          });
          return { success: false, orderId, reason: 'listing_inactive' };
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

        // Use seller_profit_cents_per_unit as the effective sale price for the
        // JIT margin gate. This field is computed by the financials builder using
        // Eneba's commission formula on originalPrice (seller_net = originalPrice
        // − commission), which is what S_calculatePrice returns and what the
        // Eneba seller UI shows as "I want to get".
        //
        // IMPORTANT: do NOT additionally subtract campaign_fee_cents_per_unit.
        // Eneba's `campaignFee` in the reserve callback is the BUYER PREMIUM
        // (price − originalPrice) — i.e. the markup Eneba adds for buyers. It is
        // NOT deducted from the seller's payout. The seller_profit field already
        // reflects the true net via the commission formula.
        const financials = auction.marketplaceFinancials;
        const listingCurrency = (financials?.currency ?? auction.price.currency).trim().toUpperCase();

        const salePriceCents = financials?.seller_profit_cents_per_unit
          ?? (typeof auction.price.amount === 'number'
            ? auction.price.amount
            : parseInt(String(auction.price.amount), 10));
        const salePriceCurrency = listingCurrency.length > 0 ? listingCurrency : undefined;

        // No additional fee deduction — the seller net already accounts for
        // Eneba's commission. See comment above.
        const perAuctionFeesCents = 0;

        const buyerIp = financials?.buyer_ip ?? null;

        const providerMetadata: Record<string, unknown> = {
          originalOrderId,
          auctionId,
          price: { amount: salePriceCents, currency: listingCurrency },
          wholesale: wholesale ?? false,
        };
        if (buyerIp) {
          providerMetadata.buyerIp = buyerIp;
        }

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
            feesCents: perAuctionFeesCents > 0 ? perAuctionFeesCents : undefined,
          });
        } catch (claimErr) {
          const claimMsg = claimErr instanceof Error ? claimErr.message : String(claimErr);
          // Production reference (Sentry LOOTCODES-API-R/S/T): an Eneba RESERVE
          // arriving when no buyer-capable provider has stock at a profitable
          // price is normal market behavior. The downstream code already
          // handles it (propagate variant unavailability, return success:false).
          // Only surface to Sentry as `error` if the claim path produced an
          // unrecognized failure — those are real bugs.
          const isExpectedNoStock = /INSUFFICIENT_STOCK|Key claim failed/.test(claimMsg);
          if (isExpectedNoStock) {
            logger.info('No keys available for marketplace reserve — propagating variant unavailability', {
              orderId, auctionId, variantId: listing.variant_id, error: claimMsg,
            });
          } else {
            logger.error('Key claim failed unexpectedly — propagating variant unavailability', claimErr as Error, {
              orderId, auctionId, variantId: listing.variant_id,
            });
          }

          await this.healthPort.updateHealthCounters(
            auctionId, 'reservation', false,
            isExpectedNoStock ? 'out_of_stock' : undefined,
          );

          await this.unavailability.propagateVariantUnavailable(
            listing.variant_id,
            'jit_failed',
          );

          return {
            success: false,
            orderId,
            reason: isExpectedNoStock ? 'out_of_stock' : 'unexpected_error',
          };
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
      return { success: false, orderId, reason: 'unexpected_error' };
    }
  }

}
