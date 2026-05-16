/**
 * Gamivo POST /reservation handler.
 *
 * Gamivo delivers keys on /order (unlike G2A which delivers at reservation).
 * This handler only reserves stock with JIT fallback and returns reservation_id.
 *
 * Post-reservation work (health, events, stock notify) runs in background.
 */
import { injectable, inject } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type { IVariantUnavailabilityPort } from '../../../ports/variant-unavailability.port.js';
import type { GamivoReservationDto, GamivoReservationResult } from '../seller-webhook.types.js';
import { floatToCents } from './gamivo-parser.js';
import { MARKETPLACE_RESERVATION_EXPIRY_MS } from '../../../shared/stock-queries.js';
import { withLastRealizedNet } from '../../../shared/last-realized-net.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('webhook:gamivo:reservation');

interface ListingRow {
  id: string;
  variant_id: string;
  price_cents: number;
  currency: string;
  external_listing_id: string | null;
  min_jit_margin_cents: number | null;
  provider_account_id: string;
}

@injectable()
export class HandleGamivoReservationUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
    @inject(TOKENS.VariantUnavailability) private readonly unavailability: IVariantUnavailabilityPort,
  ) {}

  async execute(dto: GamivoReservationDto): Promise<GamivoReservationResult> {
    const { productId, quantity, unitPrice, providerAccountId } = dto;

    const listing = await this.db.queryOne<ListingRow>('seller_listings', {
      select: 'id, variant_id, price_cents, currency, external_listing_id, min_jit_margin_cents, provider_account_id',
      eq: [
        ['external_product_id', String(productId)],
        ['provider_account_id', providerAccountId],
        ['status', 'active'],
      ],
      single: true,
    });

    if (!listing) {
      logger.warn('No active listing found for Gamivo product', { productId, providerAccountId });
      return { ok: false, code: 'not_found', message: 'Product not found or not available', status: 404 };
    }

    const externalReservationId = randomUUID();
    const unitPriceCents = floatToCents(unitPrice);

    // Persist the realised seller-net BEFORE attempting JIT/key claim. Per
    // Gamivo's `seller_price` pricing model, the reservation's `unit_price`
    // IS the seller-net (retail_price − commission), so we can store it
    // directly without further deduction. See core/shared/last-realized-net.ts.
    if (Number.isFinite(unitPriceCents) && unitPriceCents > 0) {
      try {
        const metadataRows = await this.db.query<{
          provider_metadata: Record<string, unknown> | null;
        }>('seller_listings', { eq: [['id', listing.id]], select: 'provider_metadata' });
        const next = withLastRealizedNet(metadataRows[0]?.provider_metadata ?? null, {
          centsPerUnit: unitPriceCents,
          currency: (listing.currency ?? 'EUR').toUpperCase(),
          at: new Date().toISOString(),
        });
        await this.db.update('seller_listings', { id: listing.id }, {
          provider_metadata: next,
        });
      } catch (capErr) {
        logger.warn('Failed to capture last realised net (non-fatal)', capErr as Error, {
          listingId: listing.id, productId, unitPriceCents,
        });
      }
    }

    let outcome;
    try {
      outcome = await this.keyOps.claimKeysForReservation({
        variantId: listing.variant_id,
        listingId: listing.id,
        providerAccountId: listing.provider_account_id,
        quantity,
        externalReservationId,
        externalOrderId: externalReservationId,
        expiresAt: new Date(Date.now() + MARKETPLACE_RESERVATION_EXPIRY_MS).toISOString(),
        providerMetadata: {
          gamivo_product_id: productId,
          unit_price: unitPrice,
          unit_price_cents: unitPriceCents,
          currency: listing.currency ?? 'EUR',
          provider: 'gamivo',
        },
        salePriceCents: unitPriceCents,
        salePriceCurrency: listing.currency ?? 'EUR',
        minMarginCents: listing.min_jit_margin_cents ?? undefined,
      });
    } catch (claimErr) {
      // Match the Eneba handler's classification (see
      // handle-declared-stock-reserve.use-case.ts): INSUFFICIENT_STOCK after
      // JIT exhaustion is a normal business outcome — Gamivo gets a 400 and
      // retries. Only unrecognized failures (DB errors, RPC timeouts, …)
      // are real bugs worth a Sentry alert.
      const claimMsg = claimErr instanceof Error ? claimErr.message : String(claimErr);
      const isExpectedNoStock = /INSUFFICIENT_STOCK|Key claim failed/.test(claimMsg);
      if (isExpectedNoStock) {
        logger.warn('Gamivo reservation: no keys available — propagating variant unavailability', {
          productId, quantity, variantId: listing.variant_id, error: claimMsg,
        });
      } else {
        logger.error('Gamivo reservation: key claim failed unexpectedly', claimErr as Error, {
          productId, quantity, variantId: listing.variant_id,
        });
      }

      if (listing.external_listing_id) {
        await this.healthPort.updateHealthCounters(listing.external_listing_id, 'reservation', false);
      }

      setImmediate(() => {
        this.unavailability.propagateVariantUnavailable(listing.variant_id, 'jit_failed')
          .catch((err) => logger.warn('Unavailability propagation failed', { err }));
      });

      return { ok: false, code: 'insufficient_stock', message: 'Not enough stock available', status: 400 };
    }

    setImmediate(() => {
      (async () => {
        if (listing.external_listing_id) {
          await this.healthPort.updateHealthCounters(listing.external_listing_id, 'reservation', true);
        }
        await this.events.emitSellerEvent({
          eventType: 'seller.stock_reserved',
          aggregateId: listing.id,
          payload: {
            reservationId: outcome.reservationId,
            listingId: listing.id,
            variantId: listing.variant_id,
            quantity,
            providerCode: 'gamivo',
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
      })().catch((err) => logger.warn('Gamivo reservation background work failed', { err }));
    });

    logger.info('Gamivo reservation created', {
      reservationId: outcome.reservationId,
      productId,
      quantity,
      keysClaimed: outcome.keyIds.length,
      viaJit: outcome.viaJit,
    });

    return { ok: true, reservationId: outcome.reservationId };
  }
}
