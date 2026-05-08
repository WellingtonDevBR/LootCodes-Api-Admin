/**
 * Kinguin seller webhook use case — handles all Envoy lifecycle statuses.
 *
 * Kinguin sends a single POST endpoint with a `status` field discriminator.
 * Fulfillment: decrypt locally -> POST key to Kinguin via Upload Stock -> finalize DB.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerKeyOperationsPort } from '../../../ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { IListingHealthPort } from '../../../ports/seller-listing-health.port.js';
import type { IVariantUnavailabilityPort } from '../../../ports/variant-unavailability.port.js';
import type { IKinguinKeyUploadPort } from '../../../ports/kinguin-key-upload.port.js';
import type { KinguinWebhookDto, KinguinWebhookResult } from '../seller-webhook.types.js';
import {
  normalizeKinguinWebhookStatus,
  resolveOrderedQuantity,
  resolveKinguinExternalOrderId,
  buildBuyingProviderMetadata,
  resolveKinguinSalePricing,
  mimeTypeForProductKeyFormat,
  type KinguinWebhookPayload,
} from './kinguin-parser.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('kinguin-webhook-uc');

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function jsonResult(body: Record<string, unknown>, status = 200): KinguinWebhookResult {
  return { ok: true, status, body };
}

@injectable()
export class HandleKinguinWebhookUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerKeyOperations) private readonly keyOps: ISellerKeyOperationsPort,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
    @inject(TOKENS.ListingHealth) private readonly healthPort: IListingHealthPort,
    @inject(TOKENS.VariantUnavailability) private readonly unavailPort: IVariantUnavailabilityPort,
    @inject(TOKENS.KinguinKeyUpload) private readonly keyUpload: IKinguinKeyUploadPort,
  ) {}

  async execute(dto: KinguinWebhookDto): Promise<KinguinWebhookResult> {
    const { payload } = dto;
    const normalizedStatus = normalizeKinguinWebhookStatus(payload.status);

    logger.info('Kinguin webhook received', {
      reservationId: payload.reservationId,
      offerId: payload.offerId,
      status: payload.status,
      normalizedStatus,
      productId: payload.productId,
    });

    if (!normalizedStatus) {
      return jsonResult({ status: 'ok', notice: 'no_status_field' });
    }

    switch (normalizedStatus) {
      case 'BUYING':
        return this.handleBuying(payload);
      case 'BOUGHT':
      case 'OUT_OF_STOCK':
        return this.handleFulfillment(payload);
      case 'CANCELED':
        return this.handleCancellation(payload, 'kinguin_buyer_cancelled', 'CANCELED');
      case 'REVERSED':
        return this.handleCancellation(payload, 'kinguin_payment_reversed', 'REVERSED');
      case 'DELIVERED':
        return this.handleDelivered(payload);
      case 'RETURNED':
        return this.handleReturned(payload);
      case 'REFUNDED':
        return this.handleRefunded(payload);
      case 'PROCESSING_PREORDER':
        return this.handlePreorder(payload);
      case 'OFFER_BLOCKED':
        return this.handleOfferBlocked(payload);
      case 'PROCESSING_INGAME':
      case 'CHAT_MESSAGE':
      case 'ORDER_PROCESSING':
        return this.handleNoop(payload, normalizedStatus);
      default:
        logger.info('Kinguin status acknowledged (unhandled)', {
          status: payload.status, normalizedStatus,
          reservationId: payload.reservationId,
        });
        return jsonResult({ status: 'ok' });
    }
  }

  // ─── BUYING: pre-payment reservation with JIT fallback ────────────

  private async handleBuying(payload: KinguinWebhookPayload): Promise<KinguinWebhookResult> {
    const reservationId = payload.reservationId ?? '';
    const offerId = payload.offerId ?? '';
    const orderQty = resolveOrderedQuantity(payload);
    const externalOrderId = resolveKinguinExternalOrderId(
      reservationId, payload.orderIncrementId,
    );

    const listing = await this.findDeclaredStockListing(offerId);
    if (!listing) return jsonResult({ status: 'ok', warning: 'listing_not_found' });
    if (listing.status !== 'active') return jsonResult({ status: 'ok', warning: 'listing_inactive' });
    if (!listing.provider_account_id) return jsonResult({ status: 'ok', warning: 'listing_invalid' });

    const existing = await this.findReservation(reservationId);
    if (existing?.status === 'provisioned') return jsonResult({ status: 'ok' });
    if (existing && existing.status !== 'pending') {
      return jsonResult({ status: 'ok', warning: 'reservation_not_pending' });
    }

    try {
      const outcome = await this.keyOps.claimKeysForReservation({
        variantId: listing.variant_id,
        listingId: listing.id,
        providerAccountId: listing.provider_account_id,
        quantity: orderQty,
        externalReservationId: reservationId,
        externalOrderId,
        expiresAt: new Date(Date.now() + FIFTEEN_MINUTES_MS).toISOString(),
        providerMetadata: buildBuyingProviderMetadata(payload, orderQty),
        salePriceCents: listing.price_cents ?? undefined,
        minMarginCents: listing.min_jit_margin_cents ?? undefined,
      });

      this.emitReservationEvent(
        listing.id, listing.variant_id, outcome.reservationId, orderQty,
      );
      return jsonResult({ status: 'ok' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('INSUFFICIENT_STOCK') || msg.includes('Key claim failed')) {
        logger.warn('Kinguin BUYING reservation: insufficient_stock', err as Error, {
          reservationId, offerId, listingId: listing.id, variantId: listing.variant_id,
          requestedQuantity: orderQty,
        });
        this.propagateUnavailable(listing.variant_id, 'jit_failed');
        return jsonResult({ status: 'ok', warning: 'insufficient_stock' });
      }
      logger.error('BUYING reservation failed', err as Error, {
        reservationId, offerId,
      });
      return { ok: false, status: 500, body: { status: 'error', message: 'reservation_failed' } };
    }
  }

  // ─── BOUGHT / OUT_OF_STOCK: full fulfillment pipeline ─────────────

  private async handleFulfillment(
    payload: KinguinWebhookPayload,
  ): Promise<KinguinWebhookResult> {
    const reservationId = payload.reservationId ?? '';
    const offerId = payload.offerId ?? '';
    const orderQty = resolveOrderedQuantity(payload);

    const listing = await this.findDeclaredStockListing(offerId);
    if (!listing) return jsonResult({ status: 'ok', warning: 'listing_not_found' });
    if (!listing.provider_account_id) {
      return jsonResult({ status: 'ok', warning: 'listing_invalid' });
    }

    const existing = await this.findReservation(reservationId);
    if (existing?.status === 'provisioned') return jsonResult({ status: 'ok' });
    if (existing && existing.status !== 'pending') {
      return jsonResult({ status: 'ok', notice: 'reservation_not_pending' });
    }

    let dbReservationId: string;

    if (existing) {
      dbReservationId = existing.id;
    } else {
      try {
        const outcome = await this.keyOps.claimKeysForReservation({
          variantId: listing.variant_id,
          listingId: listing.id,
          providerAccountId: listing.provider_account_id,
          quantity: orderQty,
          externalReservationId: reservationId,
          externalOrderId: resolveKinguinExternalOrderId(
            reservationId, payload.orderIncrementId,
          ),
          expiresAt: new Date(Date.now() + FIFTEEN_MINUTES_MS).toISOString(),
          providerMetadata: {
            offerId,
            productId: payload.productId,
            requestedKeyType: payload.requestedKeyType,
            orderedQuantity: orderQty,
          },
          salePriceCents: listing.price_cents ?? undefined,
          minMarginCents: listing.min_jit_margin_cents ?? undefined,
        });
        dbReservationId = outcome.reservationId;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('INSUFFICIENT_STOCK') || msg.includes('Key claim failed')) {
          this.propagateUnavailable(listing.variant_id, 'jit_failed');
          return jsonResult({ status: 'error', message: 'key_claim_failed' });
        }
        throw err;
      }
    }

    // Step 1: Decrypt without finalizing DB (keys stay "pending" in DB)
    let provisionPrepared;
    try {
      provisionPrepared = await this.keyOps.decryptPendingWithoutFinalize(
        dbReservationId,
      );
    } catch (provErr) {
      logger.error('Decrypt pending failed — releasing keys', provErr as Error, {
        reservationId, dbReservationId,
      });
      await this.healthPort.updateHealthCounters(offerId, 'provision', false);
      await this.keyOps.releaseReservationKeys(dbReservationId, 'failed')
        .catch((e) => {
          logger.error(
            'CRITICAL: Failed to release keys after provision failure',
            e as Error, { dbReservationId },
          );
        });
      return jsonResult({ status: 'error', message: 'provision_failed' });
    }

    const { decryptedKeys, keyFormats } = provisionPrepared;
    if (decryptedKeys.length === 0) {
      await this.healthPort.updateHealthCounters(offerId, 'provision', false);
      return jsonResult({ status: 'error', message: 'no_keys_available' });
    }

    // Step 2: Upload each decrypted key to Kinguin via Upload Stock
    try {
      for (let i = 0; i < decryptedKeys.length; i++) {
        await this.keyUpload.uploadKeyWithRetry(
          offerId,
          decryptedKeys[i].plaintext,
          reservationId,
          mimeTypeForProductKeyFormat(keyFormats[i] ?? 'text'),
          listing.provider_account_id,
        );
      }
    } catch (uploadErr) {
      logger.error('Failed to deliver key to Kinguin', uploadErr as Error, {
        reservationId, offerId, keysDecrypted: decryptedKeys.length,
      });
      await this.healthPort.updateHealthCounters(offerId, 'provision', false);
      await this.keyOps.releaseReservationKeys(dbReservationId, 'failed')
        .catch((e) => {
          logger.error(
            'CRITICAL: Failed to release keys after upload failure',
            e as Error, { dbReservationId },
          );
        });
      return jsonResult({ status: 'error', message: 'upload_failed' });
    }

    // Step 3: Finalize DB + orchestrate sale recording + domain events
    try {
      await this.keyOps.finalizeProvisions(
        dbReservationId,
        provisionPrepared.keyIds,
        provisionPrepared.provisionIds,
      );
      await this.healthPort.updateHealthCounters(offerId, 'provision', true);

      const kinguinSale = resolveKinguinSalePricing(payload);
      const variant = await this.db.queryOne<{ product_id: string }>(
        'product_variants',
        { select: 'product_id', eq: [['id', listing.variant_id]], single: true },
      );

      await this.keyOps.completeProvisionOrchestration({
        reservationId: dbReservationId,
        listingId: listing.id,
        variantId: listing.variant_id,
        productId: variant?.product_id ?? listing.variant_id,
        providerCode: 'kinguin',
        externalOrderId: reservationId,
        keyIds: provisionPrepared.keyIds,
        keysProvisionedCount: decryptedKeys.length,
        priceCents: kinguinSale?.grossCents ?? listing.price_cents ?? 0,
        feeCents: kinguinSale ? kinguinSale.grossCents - kinguinSale.netCents : 0,
        currency: kinguinSale?.currency ?? 'EUR',
      });
    } catch (finalizeErr) {
      logger.error(
        'Finalize/orchestration failed after successful upload',
        finalizeErr as Error, { reservationId, dbReservationId },
      );
      await this.healthPort.updateHealthCounters(offerId, 'provision', false);
      return jsonResult({ status: 'error', message: 'finalize_failed' });
    }

    // Best-effort post-sale restock
    this.keyUpload.reassertDeclaredStock(
      listing.id, offerId, listing.provider_account_id, reservationId,
    ).catch((err: unknown) => {
      logger.warn('Kinguin reassertDeclaredStock failed (post-sale restock)', err as Error, {
        listingId: listing.id, offerId, reservationId,
      });
    });

    return jsonResult({ status: 'ok', provisioned: decryptedKeys.length });
  }

  // ─── CANCELED / REVERSED ──────────────────────────────────────────

  private async handleCancellation(
    payload: KinguinWebhookPayload,
    reason: string,
    logLabel: string,
  ): Promise<KinguinWebhookResult> {
    const reservationId = payload.reservationId ?? '';
    const offerId = payload.offerId ?? '';
    const reservation = await this.findReservation(reservationId);
    if (!reservation) return jsonResult({ status: 'ok' });

    if (reservation.status === 'provisioned') {
      const keysRestocked = await this.keyOps.handlePostProvisionReturn({
        reservation: {
          id: reservation.id,
          seller_listing_id: reservation.seller_listing_id,
          quantity: reservation.quantity,
        },
        providerCode: 'kinguin',
        externalOrderId: reservationId,
        reason,
      });
      logger.info(`Kinguin ${logLabel} — post-provision cancel`, {
        reservationId, offerId, keysRestocked,
      });
      return jsonResult({ status: 'ok' });
    }

    if (reservation.status === 'pending') {
      const keysReleased = await this.keyOps.releaseReservationKeys(
        reservation.id, 'cancelled',
      );
      await this.events.emitSellerEvent({
        eventType: 'seller.stock_cancelled',
        aggregateId: reservation.seller_listing_id,
        payload: {
          reservationId: reservation.id,
          reason,
          providerCode: 'kinguin',
          keysReleased,
        },
      });
      logger.info(`Kinguin ${logLabel} — released claimed keys`, {
        reservationId, offerId, keysReleased,
      });
      return jsonResult({ status: 'ok' });
    }

    await this.db.update(
      'seller_stock_reservations', { id: reservation.id }, { status: 'cancelled' },
    ).catch((err: unknown) => {
      logger.warn('Kinguin cancellation: failed to mark reservation cancelled', err as Error, {
        reservationId: reservation.id,
      });
    });

    return jsonResult({ status: 'ok' });
  }

  // ─── DELIVERED: sale completed ────────────────────────────────────

  private async handleDelivered(
    payload: KinguinWebhookPayload,
  ): Promise<KinguinWebhookResult> {
    const listingId = await this.listingIdForOffer(payload.offerId);
    if (!listingId) return jsonResult({ status: 'ok', warning: 'listing_not_found' });

    await this.events.emitSellerEvent({
      eventType: 'seller.sale_completed',
      aggregateId: listingId,
      payload: {
        externalListingId: payload.offerId,
        externalReservationId: payload.reservationId,
        providerCode: 'kinguin',
      },
    });
    return jsonResult({ status: 'ok' });
  }

  // ─── RETURNED: merchandise return with key restock ────────────────

  private async handleReturned(
    payload: KinguinWebhookPayload,
  ): Promise<KinguinWebhookResult> {
    const reservationId = payload.reservationId ?? '';
    const offerId = payload.offerId ?? '';
    const reservation = await this.findReservation(reservationId);

    const listingId = await this.listingIdForOffer(offerId);
    if (listingId) {
      await this.events.emitSellerEvent({
        eventType: 'seller.sale_refunded',
        aggregateId: listingId,
        payload: {
          providerCode: 'kinguin',
          reservationId,
          reason: 'kinguin_returned',
        },
      });
    }

    if (!reservation) return jsonResult({ status: 'ok' });

    if (reservation.status === 'pending') {
      await this.keyOps.releaseReservationKeys(reservation.id, 'cancelled');
      return jsonResult({ status: 'ok' });
    }

    await this.keyOps.handlePostProvisionReturn({
      reservation: {
        id: reservation.id,
        seller_listing_id: reservation.seller_listing_id,
        quantity: reservation.quantity,
      },
      providerCode: 'kinguin',
      externalOrderId: reservationId,
      reason: 'kinguin_returned',
    });
    return jsonResult({ status: 'ok' });
  }

  // ─── REFUNDED: complaint refund (keys stay provisioned) ───────────

  private async handleRefunded(
    payload: KinguinWebhookPayload,
  ): Promise<KinguinWebhookResult> {
    const reservationId = payload.reservationId ?? '';
    const offerId = payload.offerId ?? '';
    const reason = 'kinguin_complaint_refund';
    const reservation = await this.findReservation(reservationId);

    const listingId = await this.listingIdForOffer(offerId);
    if (listingId) {
      await this.events.emitSellerEvent({
        eventType: 'seller.sale_refunded',
        aggregateId: listingId,
        payload: { providerCode: 'kinguin', reservationId, reason },
      });
    }

    if (!reservation) return jsonResult({ status: 'ok' });

    if (reservation.status === 'provisioned') {
      await this.db.update(
        'seller_stock_reservations',
        { id: reservation.id },
        { status: 'cancelled' },
      ).catch((err: unknown) => {
        logger.warn('Kinguin refund: failed to mark provisioned reservation cancelled', err as Error, {
          reservationId: reservation.id,
        });
      });

      await this.db.insert('admin_alerts', {
        alert_type: 'marketplace_complaint_refund',
        severity: 'high',
        title: 'Kinguin complaint refund after provision',
        message: `Kinguin REFUNDED reservation ${reservationId}. Keys stay provisioned. Review if replacement or credit is needed.`,
        metadata: {
          provider_code: 'kinguin',
          reservation_id: reservation.id,
          external_reservation_id: reservationId,
          listing_id: reservation.seller_listing_id,
        },
      }).catch((err: unknown) => {
        logger.warn('Kinguin refund: failed to insert admin_alerts row', err as Error, {
          reservationId: reservation.id,
        });
      });
    } else if (reservation.status === 'pending') {
      await this.keyOps.releaseReservationKeys(reservation.id, 'cancelled');
    } else {
      await this.db.update(
        'seller_stock_reservations',
        { id: reservation.id },
        { status: 'cancelled' },
      ).catch((err: unknown) => {
        logger.warn('Kinguin refund: failed to mark non-pending reservation cancelled', err as Error, {
          reservationId: reservation.id,
          status: reservation.status,
        });
      });
    }

    return jsonResult({ status: 'ok' });
  }

  // ─── OFFER_BLOCKED: pause listing + admin alert ───────────────────

  private async handleOfferBlocked(
    payload: KinguinWebhookPayload,
  ): Promise<KinguinWebhookResult> {
    const offerId = payload.offerId ?? '';
    const block = payload.blockedReason ?? payload.errorMessage ?? '';
    const blockedAt = new Date().toISOString();

    const listing = await this.db.queryOne<{
      id: string;
      provider_metadata: Record<string, unknown>;
    }>('seller_listings', {
      select: 'id, provider_metadata',
      eq: [['external_listing_id', offerId], ['listing_type', 'declared_stock']],
      maybeSingle: true,
    });

    if (!listing) return jsonResult({ status: 'ok', warning: 'listing_not_found' });

    const prevMeta = (
      listing.provider_metadata && typeof listing.provider_metadata === 'object'
    ) ? listing.provider_metadata : {};

    const msgParts = ['Kinguin blocked this offer.'];
    if (block) msgParts.push(`Reason: ${block}`);
    if (blockedAt) msgParts.push(`Blocked at: ${blockedAt}`);

    await this.db.update('seller_listings', { id: listing.id }, {
      status: 'paused',
      error_message: msgParts.join(' '),
      provider_metadata: {
        ...prevMeta,
        kinguinOfferBlocked: {
          block,
          blockedAt,
          recordedAt: new Date().toISOString(),
        },
      },
    });

    await this.events.emitSellerEvent({
      eventType: 'seller.listing_updated',
      aggregateId: listing.id,
      payload: {
        providerCode: 'kinguin',
        externalListingId: offerId,
        kinguinReason: 'offer_blocked',
        block,
        blockedAt,
      },
    });

    await this.db.insert('admin_alerts', {
      alert_type: 'marketplace_offer_blocked',
      severity: 'high',
      title: 'Kinguin OFFER_BLOCKED',
      message: msgParts.join(' '),
      metadata: {
        provider_code: 'kinguin',
        listing_id: listing.id,
        offer_id: offerId,
        block,
        blockedAt,
      },
    }).catch((err: unknown) => {
      logger.warn('Kinguin OFFER_BLOCKED: failed to insert admin_alerts row', err as Error, {
        listingId: listing.id,
        offerId,
      });
    });

    return jsonResult({ status: 'ok', offer_blocked: true });
  }

  private async handlePreorder(
    payload: KinguinWebhookPayload,
  ): Promise<KinguinWebhookResult> {
    logger.warn('Kinguin PROCESSING_PREORDER', {
      reservationId: payload.reservationId,
      offerId: payload.offerId,
    });
    return jsonResult({ status: 'ok' });
  }

  private async handleNoop(
    payload: KinguinWebhookPayload,
    eventLabel: string,
  ): Promise<KinguinWebhookResult> {
    logger.info(`Kinguin ${eventLabel} — no server automation`, {
      reservationId: payload.reservationId,
      offerId: payload.offerId,
    });
    return jsonResult({ status: 'ok', notice: 'noop_acknowledged' });
  }

  // ─── DB helpers ───────────────────────────────────────────────────

  private async findDeclaredStockListing(offerId: string | undefined) {
    if (!offerId) return null;
    return this.db.queryOne<{
      id: string;
      variant_id: string;
      status: string;
      provider_account_id: string;
      price_cents: number | null;
      currency: string;
      min_jit_margin_cents: number | null;
    }>('seller_listings', {
      select: 'id, variant_id, status, provider_account_id, price_cents, currency, min_jit_margin_cents',
      eq: [['external_listing_id', offerId], ['listing_type', 'declared_stock']],
      maybeSingle: true,
    });
  }

  private async findReservation(externalReservationId: string | undefined) {
    if (!externalReservationId) return null;
    return this.db.queryOne<{
      id: string;
      seller_listing_id: string;
      status: string;
      quantity: number;
    }>('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity',
      eq: [['external_reservation_id', externalReservationId]],
      maybeSingle: true,
    });
  }

  private async listingIdForOffer(offerId: string | undefined): Promise<string | null> {
    if (!offerId) return null;
    const row = await this.db.queryOne<{ id: string }>('seller_listings', {
      select: 'id',
      eq: [['external_listing_id', offerId], ['listing_type', 'declared_stock']],
      maybeSingle: true,
    });
    return row?.id ?? null;
  }

  private emitReservationEvent(
    listingId: string,
    variantId: string,
    reservationId: string,
    quantity: number,
  ): void {
    this.events.emitSellerEvent({
      eventType: 'seller.stock_reserved',
      aggregateId: listingId,
      payload: {
        reservationId, listingId, variantId, quantity, providerCode: 'kinguin',
      },
    }).catch((err: unknown) => {
      logger.warn('Kinguin emitReservationEvent failed', err as Error, {
        listingId, variantId, reservationId,
      });
    });
  }

  private propagateUnavailable(variantId: string, reason: 'jit_failed' | 'all_unprofitable' | 'manual'): void {
    this.unavailPort.propagateVariantUnavailable(variantId, reason).catch((err: unknown) => {
      logger.warn('Kinguin propagateVariantUnavailable failed', err as Error, { variantId, reason });
    });
  }
}
