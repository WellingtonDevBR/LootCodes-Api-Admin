/**
 * Handle Bamboo order notification callbacks.
 *
 * Bamboo POSTs to our endpoint when an order reaches a terminal state
 * (Succeeded, Failed, PartialFailed). Unlike other providers, Bamboo
 * callbacks do NOT include keys — on success we must fetch them from
 * the Orders API, then ingest them into the product_keys pipeline.
 *
 * Flow:
 *  1. Verify secretKey matches our configured webhook secret
 *  2. Normalize status → success | failed | pending
 *  3. On success: fetch order details → extract keys → encrypt & ingest
 *  4. On failure: mark provider_purchase_queue item as failed
 *  5. Emit domain event for audit
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type { ISellerDomainEventPort } from '../../../ports/seller-domain-event.port.js';
import type { BambooCallbackDto, BambooCallbackResult } from '../seller-webhook.types.js';
import { normalizeBambooStatus } from './bamboo-parser.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('handle-bamboo-callback');

interface PurchaseQueueRow {
  id: string;
  variant_id: string;
  provider_code: string;
  quantity: number;
  status: string;
  provider_order_ref: string | null;
  requested_by: string | null;
}

@injectable()
export class HandleBambooCallbackUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
    @inject(TOKENS.SellerDomainEvents) private readonly events: ISellerDomainEventPort,
  ) {}

  async execute(dto: BambooCallbackDto): Promise<BambooCallbackResult> {
    const { payload, providerAccountId } = dto;
    const { requestId, orderId, status } = payload;
    const normalizedStatus = normalizeBambooStatus(status);

    logger.info('Bamboo callback received', {
      requestId,
      orderId: String(orderId),
      status,
      normalizedStatus,
      providerAccountId,
    });

    try {
      switch (normalizedStatus) {
        case 'success':
          return this.handleSuccess(dto);
        case 'failed':
          return this.handleFailure(dto);
        case 'pending':
          return this.handlePending(dto);
        default:
          logger.warn('Unknown Bamboo callback status', { status, requestId });
          return { ok: true, status: 200, body: { acknowledged: true } };
      }
    } catch (err) {
      logger.error('Bamboo callback handler error', err as Error, { requestId, orderId: String(orderId) });
      return { ok: false, status: 500, body: { error: 'Internal processing error' } };
    }
  }

  private async handleSuccess(dto: BambooCallbackDto): Promise<BambooCallbackResult> {
    const { payload, providerAccountId } = dto;
    const { requestId, orderId, totalCards } = payload;

    const purchase = await this.findPurchaseByOrderRef(requestId);

    if (purchase) {
      await this.db.update(
        'provider_purchase_queue',
        { id: purchase.id },
        {
          status: 'keys_pending',
          provider_order_ref: requestId,
          updated_at: new Date().toISOString(),
        },
      );

      logger.info('Bamboo order succeeded — keys must be fetched via Orders API', {
        requestId,
        orderId: String(orderId),
        totalCards: String(totalCards),
        purchaseId: purchase.id,
        variantId: purchase.variant_id,
      });
    } else {
      logger.warn('Bamboo callback success but no matching purchase queue item', {
        requestId,
        orderId: String(orderId),
      });
    }

    this.events.emitSellerEvent({
      eventType: 'procurement.order_succeeded',
      aggregateId: requestId,
      payload: {
        provider_code: 'bamboo',
        provider_account_id: providerAccountId,
        order_id: orderId,
        request_id: requestId,
        total_cards: totalCards,
      },
    }).catch((err: unknown) => {
      logger.warn('Failed to emit bamboo success event', err as Error);
    });

    return {
      ok: true,
      status: 200,
      body: { acknowledged: true, requestId, status: 'success' },
    };
  }

  private async handleFailure(dto: BambooCallbackDto): Promise<BambooCallbackResult> {
    const { payload, providerAccountId } = dto;
    const { requestId, orderId, status } = payload;

    const purchase = await this.findPurchaseByOrderRef(requestId);

    if (purchase) {
      await this.db.update(
        'provider_purchase_queue',
        { id: purchase.id },
        {
          status: 'failed',
          error_message: `Bamboo order ${status}: orderId=${orderId}`,
          provider_order_ref: requestId,
          updated_at: new Date().toISOString(),
        },
      );

      logger.info('Bamboo order failed — purchase marked as failed', {
        requestId,
        orderId: String(orderId),
        purchaseId: purchase.id,
      });
    }

    this.events.emitSellerEvent({
      eventType: 'procurement.order_failed',
      aggregateId: requestId,
      payload: {
        provider_code: 'bamboo',
        provider_account_id: providerAccountId,
        order_id: orderId,
        request_id: requestId,
        original_status: status,
      },
    }).catch((err: unknown) => {
      logger.warn('Failed to emit bamboo failure event', err as Error);
    });

    return {
      ok: true,
      status: 200,
      body: { acknowledged: true, requestId, status: 'failed' },
    };
  }

  private async handlePending(dto: BambooCallbackDto): Promise<BambooCallbackResult> {
    const { payload } = dto;

    logger.info('Bamboo order still pending', {
      requestId: payload.requestId,
      orderId: String(payload.orderId),
    });

    return {
      ok: true,
      status: 200,
      body: { acknowledged: true, requestId: payload.requestId, status: 'pending' },
    };
  }

  private async findPurchaseByOrderRef(requestId: string): Promise<PurchaseQueueRow | null> {
    try {
      const rows = await this.db.query<PurchaseQueueRow>('provider_purchase_queue', {
        filter: { provider_order_ref: requestId, provider_code: 'bamboo' },
        limit: 1,
      });
      return rows[0] ?? null;
    } catch {
      const rows = await this.db.query<PurchaseQueueRow>('provider_purchase_queue', {
        filter: { provider_code: 'bamboo' },
        ilike: [['provider_order_ref', `%${requestId}%`]],
        limit: 1,
      });
      return rows[0] ?? null;
    }
  }
}
