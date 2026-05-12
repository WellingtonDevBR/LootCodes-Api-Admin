/**
 * Key-replacement RESERVE handler for Eneba declared-stock.
 *
 * Eneba sends a flat RESERVE (no auctions array) when a buyer reports a faulty
 * key. The payload includes the original orderId and their internal keyId
 * reference for the key the buyer received.
 *
 * Flow:
 *   1. Find the listing by external_listing_id (= auctionId in the flat payload)
 *   2. Find the original provisioned reservation + delivered provision
 *   3. Mark the original key as faulty and record a write-off transaction
 *   4. Claim a fresh replacement key under the same orderId
 *   5. Return success:true so Eneba sends the subsequent PROVIDE
 *
 * The subsequent PROVIDE is handled by HandleDeclaredStockProvideUseCase, which
 * detects isReplacement=true in the reservation metadata and skips the
 * marketplace_sale transaction to avoid double-counting revenue.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type {
  EnebaKeyReplacementReserveDto,
  EnebaKeyReplacementReserveResult,
  ListingRow,
} from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:replacement-reserve');

const THREE_CALENDAR_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

interface OriginalReservationRow {
  id: string;
  seller_listing_id: string;
  status: string;
  provider_metadata: Record<string, unknown>;
  external_order_id: string;
  created_at: string;
  provisioned_at: string | null;
}

interface OriginalProvisionRow {
  id: string;
  product_key_id: string;
  status: string;
}

interface FaultyKeyRow {
  id: string;
  order_id: string | null;
}

@injectable()
export class HandleEnebaKeyReplacementReserveUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
  ) {}

  async execute(dto: EnebaKeyReplacementReserveDto): Promise<EnebaKeyReplacementReserveResult> {
    const { orderId, originalOrderId, auctionId, enebaKeyId, providerCode } = dto;

    try {
      // 1. Find listing by external_listing_id
      const listing = await this.db.queryOne<ListingRow>('seller_listings', {
        select: 'id, variant_id, status, provider_account_id, price_cents, currency, min_jit_margin_cents, external_listing_id, listing_type',
        eq: [['external_listing_id', auctionId]],
        single: true,
      });

      if (!listing) {
        logger.error('Replacement RESERVE: listing not found', { auctionId, orderId });
        return { success: false, orderId, reason: 'listing_not_found' };
      }

      if (!listing.provider_account_id) {
        logger.error('Replacement RESERVE: listing missing provider_account_id', { auctionId, orderId });
        return { success: false, orderId, reason: 'listing_misconfigured' };
      }

      if (listing.status !== 'active') {
        logger.info('Replacement RESERVE: listing not active', { auctionId, orderId, status: listing.status });
        return { success: false, orderId, reason: 'listing_inactive' };
      }

      // 2. Find the original provisioned reservation for this order.
      //    After a CANCEL triggers handlePostProvisionReturn, the reservation transitions
      //    from 'provisioned' → 'cancelled' while provisioned_at remains set.
      //    We query both statuses and filter by provisioned_at to handle that case.
      const existingReservations = await this.db.query<OriginalReservationRow>(
        'seller_stock_reservations',
        {
          select: 'id, seller_listing_id, status, provider_metadata, external_order_id, created_at, provisioned_at',
          eq: [['seller_listing_id', listing.id]],
          in: [
            ['status', ['provisioned', 'cancelled']],
            ['external_order_id', [orderId, ...(originalOrderId ? [originalOrderId] : [])]],
          ],
          order: { column: 'created_at', ascending: false },
          limit: 1,
        },
      );

      // Accept the reservation only if it was ever provisioned (either still 'provisioned'
      // or 'cancelled' after handlePostProvisionReturn ran and set provisioned_at).
      const originalReservation = existingReservations.find(
        (r) => r.status === 'provisioned' || r.provisioned_at !== null,
      ) ?? null;

      if (!originalReservation) {
        logger.warn('Replacement RESERVE: no provisioned reservation found — proceeding to claim only', {
          orderId, auctionId,
        });
      }

      // 3. Find the original delivered provision and mark the key faulty
      if (originalReservation) {
        await this.markOriginalKeyFaultyAndWriteOff(
          originalReservation,
          listing.id,
          orderId,
          enebaKeyId,
          providerCode,
        );
      }

      // 4. Claim a replacement key
      const expiresAt = new Date(Date.now() + THREE_CALENDAR_DAYS_MS).toISOString();

      const providerMetadata: Record<string, unknown> = {
        isReplacement: true,
        auctionId,
        enebaKeyId,
        replacesReservationId: originalReservation?.id ?? null,
      };

      let outcome;
      try {
        outcome = await this.keyOps.claimKeysForReservation({
          variantId: listing.variant_id,
          listingId: listing.id,
          providerAccountId: listing.provider_account_id,
          quantity: 1,
          // Different externalReservationId to avoid unique-key conflicts with original;
          // same externalOrderId so PROVIDE handler can find this reservation.
          externalReservationId: `${orderId}-r1`,
          externalOrderId: orderId,
          expiresAt,
          providerMetadata,
        });
      } catch (claimErr) {
        const claimMsg = claimErr instanceof Error ? claimErr.message : String(claimErr);
        const isNoStock = /INSUFFICIENT_STOCK|Key claim failed/.test(claimMsg);
        if (isNoStock) {
          logger.info('Replacement RESERVE: no keys available to fulfil replacement', {
            orderId, auctionId, variantId: listing.variant_id, error: claimMsg,
          });
        } else {
          logger.error('Replacement RESERVE: key claim failed unexpectedly', claimErr as Error, {
            orderId, auctionId, variantId: listing.variant_id,
          });
        }
        await this.healthPort.updateHealthCounters(auctionId, 'reservation', false);
        return {
          success: false,
          orderId,
          reason: isNoStock ? 'out_of_stock' : 'unexpected_error',
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
          quantity: 1,
          providerCode,
          viaJit: outcome.viaJit,
          isReplacement: true,
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

      logger.info('Replacement RESERVE completed — replacement key claimed', {
        orderId, auctionId,
        replacementReservationId: outcome.reservationId,
        replacesReservationId: originalReservation?.id ?? null,
      });

      return { success: true, orderId };
    } catch (err) {
      logger.error('Unexpected error in replacement RESERVE handler', err as Error, { orderId, auctionId });
      await this.healthPort.updateHealthCounters(auctionId, 'reservation', false).catch(() => undefined);
      return { success: false, orderId, reason: 'unexpected_error' };
    }
  }

  private async markOriginalKeyFaultyAndWriteOff(
    originalReservation: OriginalReservationRow,
    listingId: string,
    orderId: string,
    enebaKeyId: string,
    providerCode: string,
  ): Promise<void> {
    try {
      // Look for 'delivered' (still provisioned) or 'refunded' (restocked by handlePostProvisionReturn
      // after a CANCEL — the key is back in available inventory but was the one originally delivered).
      // Multi-key orders have one provision row per key delivered, so we use query (not queryOne)
      // and pick the first eligible row. We cannot map Eneba's keyId to our product_key_id since
      // we do not store that cross-reference during PROVIDE.
      const provisions = await this.db.query<OriginalProvisionRow>(
        'seller_key_provisions',
        {
          select: 'id, product_key_id, status',
          eq: [['reservation_id', originalReservation.id]],
          in: [['status', ['delivered', 'refunded']]],
          order: { column: 'id', ascending: true },
        },
      );

      const provision = provisions[0] ?? null;

      if (!provision) {
        logger.warn('Replacement RESERVE: no delivered provision found for original reservation', {
          reservationId: originalReservation.id, orderId,
          provisionCount: provisions.length,
        });
        return;
      }

      // Retrieve original key to get its linked order_id for the write-off transaction
      const faultyKey = await this.db.queryOne<FaultyKeyRow>('product_keys', {
        select: 'id, order_id',
        eq: [['id', provision.product_key_id]],
        single: true,
      });

      // Extract original per-unit gross amount from reservation metadata for write-off.
      // Use gross_cents_per_unit (not total_gross_cents) — for multi-key orders total_gross_cents
      // covers all keys; we are only writing off the single faulty key.
      const meta = originalReservation.provider_metadata;
      const financials = meta.marketplaceFinancials as Record<string, unknown> | undefined;
      const originalGrossCents =
        typeof financials?.gross_cents_per_unit === 'number'
          ? financials.gross_cents_per_unit
          : typeof financials?.total_gross_cents === 'number' && typeof financials?.key_count === 'number' && financials.key_count > 0
            ? Math.round((financials.total_gross_cents as number) / (financials.key_count as number))
            : (typeof (meta.price as Record<string, unknown> | undefined)?.amount === 'number'
              ? (meta.price as Record<string, unknown>).amount as number
              : 0);
      const originalCurrency = typeof financials?.currency === 'string'
        ? financials.currency
        : typeof (meta.price as Record<string, unknown> | undefined)?.currency === 'string'
          ? (meta.price as Record<string, unknown>).currency as string
          : 'EUR';

      // Mark key as faulty — marked_faulty_by is null (automated webhook, no admin actor)
      await this.db.update('product_keys', { id: provision.product_key_id }, {
        key_state: 'faulty',
        marked_faulty_at: new Date().toISOString(),
        marked_faulty_reason: 'marketplace_replacement',
        marked_faulty_by: null,
        ...(originalGrossCents > 0 ? { write_off_cents: originalGrossCents } : {}),
      });

      logger.info('Replacement RESERVE: original key marked faulty', {
        productKeyId: provision.product_key_id,
        reservationId: originalReservation.id,
        writtenOffCents: originalGrossCents,
        currency: originalCurrency,
      });

      // Insert debit write-off transaction to offset original marketplace_sale credit
      if (originalGrossCents > 0 && faultyKey?.order_id) {
        await this.db.insert('transactions', {
          order_id: faultyKey.order_id,
          type: 'marketplace_replacement_write_off',
          direction: 'debit',
          amount: originalGrossCents,
          currency: originalCurrency,
          status: 'completed',
          description: `${providerCode} key replacement write-off`,
          metadata: {
            provider_code: providerCode,
            reservation_id: originalReservation.id,
            listing_id: listingId,
            external_order_id: orderId,
            replaces_product_key_id: provision.product_key_id,
            eneba_key_id: enebaKeyId,
          },
        });

        logger.info('Replacement RESERVE: write-off transaction inserted', {
          orderId,
          originalKeyId: provision.product_key_id,
          writtenOffCents: originalGrossCents,
          currency: originalCurrency,
        });
      } else if (originalGrossCents > 0 && !faultyKey?.order_id) {
        logger.warn('Replacement RESERVE: cannot insert write-off — original key has no linked order_id', {
          productKeyId: provision.product_key_id, orderId,
        });
      }
    } catch (err) {
      // Do not abort the replacement — log and continue so Eneba gets a replacement key.
      logger.error('Replacement RESERVE: failed to mark key faulty or create write-off', err as Error, {
        reservationId: originalReservation.id, orderId,
      });
    }
  }
}
