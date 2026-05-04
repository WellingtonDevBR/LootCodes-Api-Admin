/**
 * Key-upload order handler (G2A order complete, Gamivo sale, Kinguin order).
 *
 * For key_upload model: the marketplace notifies us that an order was placed
 * and we need to deliver keys. Unlike declared-stock (which has RESERVE first),
 * this is a single-step operation.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type { KeyUploadOrderDto, KeyUploadOrderResult } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:key-upload-order');

@injectable()
export class HandleKeyUploadOrderUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: KeyUploadOrderDto): Promise<KeyUploadOrderResult> {
    const { externalOrderId, externalListingId, quantity, providerCode, priceCents, currency, providerMetadata } = dto;

    try {
      const listing = await this.db.queryOne<{
        id: string;
        variant_id: string;
        provider_account_id: string;
        price_cents: number;
        currency: string;
        min_jit_margin_cents: number | null;
      }>(
        'seller_listings',
        {
          select: 'id, variant_id, provider_account_id, price_cents, currency, min_jit_margin_cents',
          eq: [['external_listing_id', externalListingId]],
          single: true,
        },
      );

      if (!listing) {
        logger.error('Listing not found for key-upload order', { externalListingId, externalOrderId, providerCode });
        return { success: false };
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const outcome = await this.keyOps.claimKeysForReservation({
        variantId: listing.variant_id,
        listingId: listing.id,
        providerAccountId: listing.provider_account_id,
        quantity,
        externalReservationId: externalOrderId,
        externalOrderId,
        expiresAt,
        providerMetadata: providerMetadata ?? { providerCode, externalListingId },
        salePriceCents: priceCents ?? listing.price_cents,
        minMarginCents: listing.min_jit_margin_cents ?? undefined,
      });

      const provision = await this.keyOps.provisionFromPendingKeys(outcome.reservationId);

      try {
        await this.keyOps.completeProvisionOrchestration({
          reservationId: outcome.reservationId,
          listingId: listing.id,
          providerCode,
          externalOrderId,
          keyIds: provision.keyIds,
          keysProvisionedCount: provision.decryptedKeys.length,
          priceCents: priceCents ?? listing.price_cents,
          currency: currency ?? listing.currency,
        });
      } catch (orchestrationErr) {
        logger.error('Provision orchestration failed after delivery', orchestrationErr as Error, {
          externalOrderId, keysDelivered: provision.decryptedKeys.length,
        });
      }

      logger.info('Key-upload order completed', {
        externalOrderId, externalListingId, providerCode, keysDelivered: provision.decryptedKeys.length,
      });

      return { success: true, keysDelivered: provision.decryptedKeys.length };
    } catch (err) {
      logger.error('Unexpected error in key-upload order handler', err as Error, { externalOrderId, providerCode });
      return { success: false };
    }
  }
}
