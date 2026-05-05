/**
 * Digiseller form delivery handler.
 *
 * Flow:
 *   1. Find listing by external_product_id + provider_account_id
 *   2. Claim keys via reserveWithJitFallback
 *   3. Provision keys (decrypt)
 *   4. Complete provision orchestration
 *   5. Return decrypted keys for Digiseller delivery
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../di/tokens.js';
import type { IDatabase } from '../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../ports/seller-domain-event.port.js';
import type { DigisellerDeliveryDto, DigisellerDeliveryResult } from './seller-webhook.types.js';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('webhook:digiseller');

@injectable()
export class HandleDigisellerDeliveryUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: DigisellerDeliveryDto): Promise<DigisellerDeliveryResult> {
    const { uniqueCode, productId, quantity, providerAccountId, providerCode } = dto;

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
          eq: [['external_product_id', productId], ['provider_account_id', providerAccountId]],
          single: true,
        },
      );

      if (!listing) {
        logger.error('Listing not found for Digiseller delivery', { productId, providerAccountId });
        return { success: false };
      }

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      const outcome = await this.keyOps.claimKeysForReservation({
        variantId: listing.variant_id,
        listingId: listing.id,
        providerAccountId: listing.provider_account_id,
        quantity,
        externalReservationId: uniqueCode,
        externalOrderId: uniqueCode,
        expiresAt,
        providerMetadata: {
          digiseller_unique_code: uniqueCode,
          digiseller_product_id: productId,
        },
        salePriceCents: listing.price_cents,
        minMarginCents: listing.min_jit_margin_cents ?? undefined,
      });

      const provision = await this.keyOps.provisionFromPendingKeys(outcome.reservationId);

      const keys = provision.decryptedKeys.map((k) => k.plaintext);

      try {
        const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
          select: 'product_id',
          eq: [['id', listing.variant_id]],
          single: true,
        });

        await this.keyOps.completeProvisionOrchestration({
          reservationId: outcome.reservationId,
          listingId: listing.id,
          variantId: listing.variant_id,
          productId: variant?.product_id ?? '',
          providerCode,
          externalOrderId: uniqueCode,
          keyIds: provision.keyIds,
          keysProvisionedCount: provision.decryptedKeys.length,
          priceCents: listing.price_cents,
          currency: listing.currency,
        });
      } catch (orchestrationErr) {
        logger.error('Provision orchestration failed after key delivery', orchestrationErr as Error, {
          uniqueCode, keysDelivered: keys.length,
        });
      }

      logger.info('Digiseller delivery completed', {
        uniqueCode, productId, keysDelivered: keys.length,
      });

      return { success: true, keys };
    } catch (err) {
      logger.error('Unexpected error in Digiseller delivery', err as Error, { uniqueCode, productId });
      return { success: false };
    }
  }
}
