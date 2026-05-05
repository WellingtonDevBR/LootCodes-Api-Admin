/**
 * Kinguin buyer-side webhook use case.
 *
 * Handles events from Kinguin ESA subscriptions (buyer-side):
 *   product.update -- catalog qty/availability change (not price)
 *   order.status   -- purchase attempt status tracking + recovery
 *
 * Always returns 204 No Content (Kinguin spec REQUIRES 204).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../../../di/tokens.js';
import type { IDatabase } from '../../../ports/database.port.js';
import type {
  KinguinBuyerWebhookDto,
  KinguinBuyerProductUpdatePayload,
  KinguinBuyerOrderStatusPayload,
} from '../seller-webhook.types.js';
import { createLogger } from '../../../../shared/logger.js';

const logger = createLogger('kinguin-buyer-webhook-uc');

const TERMINAL_BAD_STATUSES = new Set([
  'canceled', 'cancelled', 'refunded', 'failed', 'expired',
]);
const RECOVERABLE_STATUSES = new Set(['completed']);
const ATTEMPT_STATUSES_AWAITING_KEYS = new Set(['pending', 'timeout']);
const TERMINAL_ALERT_TYPE = 'kinguin_buyer_order_status_terminal';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitiseNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normaliseToUtcIso(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

@injectable()
export class HandleKinguinBuyerWebhookUseCase {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async execute(dto: KinguinBuyerWebhookDto): Promise<{ status: 204 }> {
    const event = (dto.eventName ?? '').trim().toLowerCase();

    if (!isObject(dto.payload)) {
      logger.warn('Kinguin buyer webhook payload was not a JSON object', {
        eventName: dto.eventName,
        payloadType: typeof dto.payload,
      });
      return { status: 204 };
    }

    switch (event) {
      case 'product.update':
        await this.handleProductUpdate(
          dto.payload as KinguinBuyerProductUpdatePayload,
          dto.providerAccountId,
        );
        break;

      case 'order.status':
        await this.handleOrderStatus(
          dto.payload as KinguinBuyerOrderStatusPayload,
        );
        break;

      default:
        logger.info('Kinguin buyer webhook acknowledged (unknown event)', {
          eventName: dto.eventName,
        });
        break;
    }

    return { status: 204 };
  }

  // --- product.update -------------------------------------------------------

  private async handleProductUpdate(
    payload: KinguinBuyerProductUpdatePayload,
    providerAccountId: string,
  ): Promise<void> {
    const productId = (payload?.productId ?? '').trim();
    if (!productId) {
      logger.warn('Kinguin product.update missing productId');
      return;
    }

    const qty = sanitiseNonNegativeInt(payload.qty);
    const updatedAt = normaliseToUtcIso(payload.updatedAt)
      ?? new Date().toISOString();
    const cheapestOfferId = Array.isArray(payload.cheapestOfferId)
      ? payload.cheapestOfferId[0] ?? null
      : null;

    const existing = await this.db.queryOne<{
      id: string;
      raw_data: Record<string, unknown>;
    }>('provider_product_catalog', {
      select: 'id, raw_data',
      eq: [
        ['provider_account_id', providerAccountId],
        ['external_product_id', productId],
      ],
      maybeSingle: true,
    });

    if (!existing) {
      logger.info('product.update for un-ingested product -- skipping', {
        productId,
        kinguinId: payload.kinguinId,
      });
      return;
    }

    const prevRaw = isObject(existing.raw_data) ? existing.raw_data : {};
    const previousCheapestOfferId = typeof prevRaw.cheapest_offer_id === 'string'
      ? prevRaw.cheapest_offer_id
      : null;
    const needsRepricing = cheapestOfferId !== null
      && cheapestOfferId !== previousCheapestOfferId;

    try {
      await this.db.update(
        'provider_product_catalog',
        { id: existing.id },
        {
          qty,
          available_to_buy: qty > 0,
          updated_at: updatedAt,
          raw_data: {
            ...prevRaw,
            kinguinId: payload.kinguinId,
            cheapest_offer_id: cheapestOfferId,
            text_qty: sanitiseNonNegativeInt(payload.textQty),
            last_buyer_webhook_at: new Date().toISOString(),
            ...(needsRepricing ? { needs_repricing: true } : {}),
          },
        },
      );

      logger.info('Kinguin product.update applied', {
        productId,
        qty,
        cheapestOfferId,
        needsRepricing,
      });
    } catch (err) {
      logger.error('product.update catalog write failed', err as Error, {
        productId,
      });
    }
  }

  // --- order.status ---------------------------------------------------------

  private async handleOrderStatus(
    payload: KinguinBuyerOrderStatusPayload,
  ): Promise<void> {
    const orderId = (payload?.orderId ?? '').trim();
    const orderExternalId = (payload?.orderExternalId ?? '').trim();
    const status = (payload?.status ?? '').trim().toLowerCase();

    if (!orderId && !orderExternalId) {
      logger.warn('order.status missing both orderId and orderExternalId');
      return;
    }

    if (!status) {
      logger.warn('order.status missing status');
      return;
    }

    const attempt = await this.findPurchaseAttempt(orderId, orderExternalId);
    if (!attempt) {
      logger.warn('order.status -- no matching purchase attempt', {
        orderId, orderExternalId, status,
      });
      return;
    }

    if (RECOVERABLE_STATUSES.has(status)) {
      if (ATTEMPT_STATUSES_AWAITING_KEYS.has(attempt.status)) {
        logger.info('Kinguin order.status completed -- recovery candidate', {
          orderId, orderExternalId, attemptId: attempt.id,
        });
      }
      return;
    }

    if (!TERMINAL_BAD_STATUSES.has(status)) {
      logger.info('Kinguin order.status acknowledged', {
        orderId, orderExternalId, status, attemptId: attempt.id,
      });
      return;
    }

    const alreadyAlerted = await this.hasOpenTerminalAlert(attempt.id);
    if (alreadyAlerted) return;

    if (ATTEMPT_STATUSES_AWAITING_KEYS.has(attempt.status)) {
      await this.db.update('provider_purchase_attempts', { id: attempt.id }, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_code: 'PROVIDER_TERMINAL',
        error_message: `Kinguin order ${orderId} reached terminal status "${status}"`,
      }).catch((err) => {
        logger.error('Failed to flip attempt to failed', err as Error, {
          attemptId: attempt.id,
        });
      });
    }

    await this.db.insert('admin_alerts', {
      alert_type: TERMINAL_ALERT_TYPE,
      severity: 'high',
      title: `Kinguin reversed buyer order (${status})`,
      message: `Kinguin order ${orderId} (orderExternalId=${orderExternalId}) transitioned to "${status}". Review and take appropriate action.`,
      metadata: {
        provider_code: 'kinguin',
        provider_order_ref: orderId,
        provider_request_id: orderExternalId,
        kinguin_status: status,
        attempt_id: attempt.id,
        attempt_status: attempt.status,
        updated_at: payload.updatedAt,
      },
    }).catch((err) => {
      logger.error('Failed to create terminal alert', err as Error, {
        attemptId: attempt.id,
      });
    });

    logger.warn('Kinguin order.status terminal-bad -- admin alerted', {
      orderId, orderExternalId, status, attemptId: attempt.id,
    });
  }

  // --- helpers --------------------------------------------------------------

  private async findPurchaseAttempt(
    orderId: string,
    orderExternalId: string,
  ): Promise<{ id: string; status: string } | null> {
    if (orderExternalId) {
      const row = await this.db.queryOne<{ id: string; status: string }>(
        'provider_purchase_attempts',
        {
          select: 'id, status',
          eq: [['provider_request_id', orderExternalId]],
          maybeSingle: true,
        },
      );
      if (row) return row;
    }

    if (orderId) {
      const row = await this.db.queryOne<{ id: string; status: string }>(
        'provider_purchase_attempts',
        {
          select: 'id, status',
          eq: [['provider_order_ref', orderId]],
          maybeSingle: true,
        },
      );
      if (row) return row;
    }

    return null;
  }

  private async hasOpenTerminalAlert(attemptId: string): Promise<boolean> {
    try {
      const row = await this.db.queryOne<{ id: string }>('admin_alerts', {
        select: 'id',
        eq: [
          ['alert_type', TERMINAL_ALERT_TYPE],
          ['is_resolved', false],
          ['metadata->>attempt_id', attemptId],
        ],
        maybeSingle: true,
      });
      return !!row;
    } catch {
      return false;
    }
  }
}
