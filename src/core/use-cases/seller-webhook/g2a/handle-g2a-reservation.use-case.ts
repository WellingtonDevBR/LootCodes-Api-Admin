/**
 * G2A POST /reservation handler.
 *
 * G2A delivers keys at reservation time (unlike Eneba which delivers at
 * PROVIDE). For each product in the request:
 *   1. Find the matching seller_listing by external_product_id
 *   2. Reserve via claimKeysForReservation (claim-first, JIT on shortage)
 *   3. Decrypt via provisionFromPendingKeys (synchronous — keys go in response)
 *   4. Return decrypted keys in the reservation response
 *
 * Post-reservation work (events, health, stock notify) runs in background.
 */
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type { IListingHealthPort } from '../../ports/seller-listing-health.port.js';
import type { IVariantUnavailabilityPort } from '../../ports/variant-unavailability.port.js';
import type {
  G2AReservationDto,
  G2AReservationResponse,
  G2AStockItem,
} from './seller-webhook.types.js';
import {
  buildStockInventoryItem,
  buildStockItem,
  buildReservationResponse,
} from './g2a-parser.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:g2a:reservation');

const G2A_RESERVATION_EXPIRY_MS = 30 * 60 * 1000;

interface ListingRow {
  id: string;
  variant_id: string;
  price_cents: number;
  external_listing_id: string | null;
  min_jit_margin_cents: number | null;
  provider_account_id: string;
}

@injectable()
export class HandleG2AReservationUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
    @inject(TOKENS.VariantUnavailability) private readonly unavailability: IVariantUnavailabilityPort,
  ) {}

  async execute(dto: G2AReservationDto): Promise<
    | { ok: true; response: G2AReservationResponse }
    | { ok: false; code: string; message: string; status: number }
  > {
    const { items, providerAccountId } = dto;

    const reservationId = randomUUID();
    const stockItems: G2AStockItem[] = [];
    const backgroundWork: Array<() => Promise<void>> = [];

    for (const item of items) {
      const listing = await this.db.queryOne<ListingRow>('seller_listings', {
        select: 'id, variant_id, price_cents, external_listing_id, min_jit_margin_cents, provider_account_id',
        eq: [
          ['external_product_id', String(item.product_id)],
          ['provider_account_id', providerAccountId],
          ['status', 'active'],
          ['listing_type', 'declared_stock'],
        ],
        single: true,
      });

      if (!listing) {
        logger.warn('No active listing found for G2A product', {
          product_id: item.product_id, providerAccountId,
        });
        return { ok: false, code: 'BR02', message: `Product not available: ${item.product_id}`, status: 400 };
      }

      const expiresAt = new Date(Date.now() + G2A_RESERVATION_EXPIRY_MS).toISOString();

      let outcome;
      try {
        outcome = await this.keyOps.claimKeysForReservation({
          variantId: listing.variant_id,
          listingId: listing.id,
          providerAccountId: listing.provider_account_id,
          quantity: item.quantity,
          externalReservationId: reservationId,
          externalOrderId: reservationId,
          expiresAt,
          providerMetadata: {
            g2a_product_id: item.product_id,
            additional_data: item.additional_data,
            provider: 'g2a',
          },
          salePriceCents: listing.price_cents ?? undefined,
          minMarginCents: listing.min_jit_margin_cents ?? undefined,
        });
      } catch (claimErr) {
        logger.error('G2A reservation failed — insufficient stock', claimErr as Error, {
          product_id: item.product_id, quantity: item.quantity, variantId: listing.variant_id,
        });

        if (listing.external_listing_id) {
          await this.healthPort.updateHealthCounters(listing.external_listing_id, 'reservation', false);
        }

        setImmediate(() => {
          this.unavailability.propagateVariantUnavailable(listing.variant_id, 'jit_failed')
            .catch((err) => logger.warn('Unavailability propagation failed', { err }));
        });

        return { ok: false, code: 'BR02', message: `Insufficient stock for product: ${item.product_id}`, status: 400 };
      }

      let provisionResult;
      try {
        provisionResult = await this.keyOps.provisionFromPendingKeys(outcome.reservationId);
      } catch (provErr) {
        logger.error('provisionFromPendingKeys failed — releasing keys', provErr as Error, {
          reservationId: outcome.reservationId, product_id: item.product_id,
        });

        await this.keyOps.releaseReservationKeys(outcome.reservationId, 'failed')
          .catch((releaseErr) => {
            logger.error('CRITICAL: Failed to release keys after provision failure', releaseErr as Error, {
              reservationId: outcome.reservationId,
            });
          });

        if (listing.external_listing_id) {
          await this.healthPort.updateHealthCounters(listing.external_listing_id, 'provision', false);
        }

        return { ok: false, code: 'ERR99', message: 'Failed to provision keys', status: 500 };
      }

      const availableCount = await this.countAvailableKeys(listing.variant_id);

      const inventoryItems = provisionResult.keyIds.map((keyId, idx) =>
        buildStockInventoryItem(keyId, provisionResult.decryptedKeys[idx]?.plaintext ?? ''),
      );
      stockItems.push(buildStockItem(item.product_id, availableCount, inventoryItems));

      const capturedListing = listing;
      const capturedOutcome = outcome;
      backgroundWork.push(async () => {
        if (capturedListing.external_listing_id) {
          await this.healthPort.updateHealthCounters(capturedListing.external_listing_id, 'reservation', true);
        }
        await this.events.emitSellerEvent({
          eventType: 'seller.stock_reserved',
          aggregateId: capturedListing.id,
          payload: {
            reservationId: capturedOutcome.reservationId,
            listingId: capturedListing.id,
            variantId: capturedListing.variant_id,
            quantity: item.quantity,
            providerCode: 'g2a',
            viaJit: capturedOutcome.viaJit,
          },
        });

        const variantData = await this.db.queryOne<{ product_id: string }>('product_variants', {
          select: 'product_id',
          eq: [['id', capturedListing.variant_id]],
          single: true,
        });
        if (variantData?.product_id) {
          await this.events.emitInventoryStockChanged({
            productIds: [variantData.product_id],
            variantIds: [capturedListing.variant_id],
            reason: 'seller_reserved',
          });
        }
      });

      logger.info('G2A reservation item fulfilled', {
        reservationId,
        product_id: item.product_id,
        keysClaimed: outcome.keyIds.length,
        keysDecrypted: provisionResult.decryptedKeys.length,
        viaJit: outcome.viaJit,
      });
    }

    if (backgroundWork.length > 0) {
      setImmediate(() => {
        Promise.all(backgroundWork.map((fn) => fn()))
          .catch((err) => logger.warn('G2A reservation background work failed', { err }));
      });
    }

    return { ok: true, response: buildReservationResponse(reservationId, stockItems) };
  }

  private async countAvailableKeys(variantId: string): Promise<number> {
    const keys = await this.db.query<{ id: string }>('product_keys', {
      select: 'id',
      eq: [['variant_id', variantId], ['key_state', 'available']],
    });
    return keys.length;
  }
}
