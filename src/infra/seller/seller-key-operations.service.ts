/**
 * Seller key operations service — atomic key claim, decrypt, provision, release.
 *
 * Implements ISellerKeyOperationsPort.
 * Uses native JIT procurement (`SellerJitProcurementService`) + in-process Bamboo buying when stock is insufficient.
 *
 * Key decryption delegates to IKeyDecryptionPort (Node.js in-process crypto).
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
  DecryptPendingResult,
  CompleteProvisionParams,
  PostProvisionReturnParams,
} from '../../core/ports/seller-key-operations.port.js';
import type { ISellerDomainEventPort } from '../../core/ports/seller-domain-event.port.js';
import type { IKeyDecryptionPort } from '../../core/ports/key-decryption.port.js';
import { SellerJitProcurementService } from './seller-jit-procurement.service.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('seller-key-operations');

@injectable()
export class SellerKeyOperationsService implements ISellerKeyOperationsPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
    @inject(TOKENS.KeyDecryption) private readonly keyDecryption: IKeyDecryptionPort,
    @inject(TOKENS.SellerJitProcurementService) private readonly jitProcurement: SellerJitProcurementService,
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

    await this.db.rpc('finalize_seller_provisions_atomic', {
      p_reservation_id: reservationId,
      p_key_ids: keyIds,
      p_provision_ids: provisions.map((p) => p.id),
    });

    const decryptedKeys = await this.decryptKeys(keyIds);

    return { keyIds, decryptedKeys };
  }

  async decryptPendingWithoutFinalize(reservationId: string): Promise<DecryptPendingResult> {
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
    const provisionIds = provisions.map((p) => p.id);
    const decryptedKeys = await this.decryptKeys(keyIds);

    const keyRows = await this.db.query<{
      id: string;
      key_format: string;
    }>('product_keys', {
      select: 'id, key_format',
      in: [['id', keyIds]],
    });

    const formatMap = new Map(keyRows.map((r) => [r.id, r.key_format ?? 'text']));
    const keyFormats = keyIds.map((id) => formatMap.get(id) ?? 'text');

    return { keyIds, provisionIds, decryptedKeys, keyFormats };
  }

  async finalizeProvisions(reservationId: string, keyIds: string[], provisionIds: string[]): Promise<void> {
    await this.db.rpc('finalize_seller_provisions_atomic', {
      p_reservation_id: reservationId,
      p_key_ids: keyIds,
      p_provision_ids: provisionIds,
    });
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
      reservationId, listingId, variantId, productId, providerCode,
      externalOrderId, keyIds, keysProvisionedCount, priceCents,
      feeCents, currency, marketplaceFinancialsSnapshot, buyerEmail,
      isReplacement,
    } = params;

    if (isReplacement) {
      // Key replacement: the original sale revenue was already written off during the
      // replacement RESERVE. Skip marketplace_sale recording to avoid double-counting.
      logger.info('Replacement PROVIDE: skipping marketplace_sale recording', {
        reservationId, externalOrderId,
      });
    } else {
      try {
        await this.recordMarketplaceSale({
          reservationId,
          listingId,
          variantId,
          productId,
          providerCode,
          externalOrderId,
          keyIds,
          priceCents,
          feeCents,
          currency,
          marketplaceFinancialsSnapshot,
          buyerEmail,
        });
      } catch (err) {
        logger.error('Failed to record marketplace sale', err as Error, { reservationId, externalOrderId });
      }
    }

    await this.events.emitSellerEvent({
      eventType: 'seller.stock_provisioned',
      aggregateId: listingId,
      payload: {
        reservationId,
        listingId,
        variantId,
        keysProvisioned: keysProvisionedCount,
        providerCode,
        externalOrderId,
      },
    });

    const variant = await this.db.queryOne<{ product_id: string }>('product_variants', {
      select: 'product_id',
      eq: [['id', variantId]],
      single: true,
    });

    if (variant?.product_id) {
      await this.events.emitInventoryStockChanged({
        productIds: [variant.product_id],
        variantIds: [variantId],
        reason: 'seller_provisioned',
      });
    }
  }

  async releaseReservationKeys(
    reservationId: string,
    targetStatus: 'cancelled' | 'expired' | 'failed',
  ): Promise<number> {
    // release_seller_reserved_keys atomically:
    //   1. Sets seller_reserved keys back to available
    //   2. Marks all pending provisions as failed
    // Both happen in a single DB transaction, eliminating the phantom-provision
    // race where the key was released but the provision stayed 'pending' and
    // permanently blocked claim_and_reserve_atomic's NOT EXISTS guard.
    const releasedCount = await this.db.rpc<number>('release_seller_reserved_keys', {
      p_reservation_id: reservationId,
    });

    await this.db.update(
      'seller_stock_reservations',
      { id: reservationId },
      { status: targetStatus },
    ).catch((err) => {
      logger.error('Failed to update reservation status', err as Error, { reservationId, targetStatus });
    });

    return releasedCount ?? 0;
  }

  async handlePostProvisionReturn(params: PostProvisionReturnParams): Promise<number> {
    const { reservation, providerCode, externalOrderId, reason, maxKeysToRestock, refundEventId } = params;

    const deliveredProvisions = await this.db.query<{
      id: string;
      product_key_id: string;
      created_at: string;
    }>('seller_key_provisions', {
      select: 'id, product_key_id, created_at',
      eq: [['reservation_id', reservation.id], ['status', 'delivered']],
      order: { column: 'created_at', ascending: true },
    });

    const totalDeliveredThisCall = deliveredProvisions.length;
    const cap = typeof maxKeysToRestock === 'number' && maxKeysToRestock >= 0
      ? Math.min(maxKeysToRestock, totalDeliveredThisCall)
      : totalDeliveredThisCall;
    const provisionsToReturn = deliveredProvisions.slice(0, cap);

    const keysRestocked = await this.restockProvisionedKeys(reservation.id, provisionsToReturn);

    const totals = await this.computeCumulativeRefundFraction(reservation.id);
    const isFinalRefund = !!totals.fraction
      && totals.fraction.numerator >= totals.fraction.denominator;

    const { orderId } = await this.applyMarketplaceRefundLedger(
      reservation,
      providerCode,
      externalOrderId,
      reason,
      { refundFraction: totals.fraction, refundEventId },
    );

    if (isFinalRefund) {
      await this.db.update('seller_stock_reservations', { id: reservation.id }, { status: 'cancelled' })
        .catch((err) => {
          logger.error('Failed to cancel reservation after full refund', err as Error, {
            reservationId: reservation.id,
          });
        });
    }

    const partial = !isFinalRefund;
    await this.events.emitSellerEvent({
      eventType: 'seller.stock_cancelled',
      aggregateId: reservation.seller_listing_id,
      payload: {
        reservationId: reservation.id,
        reason,
        providerCode,
        keysReleased: keysRestocked,
        partial,
        ...(partial
          ? { totalDelivered: totals.provisioned, totalRefunded: totals.refunded }
          : {}),
      },
    });

    await this.createAdminAlert({
      alertType: 'marketplace_post_provision_cancel',
      severity: partial ? 'high' : (keysRestocked > 0 ? 'medium' : 'high'),
      title: partial
        ? `Marketplace partial refund — ${keysRestocked} of ${totals.provisioned} keys restocked (${providerCode})`
        : `Marketplace return — keys restocked (${providerCode})`,
      message: partial
        ? `${providerCode} partially refunded order ${externalOrderId}: ${keysRestocked} key(s) restocked this notification ` +
          `(${totals.refunded}/${totals.provisioned} cumulative). Reservation ${reservation.id} kept as provisioned; ledger updated.`
        : `${providerCode} returned order ${externalOrderId} after provision; ${keysRestocked} key(s) set back to available inventory. ` +
          `Reservation ${reservation.id} cancelled and ledger updated.`,
      metadata: {
        provider_code: providerCode,
        reservation_id: reservation.id,
        external_order_id: externalOrderId,
        listing_id: reservation.seller_listing_id,
        keys_restocked: keysRestocked,
        marketplace_order_id: orderId,
        partial,
        ...(partial
          ? { total_delivered: totals.provisioned, total_refunded: totals.refunded }
          : {}),
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

    logger.info('Post-provision merchandise return processed', {
      reservationId: reservation.id,
      providerCode,
      keysRestocked,
      externalOrderId,
      marketplaceOrderId: orderId,
      cumulativeRefunded: totals.refunded,
      cumulativeProvisioned: totals.provisioned,
      isFinalRefund,
    });

    return keysRestocked;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  private async decryptKeys(keyIds: string[]): Promise<DecryptedKey[]> {
    const results = await this.keyDecryption.decryptKeysByIds(keyIds);
    return results.map((r) => ({ keyId: r.keyId, plaintext: r.plaintext }));
  }

  private async attemptJitProcurement(params: ClaimKeysParams): Promise<ClaimKeysResult | null> {
    try {
      logger.info('Attempting JIT procurement', {
        variantId: params.variantId,
        listingId: params.listingId,
        quantity: params.quantity,
      });

      const purchased = await this.jitProcurement.tryJitPurchaseForReservation(params);
      if (!purchased) {
        return null;
      }

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
    variantId: string;
    productId: string;
    providerCode: string;
    externalOrderId: string;
    keyIds: string[];
    priceCents: number;
    feeCents?: number;
    currency: string;
    marketplaceFinancialsSnapshot?: Record<string, unknown>;
    buyerEmail?: string;
  }): Promise<void> {
    const {
      reservationId, listingId, variantId, productId, providerCode,
      externalOrderId, keyIds, priceCents, feeCents, currency,
      marketplaceFinancialsSnapshot: snapshot, buyerEmail,
    } = params;

    const idempotencyKey = `seller:${reservationId}`;

    const existingOrder = await this.db.queryOne<{ id: string }>('orders', {
      select: 'id',
      eq: [['idempotency_key', idempotencyKey]],
      maybeSingle: true,
    });

    if (existingOrder) {
      logger.info('Marketplace order already recorded (idempotent)', { reservationId, orderId: existingOrder.id });
      return;
    }

    const quantity = keyIds.length;
    const normalizedEmail = typeof buyerEmail === 'string' && buyerEmail.trim().length > 0
      ? buyerEmail.trim().toLowerCase()
      : null;

    let inventoryCostCents = 0;
    if (keyIds.length > 0) {
      try {
        const keyCostRows = await this.db.query<{ purchase_cost: number | string | null }>('product_keys', {
          select: 'purchase_cost',
          in: [['id', keyIds]],
        });
        for (const row of keyCostRows) {
          const n = typeof row.purchase_cost === 'number' ? row.purchase_cost : Number(row.purchase_cost);
          if (Number.isFinite(n) && n > 0) inventoryCostCents += Math.round(n);
        }
      } catch (err) {
        logger.error('Failed to load key purchase costs', err as Error, { reservationId, keyCount: keyIds.length });
      }
    }

    let totalAmount: number;
    let netAmount: number | null;
    let providerFee: number | null;
    let unitPriceCents: number;
    let marketplacePricing: Record<string, unknown> | null = null;

    const snap = snapshot as Record<string, unknown> | undefined;
    if (snap && typeof snap.gross_cents_per_unit === 'number' && typeof snap.seller_profit_cents_per_unit === 'number') {
      unitPriceCents = snap.gross_cents_per_unit as number;
      totalAmount = unitPriceCents * quantity;
      netAmount = (snap.seller_profit_cents_per_unit as number) * quantity;
      providerFee = totalAmount - netAmount;
      marketplacePricing = {
        ...snap,
        provisioned_quantity: quantity,
        total_gross_cents: totalAmount,
        total_seller_profit_cents: netAmount,
        total_provider_fee_aggregate_cents: providerFee,
      };
    } else {
      unitPriceCents = priceCents;
      totalAmount = priceCents * quantity;
      netAmount = feeCents != null ? totalAmount - feeCents * quantity : null;
      providerFee = feeCents != null ? feeCents * quantity : null;
    }

    const order = await this.db.insert<{ id: string; order_number: string }>('orders', {
      user_id: null,
      product_id: productId,
      quantity,
      unit_price: unitPriceCents,
      currency,
      status: 'fulfilled',
      fulfillment_status: 'fulfilled',
      payment_provider: providerCode,
      order_channel: 'marketplace',
      total_amount: totalAmount,
      subtotal_cents: totalAmount,
      provider_fee: providerFee,
      net_amount: netAmount,
      balance_currency: currency,
      marketplace_pricing: marketplacePricing,
      provider_payment_id: externalOrderId,
      idempotency_key: idempotencyKey,
      notes: `Marketplace sale via ${providerCode}`,
      payment_verified_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      delivery_email: normalizedEmail,
    });

    if (!order?.id) {
      await this.createAdminAlert({
        alertType: 'marketplace_sale_recording_failed',
        severity: 'high',
        title: 'Marketplace order insert failed',
        message: `Failed to insert order for ${providerCode} reservation ${reservationId}. Keys were provisioned but no order/transaction recorded.`,
        metadata: { reservationId, listingId, providerCode, priceCents, currency, keyCount: keyIds.length },
      });
      return;
    }

    await this.db.insert('order_items', {
      order_id: order.id,
      product_id: productId,
      variant_id: variantId,
      quantity,
      unit_price: unitPriceCents,
      total_price: totalAmount,
      status: 'fulfilled',
    }).catch((err) => {
      logger.error('Failed to insert marketplace order item', err as Error, { orderId: order.id, reservationId });
    });

    await this.db.insert('transactions', {
      order_id: order.id,
      type: 'marketplace_sale',
      direction: 'credit',
      amount: totalAmount,
      currency,
      status: 'completed',
      payment_provider: providerCode,
      provider_charge_id: externalOrderId,
      description: `${providerCode} marketplace sale`,
      metadata: {
        provider_code: providerCode,
        reservation_id: reservationId,
        listing_id: listingId,
        external_order_id: externalOrderId,
        key_count: quantity,
        unit_price_cents: unitPriceCents,
        fee_cents: feeCents ?? null,
        gross_cents: totalAmount,
        seller_profit_cents: netAmount,
        provider_fee_aggregate_cents: providerFee,
        inventory_cost_cents: inventoryCostCents > 0 ? inventoryCostCents : null,
        inventory_cost_currency: inventoryCostCents > 0 ? 'USD' : null,
      },
    }).catch((err) => {
      logger.error('Failed to insert marketplace transaction', err as Error, { orderId: order.id, reservationId });
    });

    if (keyIds.length > 0) {
      for (const keyId of keyIds) {
        await this.db.update('product_keys', { id: keyId }, { order_id: order.id, is_assigned: true })
          .catch((err) => {
            logger.error('Failed to link key to marketplace order', err as Error, { keyId, orderId: order.id });
          });
      }
    }

    logger.info('Marketplace sale recorded', {
      orderId: order.id,
      orderNumber: order.order_number,
      providerCode,
      reservationId,
      totalAmount,
      currency,
    });
  }

  private async createAdminAlert(alert: {
    alertType: string;
    severity: string;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.db.insert('admin_alerts', {
        alert_type: alert.alertType,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        metadata: alert.metadata,
      });
    } catch (err) {
      logger.error('Failed to create admin alert', err as Error, { alertType: alert.alertType });
    }
  }

  // ─── Batch Restock (replaces per-key N+1 RPCs) ─────────────────────

  private static readonly RESTOCKABLE_KEY_STATES = ['seller_provisioned', 'seller_reserved', 'seller_uploaded'];

  private async restockProvisionedKeys(
    reservationId: string,
    provisions: Array<{ id: string; product_key_id: string }>,
  ): Promise<number> {
    if (provisions.length === 0) return 0;

    const productKeyIds = provisions.map((p) => p.product_key_id);
    let keysRestocked = 0;

    try {
      const restocked = await this.db.rpc<Array<{ id: string }>>('batch_restock_seller_keys', {
        p_key_ids: productKeyIds,
        p_restockable_states: SellerKeyOperationsService.RESTOCKABLE_KEY_STATES,
      });
      keysRestocked = Array.isArray(restocked) ? restocked.length : 0;
    } catch (batchErr) {
      logger.warn(
        'batch_restock_seller_keys failed; falling back to per-key restock_seller_key',
        batchErr as Error,
        { reservationId, keyCount: productKeyIds.length },
      );
      for (const keyId of productKeyIds) {
        try {
          const result = await this.db.rpc<{ success: boolean }>('restock_seller_key', {
            p_key_id: keyId,
            p_restockable_states: SellerKeyOperationsService.RESTOCKABLE_KEY_STATES,
          });
          if (result?.success) keysRestocked++;
        } catch (perKeyErr) {
          logger.warn('Failed to restock key', perKeyErr as Error, { keyId, reservationId });
        }
      }
    }

    if (keysRestocked === 0) return 0;

    const provisionIdsToFlip = provisions
      .filter((p) => productKeyIds.includes(p.product_key_id))
      .map((p) => p.id);

    for (const pid of provisionIdsToFlip) {
      await this.db.update('seller_key_provisions', { id: pid, status: 'delivered' }, { status: 'refunded' })
        .catch((err) => {
          logger.warn('Failed to flip provision status to refunded', { provisionId: pid, error: (err as Error).message });
        });
    }

    return keysRestocked;
  }

  // ─── Cumulative Refund Fraction ────────────────────────────────────

  private async computeCumulativeRefundFraction(reservationId: string): Promise<{
    refunded: number;
    provisioned: number;
    fraction?: { numerator: number; denominator: number };
  }> {
    const rows = await this.db.query<{ id: string; status: string }>('seller_key_provisions', {
      select: 'id, status',
      eq: [['reservation_id', reservationId]],
    });

    const refunded = rows.filter((r) => r.status === 'refunded').length;
    const provisioned = rows.filter((r) => r.status === 'delivered' || r.status === 'refunded').length;

    if (provisioned === 0) return { refunded, provisioned };

    return {
      refunded,
      provisioned,
      fraction: { numerator: Math.min(refunded, provisioned), denominator: provisioned },
    };
  }

  // ─── Delta-Aware Marketplace Refund Ledger ─────────────────────────

  private async applyMarketplaceRefundLedger(
    reservation: PostProvisionReturnParams['reservation'],
    providerCode: string,
    externalOrderId: string,
    reason: string,
    options: {
      refundFraction?: { numerator: number; denominator: number };
      refundEventId?: string;
    } = {},
  ): Promise<{ orderId?: string; refundAmount?: number; isFullRefund?: boolean }> {
    const idempotencyKey = `seller:${reservation.id}`;

    const order = await this.db.queryOne<{
      id: string;
      total_amount: number;
      currency: string;
      status: string;
    }>('orders', {
      select: 'id, total_amount, currency, status',
      eq: [['idempotency_key', idempotencyKey]],
      maybeSingle: true,
    });

    if (!order) return {};
    if (order.status === 'refunded') {
      return { orderId: order.id, refundAmount: 0, isFullRefund: true };
    }

    const totalAmount = Number(order.total_amount);
    const fraction = options.refundFraction;
    const isFullRefund = !fraction || fraction.numerator >= fraction.denominator;

    const targetCumulativeAmount = isFullRefund
      ? totalAmount
      : Math.round((totalAmount * fraction!.numerator) / fraction!.denominator);

    const existingRefunds = await this.db.query<{ amount: number }>('transactions', {
      select: 'amount',
      eq: [['order_id', order.id], ['type', 'refund'], ['status', 'completed']],
    }).catch((err) => {
      logger.error('Failed to load prior refund transactions', err as Error, { orderId: order.id });
      return [] as Array<{ amount: number }>;
    });

    const alreadyRefunded = existingRefunds.reduce(
      (sum, row) => sum + Number(row.amount ?? 0),
      0,
    );
    const deltaAmount = Math.max(0, targetCumulativeAmount - alreadyRefunded);
    const targetStatus = isFullRefund ? 'refunded' : 'partially_refunded';

    if (deltaAmount === 0) {
      await this.db.update('orders', { id: order.id }, { status: targetStatus })
        .catch((err) => {
          logger.error('Failed to update order status (no-delta path)', err as Error, { orderId: order.id });
        });
      return { orderId: order.id, refundAmount: 0, isFullRefund };
    }

    const insertData: Record<string, unknown> = {
      order_id: order.id,
      type: 'refund',
      direction: 'debit',
      amount: deltaAmount,
      currency: order.currency,
      status: 'completed',
      payment_provider: providerCode,
      description: isFullRefund
        ? `Marketplace cancellation after provision (${providerCode})`
        : `Marketplace partial refund after provision (${providerCode}, ${fraction!.numerator}/${fraction!.denominator})`,
      metadata: {
        provider_code: providerCode,
        reservation_id: reservation.id,
        external_order_id: externalOrderId,
        reason,
        cumulative_target_amount: targetCumulativeAmount,
        already_refunded_amount: alreadyRefunded,
        ...(fraction
          ? { refunded_keys: fraction.numerator, total_delivered_keys: fraction.denominator }
          : {}),
      },
    };
    if (options.refundEventId) {
      insertData.provider_refund_id = options.refundEventId;
    }

    try {
      await this.db.insert('transactions', insertData);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('23505') || msg.includes('unique') || msg.includes('duplicate')) {
        logger.info('Refund transaction already recorded — idempotent replay', {
          orderId: order.id,
          refundEventId: options.refundEventId,
        });
      } else {
        logger.error('Failed to insert refund transaction', err as Error, {
          orderId: order.id,
          refundEventId: options.refundEventId,
        });
      }
    }

    await this.db.update('orders', { id: order.id }, { status: targetStatus })
      .catch((err) => {
        logger.error('Failed to update order status', err as Error, { orderId: order.id, targetStatus });
      });

    return { orderId: order.id, refundAmount: deltaAmount, isFullRefund };
  }
}
