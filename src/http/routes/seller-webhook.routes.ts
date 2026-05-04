/**
 * Seller webhook routes — public endpoints for marketplace callbacks.
 *
 * These endpoints do NOT use adminGuard; each marketplace authenticates
 * via its own scheme handled by createMarketplaceAuthMiddleware.
 *
 * Route mapping:
 *   POST /webhooks/eneba           → Eneba Declared Stock (RESERVE/PROVIDE/CANCEL)
 *   POST /webhooks/g2a             → G2A callbacks
 *   GET  /webhooks/g2a             → G2A health check (204)
 *   POST /webhooks/kinguin         → Kinguin seller callbacks
 *   POST /webhooks/kinguin-buyer   → Kinguin buyer webhooks
 *   POST /webhooks/gamivo          → Gamivo refund/deactivation
 *   GET  /webhooks/gamivo          → Gamivo health check (204)
 *   POST /webhooks/digiseller      → Digiseller form delivery
 *   GET  /webhooks/digiseller      → Digiseller quantity check
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import {
  createMarketplaceAuthMiddleware,
  type ProviderAuthResult,
} from '../middleware/marketplace-auth.middleware.js';
import type { HandleDeclaredStockReserveUseCase } from '../../core/use-cases/seller-webhook/handle-declared-stock-reserve.use-case.js';
import type { HandleDeclaredStockProvideUseCase } from '../../core/use-cases/seller-webhook/handle-declared-stock-provide.use-case.js';
import type { HandleDeclaredStockCancelUseCase } from '../../core/use-cases/seller-webhook/handle-declared-stock-cancel.use-case.js';
import type { HandleMarketplaceRefundUseCase } from '../../core/use-cases/seller-webhook/handle-marketplace-refund.use-case.js';
import type { HandleListingDeactivationUseCase } from '../../core/use-cases/seller-webhook/handle-listing-deactivation.use-case.js';
import type { HandleDigisellerDeliveryUseCase } from '../../core/use-cases/seller-webhook/handle-digiseller-delivery.use-case.js';
import type { HandleInventoryCallbackUseCase } from '../../core/use-cases/seller-webhook/handle-inventory-callback.use-case.js';
import type { HandleKeyUploadOrderUseCase } from '../../core/use-cases/seller-webhook/handle-key-upload-order.use-case.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('webhook-routes');

type AuthenticatedRequest = FastifyRequest & { providerAuth: ProviderAuthResult };

function getAuth(req: FastifyRequest): ProviderAuthResult {
  return (req as AuthenticatedRequest).providerAuth;
}

export async function sellerWebhookRoutes(app: FastifyInstance) {
  // ─── Eneba Declared Stock ────────────────────────────────────────────

  app.post('/eneba', {
    preHandler: [createMarketplaceAuthMiddleware('eneba')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const action = body.action as string;

    switch (action) {
      case 'RESERVE': {
        const uc = container.resolve<HandleDeclaredStockReserveUseCase>(UC_TOKENS.HandleDeclaredStockReserve);
        const result = await uc.execute({
          orderId: body.orderId as string,
          originalOrderId: (body.originalOrderId as string) ?? null,
          auctions: body.auctions as Array<{
            auctionId: string;
            keyCount: number;
            price: { amount: string | number; currency: string };
          }>,
          wholesale: body.wholesale as boolean | undefined,
          providerCode: 'eneba',
        });
        return reply.send({ action: 'RESERVE', orderId: result.orderId, success: result.success });
      }

      case 'PROVIDE': {
        const uc = container.resolve<HandleDeclaredStockProvideUseCase>(UC_TOKENS.HandleDeclaredStockProvide);
        const result = await uc.execute({
          orderId: body.orderId as string,
          originalOrderId: (body.originalOrderId as string) ?? null,
          providerCode: 'eneba',
        });
        return reply.send({
          action: 'PROVIDE',
          orderId: result.orderId,
          success: result.success,
          ...(result.auctions ? { auctions: result.auctions } : {}),
        });
      }

      case 'CANCEL': {
        const uc = container.resolve<HandleDeclaredStockCancelUseCase>(UC_TOKENS.HandleDeclaredStockCancel);
        await uc.execute({
          orderId: body.orderId as string,
          originalOrderId: (body.originalOrderId as string) ?? null,
          providerCode: 'eneba',
        });
        return reply.status(200).send();
      }

      default:
        logger.warn('Unknown Eneba action', { action });
        return reply.status(400).send({ error: 'Unknown action' });
    }
  });

  // ─── G2A Callbacks ───────────────────────────────────────────────────

  app.get('/g2a', async (_request, reply) => {
    return reply.status(204).send();
  });

  app.post('/g2a', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const eventType = body.type as string;

    if (eventType === 'order.complete') {
      const uc = container.resolve<HandleKeyUploadOrderUseCase>(UC_TOKENS.HandleKeyUploadOrder);
      const result = await uc.execute({
        externalOrderId: body.orderId as string,
        externalListingId: body.auctionId as string ?? body.productId as string,
        quantity: (body.quantity as number) ?? 1,
        providerCode: 'g2a',
        priceCents: body.priceCents as number | undefined,
        currency: body.currency as string | undefined,
        providerMetadata: body,
      });
      return reply.send({ success: result.success });
    }

    if (eventType === 'inventory.check') {
      const uc = container.resolve<HandleInventoryCallbackUseCase>(UC_TOKENS.HandleInventoryCallback);
      const result = await uc.execute({
        externalListingId: body.auctionId as string ?? body.productId as string,
        providerCode: 'g2a',
      });
      return reply.send(result);
    }

    logger.warn('Unknown G2A event type', { eventType });
    return reply.send({ success: true });
  });

  // ─── Kinguin Seller Callbacks ────────────────────────────────────────

  app.post('/kinguin', {
    preHandler: [createMarketplaceAuthMiddleware('kinguin')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const action = body.action as string ?? body.type as string;

    if (action === 'BUYING' || action === 'reservation') {
      const uc = container.resolve<HandleDeclaredStockReserveUseCase>(UC_TOKENS.HandleDeclaredStockReserve);
      const result = await uc.execute({
        orderId: body.orderId as string,
        originalOrderId: null,
        auctions: [{
          auctionId: body.offerId as string,
          keyCount: (body.quantity as number) ?? 1,
          price: { amount: body.unitPrice as number ?? 0, currency: body.currency as string ?? 'EUR' },
        }],
        providerCode: 'kinguin',
      });
      return reply.send({ success: result.success });
    }

    if (action === 'RETURNED' || action === 'REFUNDED') {
      const uc = container.resolve<HandleMarketplaceRefundUseCase>(UC_TOKENS.HandleMarketplaceRefund);
      const result = await uc.execute({
        externalOrderId: body.orderId as string,
        providerCode: 'kinguin',
        reason: `kinguin_${action.toLowerCase()}`,
      });
      return reply.send({ success: result.success });
    }

    logger.info('Kinguin webhook received', { action });
    return reply.send({ success: true });
  });

  // ─── Kinguin Buyer Webhooks ──────────────────────────────────────────

  app.post('/kinguin-buyer', {
    preHandler: [createMarketplaceAuthMiddleware('kinguin-buyer')],
  }, async (request, reply) => {
    const eventName = request.headers['x-event-name'] as string ?? '';
    logger.info('Kinguin buyer webhook received', { eventName });
    return reply.status(204).send();
  });

  // ─── Gamivo Callbacks ────────────────────────────────────────────────

  app.get('/gamivo', async (_request, reply) => {
    return reply.status(204).send();
  });

  app.post('/gamivo', {
    preHandler: [createMarketplaceAuthMiddleware('gamivo')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const eventType = body.type as string ?? body.event as string;

    if (eventType === 'refund' || eventType === 'partial_refund') {
      const uc = container.resolve<HandleMarketplaceRefundUseCase>(UC_TOKENS.HandleMarketplaceRefund);
      const result = await uc.execute({
        externalOrderId: body.orderId as string ?? body.order_id as string,
        providerCode: 'gamivo',
        reason: `gamivo_${eventType}`,
        refundedKeysCount: body.refunded_keys_count as number | undefined,
        refundEventId: body.event_id
          ? `gamivo:${body.event_id as string}`
          : undefined,
      });
      return reply.send({ success: result.success });
    }

    if (eventType === 'deactivation') {
      const uc = container.resolve<HandleListingDeactivationUseCase>(UC_TOKENS.HandleListingDeactivation);
      const result = await uc.execute({
        externalListingId: body.offerId as string ?? body.offer_id as string,
        providerCode: 'gamivo',
        reason: body.reason as string | undefined,
      });
      return reply.send({ success: result.success });
    }

    if (eventType === 'reservation' || eventType === 'order') {
      const uc = container.resolve<HandleKeyUploadOrderUseCase>(UC_TOKENS.HandleKeyUploadOrder);
      const result = await uc.execute({
        externalOrderId: body.orderId as string ?? body.order_id as string,
        externalListingId: body.offerId as string ?? body.offer_id as string,
        quantity: (body.quantity as number) ?? 1,
        providerCode: 'gamivo',
        priceCents: body.unit_price_cents as number | undefined,
        currency: body.currency as string | undefined,
        providerMetadata: body,
      });
      return reply.send({ success: result.success });
    }

    logger.info('Gamivo webhook received', { eventType });
    return reply.send({ success: true });
  });

  // ─── Digiseller Form Delivery ────────────────────────────────────────

  app.get('/digiseller', {
    preHandler: [createMarketplaceAuthMiddleware('digiseller')],
  }, async (request, reply) => {
    const query = request.query as Record<string, string>;

    if (query.url_for_quantity) {
      const uc = container.resolve<HandleInventoryCallbackUseCase>(UC_TOKENS.HandleInventoryCallback);
      const result = await uc.execute({
        externalListingId: query.product_id ?? '',
        providerCode: 'digiseller',
      });
      return reply.send({ cnt: result.quantity });
    }

    return reply.status(204).send();
  });

  app.post('/digiseller', {
    preHandler: [createMarketplaceAuthMiddleware('digiseller')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const auth = getAuth(request);

    const uc = container.resolve<HandleDigisellerDeliveryUseCase>(UC_TOKENS.HandleDigisellerDelivery);
    const result = await uc.execute({
      uniqueCode: body.uniquecode as string ?? body.uniqueCode as string,
      productId: String(body.id_goods ?? body.product_id ?? ''),
      quantity: (body.cnt as number) ?? 1,
      providerAccountId: auth.providerAccountId,
      providerCode: 'digiseller',
      buyerEmail: body.email as string | undefined,
    });

    if (!result.success || !result.keys?.length) {
      return reply.send({ retval: 0 });
    }

    return reply.send({
      retval: 1,
      content: result.keys.join('\n'),
    });
  });
}
