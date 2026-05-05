/**
 * Seller key operations service — atomic key claim, decrypt, provision, release.
 *
 * Implements ISellerKeyOperationsPort.
 * Mirrors `provider-procurement/services/seller-key-operations.service.ts`.
 *
 * Key decryption delegates to the `encrypt-product-keys` Edge Function
 * via `db.invokeFunction()`.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type {
  ISellerKeyOperationsPort,
  ClaimKeysParams,
  ClaimKeysResult,
  ProvisionResult,
  DecryptedKey,
  CompleteProvisionParams,
  PostProvisionReturnParams,
} from '../../core/ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../core/ports/seller-domain-event.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('seller-key-operations');

@injectable()
export class SellerKeyOperationsService implements ISellerKeyOperationsPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async claimKeysForReservation(params: ClaimKeysParams): Promise<ClaimKeysResult> {
    const {
      variantId, listingId, providerAccountId, quantity,
      externalReservationId, externalOrderId, expiresAt,
      providerMetadata,
    } = params;

    try {
      const result = await this.db.rpc<{
        reservation_id: string;
        key_ids: string[];
      }>('claim_and_reserve_atomic', {
        p_variant_id: variantId,
        p_listing_id: listingId,
        p_provider_account_id: providerAccountId,
        p_quantity: quantity,
        p_external_reservation_id: externalReservationId,
        p_external_order_id: externalOrderId,
        p_expires_at: expiresAt,
        p_provider_metadata: providerMetadata ?? {},
      });

      return {
        reservationId: result.reservation_id,
        keyIds: result.key_ids,
        viaJit: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('INSUFFICIENT_STOCK') || msg.includes('Key claim failed')) {
        const jitResult = await this.attemptJitProcurement(params);
        if (jitResult) return jitResult;
      }

      throw err;
    }
  }

  async provisionFromPendingKeys(reservationId: string): Promise<ProvisionResult> {
    const provisions = await this.db.query<{
      id: string;
      product_key_id: string;
    }>('seller_key_provisions', {
      select: 'id, product_key_id',
      eq: [['reservation_id', reservationId], ['status', 'pending']],
    });

    if (provisions.length === 0) {
      throw new Error(`No pending provisions for reservation ${reservationId}`);
    }

    const keyIds = provisions.map((p) => p.product_key_id);

    await this.db.rpc('finalize_seller_provisions', {
      p_reservation_id: reservationId,
      p_provision_ids: provisions.map((p) => p.id),
    });

    const decryptedKeys = await this.decryptKeys(keyIds);

    return { keyIds, decryptedKeys };
  }

  async decryptDeliveredProvisionKeys(reservationId: string): Promise<{ decryptedKeys: DecryptedKey[] }> {
    const provisions = await this.db.query<{
      product_key_id: string;
    }>('seller_key_provisions', {
      select: 'product_key_id',
      eq: [['reservation_id', reservationId], ['status', 'delivered']],
    });

    if (provisions.length === 0) {
      return { decryptedKeys: [] };
    }

    const keyIds = provisions.map((p) => p.product_key_id);
    const decryptedKeys = await this.decryptKeys(keyIds);

    return { decryptedKeys };
  }

  async completeProvisionOrchestration(params: CompleteProvisionParams): Promise<void> {
    const {
      reservationId, listingId, providerCode, externalOrderId,
      keysProvisionedCount, priceCents, currency,
      marketplaceFinancialsSnapshot,
    } = params;

    try {
      await this.recordMarketplaceSale({
        reservationId,
        listingId,
        providerCode,
        externalOrderId,
        keysProvisioned: keysProvisionedCount,
        priceCents,
        currency,
        financialsSnapshot: marketplaceFinancialsSnapshot,
      });
    } catch (err) {
      logger.error('Failed to record marketplace sale', err as Error, { reservationId, externalOrderId });
    }

    const listing = await this.db.queryOne<{ variant_id: string }>('seller_listings', {
      select: 'variant_id',
      eq: [['id', listingId]],
      single: true,
    });

    await this.events.emitSellerEvent({
      eventType: 'seller.stock_provisioned',
      aggregateId: listingId,
      payload: {
        reservationId,
        listingId,
        variantId: listing?.variant_id,
        keysProvisioned: keysProvisionedCount,
        providerCode,
        externalOrderId,
      },
    });

    if (listing?.variant_id) {
      const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
        select: 'product_id',
        eq: [['id', listing.variant_id]],
        single: true,
      });

      if (variant?.product_id) {
        await this.events.emitInventoryStockChanged({
          productIds: [variant.product_id],
          variantIds: [listing.variant_id],
          reason: 'seller_provisioned',
        });
      }
    }
  }

  async releaseReservationKeys(reservationId: string, newStatus: string): Promise<number> {
    const result = await this.db.rpc<{ keys_released: number }>('release_seller_reserved_keys', {
      p_reservation_id: reservationId,
      p_new_status: newStatus,
    });

    return result.keys_released;
  }

  async handlePostProvisionReturn(params: PostProvisionReturnParams): Promise<number> {
    const { reservation, providerCode, externalOrderId, reason, maxKeysToRestock } = params;

    const deliveredProvisions = await this.db.query<{
      id: string;
      product_key_id: string;
      created_at: string;
    }>('seller_key_provisions', {
      select: 'id, product_key_id, created_at',
      eq: [['reservation_id', reservation.id], ['status', 'delivered']],
      order: { column: 'created_at', ascending: true },
    });

    const totalDelivered = deliveredProvisions.length;
    const cap = typeof maxKeysToRestock === 'number' && maxKeysToRestock >= 0
      ? Math.min(maxKeysToRestock, totalDelivered)
      : totalDelivered;
    const provisionsToReturn = deliveredProvisions.slice(0, cap);

    if (provisionsToReturn.length === 0) return 0;

    const productKeyIds = provisionsToReturn.map((p) => p.product_key_id);
    const RESTOCKABLE_STATES = ['seller_provisioned', 'seller_reserved', 'seller_uploaded'];

    let keysRestocked = 0;
    for (const keyId of productKeyIds) {
      try {
        const result = await this.db.rpc<{ success: boolean }>('restock_seller_key', {
          p_key_id: keyId,
          p_restockable_states: RESTOCKABLE_STATES,
        });
        if (result.success) keysRestocked++;
      } catch {
        logger.warn('Failed to restock key', { keyId, reservationId: reservation.id });
      }
    }

    const provisionIds = provisionsToReturn
      .filter((p) => productKeyIds.includes(p.product_key_id))
      .map((p) => p.id);

    if (provisionIds.length > 0) {
      for (const pid of provisionIds) {
        try {
          await this.db.update('seller_key_provisions', { id: pid }, { status: 'refunded' });
        } catch {
          logger.warn('Failed to flip provision status', { provisionId: pid });
        }
      }
    }

    await this.events.emitSellerEvent({
      eventType: 'seller.stock_cancelled',
      aggregateId: reservation.seller_listing_id,
      payload: {
        reservationId: reservation.id,
        reason,
        providerCode,
        keysReleased: keysRestocked,
      },
    });

    const listing = await this.db.queryOne<{ variant_id: string }>('seller_listings', {
      select: 'variant_id',
      eq: [['id', reservation.seller_listing_id]],
      single: true,
    });

    if (listing?.variant_id) {
      const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
        select: 'product_id',
        eq: [['id', listing.variant_id]],
        single: true,
      });

      if (variant?.product_id) {
        await this.events.emitInventoryStockChanged({
          productIds: [variant.product_id],
          variantIds: [listing.variant_id],
          reason: 'seller_cancelled',
        });
      }
    }

    logger.info('Post-provision return processed', {
      reservationId: reservation.id,
      providerCode,
      keysRestocked,
      externalOrderId,
    });

    return keysRestocked;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  private async decryptKeys(keyIds: string[]): Promise<DecryptedKey[]> {
    const result = await this.db.invokeFunction<{
      keys: Array<{ id: string; value: string }>;
    }>('encrypt-product-keys', {
      action: 'decrypt',
      key_ids: keyIds,
    });

    return (result.keys ?? []).map((k) => ({
      keyId: k.id,
      plaintext: k.value,
    }));
  }

  private async attemptJitProcurement(params: ClaimKeysParams): Promise<ClaimKeysResult | null> {
    try {
      logger.info('Attempting JIT procurement', {
        variantId: params.variantId,
        listingId: params.listingId,
        quantity: params.quantity,
      });

      await this.db.invokeFunction('provider-procurement', {
        action: 'purchase',
        variant_id: params.variantId,
        quantity: params.quantity,
        max_cost_cents: params.salePriceCents
          ? params.salePriceCents - (params.feesCents ?? 0) - (params.minMarginCents ?? 0)
          : undefined,
        source: 'jit_seller_webhook',
      });

      const retryResult = await this.db.rpc<{
        reservation_id: string;
        key_ids: string[];
      }>('claim_and_reserve_atomic', {
        p_variant_id: params.variantId,
        p_listing_id: params.listingId,
        p_provider_account_id: params.providerAccountId,
        p_quantity: params.quantity,
        p_external_reservation_id: params.externalReservationId,
        p_external_order_id: params.externalOrderId,
        p_expires_at: params.expiresAt,
        p_provider_metadata: params.providerMetadata ?? {},
      });

      return {
        reservationId: retryResult.reservation_id,
        keyIds: retryResult.key_ids,
        viaJit: true,
      };
    } catch (jitErr) {
      logger.warn('JIT procurement failed or post-JIT claim failed', jitErr as Error, {
        variantId: params.variantId,
      });
      return null;
    }
  }

  private async recordMarketplaceSale(params: {
    reservationId: string;
    listingId: string;
    providerCode: string;
    externalOrderId: string;
    keysProvisioned: number;
    priceCents?: number;
    currency?: string;
    financialsSnapshot?: Record<string, unknown>;
  }): Promise<void> {
    const { reservationId, listingId, providerCode, externalOrderId, keysProvisioned, priceCents, currency, financialsSnapshot } = params;

    const idempotencyKey = `seller:${reservationId}`;

    const existingOrder = await this.db.queryOne<{ id: string }>('orders', {
      select: 'id',
      eq: [['idempotency_key', idempotencyKey]],
      maybeSingle: true,
    });

    if (existingOrder) {
      logger.debug('Marketplace sale already recorded', { reservationId, orderId: existingOrder.id });
      return;
    }

    const totalAmount = (priceCents ?? 0) * keysProvisioned;

    await this.db.insert('orders', {
      idempotency_key: idempotencyKey,
      status: 'fulfilled',
      total_amount: totalAmount,
      currency: currency ?? 'EUR',
      payment_provider: providerCode,
      metadata: {
        source: 'marketplace_sale',
        provider_code: providerCode,
        external_order_id: externalOrderId,
        listing_id: listingId,
        reservation_id: reservationId,
        keys_provisioned: keysProvisioned,
        ...(financialsSnapshot && { marketplace_financials: financialsSnapshot }),
      },
    });

    const transactionAmount =
      typeof financialsSnapshot?.netPayoutCents === 'number'
        ? financialsSnapshot.netPayoutCents as number
        : totalAmount;

    await this.db.insert('transactions', {
      type: 'sale',
      direction: 'credit',
      amount: transactionAmount,
      currency: currency ?? 'EUR',
      status: 'completed',
      payment_provider: providerCode,
      description: `Marketplace sale via ${providerCode}`,
      metadata: {
        reservation_id: reservationId,
        listing_id: listingId,
        external_order_id: externalOrderId,
        keys_provisioned: keysProvisioned,
        ...(financialsSnapshot && { marketplace_financials: financialsSnapshot }),
      },
    });
  }
}
