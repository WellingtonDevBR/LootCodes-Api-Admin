/**
 * Seller domain event emission service.
 *
 * Implements ISellerDomainEventPort with direct DB writes.
 * For `inventory.stock_changed`, also invokes the `event-dispatcher`
 * Edge Function via HTTP for observer fan-out.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type {
  ISellerDomainEventPort,
  EmitSellerEventParams,
  EmitInventoryStockChangedParams,
} from '../../core/ports/seller-domain-event.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('seller-domain-events');

@injectable()
export class SellerDomainEventsService implements ISellerDomainEventPort {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async emitSellerEvent(params: EmitSellerEventParams): Promise<boolean> {
    const { eventType, aggregateId, payload } = params;

    try {
      await this.db.insert('domain_events', {
        event_type: eventType,
        aggregate_type: 'seller',
        aggregate_id: aggregateId,
        payload,
        version: 1,
      });

      logger.info('Emitted seller event', { eventType, aggregateId });
      return true;
    } catch (err) {
      logger.error('Failed to emit seller event', err as Error, { eventType, aggregateId });
      return false;
    }
  }

  async emitInventoryStockChanged(params: EmitInventoryStockChangedParams): Promise<void> {
    const { productIds, variantIds, reason, orderId } = params;
    if (!productIds?.length) return;

    const payload: Record<string, unknown> = {
      product_ids: productIds,
      reason,
      ...(variantIds?.length ? { variant_ids: variantIds } : {}),
      ...(orderId ? { order_id: orderId } : {}),
    };

    const aggregateId = productIds[0];

    try {
      const insertedEvent = await this.db.insert<{ id: string; created_at: string }>('domain_events', {
        event_type: 'inventory.stock_changed',
        aggregate_type: 'inventory',
        aggregate_id: aggregateId,
        payload,
        version: 1,
      });

      await this.invokeEventDispatcher({
        event_type: 'inventory.stock_changed',
        aggregate_type: 'inventory',
        aggregate_id: aggregateId,
        payload,
        id: insertedEvent?.id,
        created_at: insertedEvent?.created_at,
        version: 1,
      });

      logger.info('Emitted inventory.stock_changed', { productIds, reason, orderId });
    } catch (err) {
      logger.error('Failed to emit inventory.stock_changed', err as Error, { productIds, reason });
    }
  }

  private async invokeEventDispatcher(event: Record<string, unknown>): Promise<void> {
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;

    if (!internalSecret || !serviceRoleKey || !supabaseUrl) {
      logger.error('Missing env vars for event-dispatcher invocation', {
        hasInternalSecret: !!internalSecret,
        hasServiceRoleKey: !!serviceRoleKey,
        hasSupabaseUrl: !!supabaseUrl,
      });
      return;
    }

    const baseUrl = supabaseUrl.replace('/rest/v1', '');
    const url = `${baseUrl}/functions/v1/event-dispatcher`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'X-Internal-Secret': internalSecret,
        },
        body: JSON.stringify(event),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.error('event-dispatcher invocation failed', new Error(`${res.status}: ${text}`), {
          eventType: event.event_type as string,
        });
      }
    } catch (err) {
      logger.error('event-dispatcher invocation network error', err as Error, {
        eventType: event.event_type as string,
      });
    }
  }
}
