/**
 * Seller webhook routes -- public endpoints for marketplace callbacks.
 *
 * These endpoints do NOT use adminGuard; each marketplace authenticates
 * via its own scheme handled by createMarketplaceAuthMiddleware.
 *
 * Route mapping:
 *   POST /webhooks/eneba                         -> Eneba Declared Stock (RESERVE/PROVIDE/CANCEL)
 *   POST /webhooks/g2a/oauth/token               -> G2A OAuth2 token exchange
 *   GET  /webhooks/g2a/healthcheck               -> G2A health check (204)
 *   POST /webhooks/g2a/reservation               -> G2A create reservation + deliver keys
 *   PUT  /webhooks/g2a/reservation/:id           -> G2A renew reservation
 *   DELETE /webhooks/g2a/reservation/:id         -> G2A cancel reservation
 *   POST /webhooks/g2a/order                     -> G2A confirm order from reservation
 *   GET  /webhooks/g2a/order/:id/inventory       -> G2A retrieve order keys (idempotent)
 *   DELETE /webhooks/g2a/order/:id/inventory     -> G2A return keys (refund)
 *   POST /webhooks/g2a/notifications             -> G2A auction deactivation notifications
 *   POST /webhooks/kinguin                       -> Kinguin seller callbacks
 *   POST /webhooks/kinguin-buyer                 -> Kinguin buyer webhooks
 *   GET  /webhooks/gamivo                        -> Gamivo health check (204)
 *   POST /webhooks/gamivo/reservation            -> Gamivo reserve stock
 *   POST /webhooks/gamivo/order                  -> Gamivo confirm order + deliver keys
 *   GET  /webhooks/gamivo/order/:id/keys         -> Gamivo retrieve order keys (idempotent)
 *   POST /webhooks/gamivo/refund                 -> Gamivo refund (cumulative, 204)
 *   POST /webhooks/gamivo/offer-deactivation     -> Gamivo listing deactivation (204)
 *   POST /webhooks/digiseller                    -> Digiseller form delivery
 *   POST /webhooks/digiseller/quantity            -> Digiseller quantity check
 *   POST /webhooks/bamboo                         -> Bamboo procurement callbacks
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import {
  createMarketplaceAuthMiddleware,
  type ProviderAuthResult,
} from '../middleware/marketplace-auth.middleware.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { HandleDeclaredStockReserveUseCase } from '../../core/use-cases/seller-webhook/eneba/handle-declared-stock-reserve.use-case.js';
import type { HandleDeclaredStockProvideUseCase } from '../../core/use-cases/seller-webhook/eneba/handle-declared-stock-provide.use-case.js';
import type { HandleDeclaredStockCancelUseCase } from '../../core/use-cases/seller-webhook/eneba/handle-declared-stock-cancel.use-case.js';
import type { HandleDigisellerDeliveryUseCase } from '../../core/use-cases/seller-webhook/digiseller/handle-digiseller-delivery.use-case.js';
import type { HandleDigisellerQuantityCheckUseCase } from '../../core/use-cases/seller-webhook/digiseller/handle-digiseller-quantity-check.use-case.js';
import type { HandleG2AReservationUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-reservation.use-case.js';
import type { HandleG2AOrderUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-order.use-case.js';
import type { HandleG2ARenewReservationUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-renew-reservation.use-case.js';
import type { HandleG2ACancelReservationUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-cancel-reservation.use-case.js';
import type { HandleG2AGetInventoryUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-get-inventory.use-case.js';
import type { HandleG2AReturnInventoryUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-return-inventory.use-case.js';
import type { HandleG2ANotificationsUseCase } from '../../core/use-cases/seller-webhook/g2a/handle-g2a-notifications.use-case.js';
import {
  parseReservationRequest,
  parseOrderRequest,
  parseNotifications,
  G2AParseError,
  buildContractError,
} from '../../core/use-cases/seller-webhook/g2a/g2a-parser.js';
import { resolveProviderSecrets } from '../../infra/marketplace/resolve-provider-secrets.js';
import { timingSafeEqual } from '../../infra/marketplace/_shared/marketplace-http.js';
import type { HandleGamivoReservationUseCase } from '../../core/use-cases/seller-webhook/gamivo/handle-gamivo-reservation.use-case.js';
import type { HandleGamivoOrderUseCase } from '../../core/use-cases/seller-webhook/gamivo/handle-gamivo-order.use-case.js';
import type { HandleGamivoGetKeysUseCase } from '../../core/use-cases/seller-webhook/gamivo/handle-gamivo-get-keys.use-case.js';
import type { HandleGamivoRefundUseCase } from '../../core/use-cases/seller-webhook/gamivo/handle-gamivo-refund.use-case.js';
import type { HandleGamivoOfferDeactivationUseCase } from '../../core/use-cases/seller-webhook/gamivo/handle-gamivo-offer-deactivation.use-case.js';
import type { HandleKinguinWebhookUseCase } from '../../core/use-cases/seller-webhook/kinguin/handle-kinguin-webhook.use-case.js';
import type { HandleKinguinBuyerWebhookUseCase } from '../../core/use-cases/seller-webhook/kinguin/handle-kinguin-buyer-webhook.use-case.js';
import type { HandleBambooCallbackUseCase } from '../../core/use-cases/seller-webhook/bamboo/handle-bamboo-callback.use-case.js';
import {
  parseBambooCallbackPayload,
  BambooParseError,
} from '../../core/use-cases/seller-webhook/bamboo/bamboo-parser.js';
import {
  parseKinguinWebhookPayload,
  KinguinParseError,
} from '../../core/use-cases/seller-webhook/kinguin/kinguin-parser.js';
import {
  parseReservationRequest as parseGamivoReservation,
  parseOrderRequest as parseGamivoOrder,
  parseRefundRequest as parseGamivoRefund,
  parseOfferDeactivation as parseGamivoDeactivation,
  buildErrorResponse as buildGamivoError,
  GamivoParseError,
} from '../../core/use-cases/seller-webhook/gamivo/gamivo-parser.js';
import {
  parseCallbackPayload,
  ParseError,
  buildReservationResponse,
  buildProvisionResponse,
  buildAuctionKeysResponse,
  buildTextKey,
} from '../../core/use-cases/seller-webhook/eneba/eneba-payload-parser.js';
import {
  buildMarketplaceFinancialsFromEnebaAuction,
  computeAggregateFeesCents,
} from '../../core/use-cases/seller-webhook/eneba/eneba-marketplace-financials.js';
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
    let parsed;
    try {
      parsed = parseCallbackPayload(request.body);
    } catch (err) {
      if (err instanceof ParseError) {
        logger.warn('Eneba payload validation failed', { error: err.message });
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }

    const { action, orderId, originalOrderId, auctions, wholesale } = parsed;

    switch (action) {
      case 'RESERVE': {
        const enrichedAuctions = auctions!.map((auction) => {
          try {
            const financials = buildMarketplaceFinancialsFromEnebaAuction(auction, wholesale ?? false);
            return { ...auction, marketplaceFinancials: financials };
          } catch (err) {
            logger.warn('Eneba financial enrichment failed — proceeding without financials', err as Error, {
              orderId,
              auctionId: auction.auctionId,
              wholesale: wholesale ?? false,
            });
            return auction;
          }
        });

        const feesCents = computeAggregateFeesCents(auctions!, wholesale ?? false);

        const uc = container.resolve<HandleDeclaredStockReserveUseCase>(UC_TOKENS.HandleDeclaredStockReserve);
        const result = await uc.execute({
          orderId,
          originalOrderId,
          auctions: enrichedAuctions,
          wholesale,
          providerCode: 'eneba',
          feesCents,
        });

        if (!result.success) {
          // Production reference (Sentry LOOTCODES-API-T / -S): every
          // success:false here was double-reported — once via logger.warn
          // (auto-forwarded) and once via Sentry.captureMessage. The vast
          // majority of these failures are normal market behavior:
          //   - `out_of_stock`: no buyer-capable provider has stock at our floor
          //   - `listing_inactive` / `listing_not_found`: race with reconcile
          //   - `no_auctions`: caller-side payload weirdness
          // Use case has already logged at the right level for each case.
          // Only surface to Sentry as `warn` for `unexpected_error` — true bugs.
          const reason = result.reason ?? 'unexpected_error';
          if (reason === 'unexpected_error') {
            logger.warn('Eneba RESERVE returned failure (unexpected) — responding success:false', {
              orderId, originalOrderId, reason,
              auctionIds: auctions?.map((a) => a.auctionId),
            });
          } else {
            logger.info('Eneba RESERVE responding success:false (expected business outcome)', {
              orderId, originalOrderId, reason,
            });
          }
        }

        return reply.send(buildReservationResponse(result.orderId, result.success));
      }

      case 'PROVIDE': {
        const uc = container.resolve<HandleDeclaredStockProvideUseCase>(UC_TOKENS.HandleDeclaredStockProvide);
        const result = await uc.execute({
          orderId,
          originalOrderId,
          providerCode: 'eneba',
        });

        if (!result.success || !result.auctions) {
          // PROVIDE failures are genuine errors — we promised Eneba we had
          // keys (RESERVE returned success) but cannot deliver them now.
          // Single error log; logger.error auto-forwards to Sentry.
          logger.error('Eneba PROVIDE returned failure — responding success:false', {
            orderId, originalOrderId,
          });
          return reply.send(buildProvisionResponse(result.orderId, result.success));
        }

        const responseAuctions = result.auctions.map((a) =>
          buildAuctionKeysResponse(
            a.auctionId,
            a.keys.map((k) => buildTextKey(k.value)),
          ),
        );

        return reply.send(buildProvisionResponse(result.orderId, true, responseAuctions));
      }

      case 'CANCEL': {
        const uc = container.resolve<HandleDeclaredStockCancelUseCase>(UC_TOKENS.HandleDeclaredStockCancel);
        await uc.execute({
          orderId,
          originalOrderId,
          providerCode: 'eneba',
        });
        return reply.status(200).send();
      }
    }
  });

  // ─── G2A Dropshipping Contract ───────────────────────────────────────

  app.get('/g2a/healthcheck', async (_request, reply) => {
    return reply.status(204).send();
  });

  app.post('/g2a/oauth/token', async (request, reply) => {
    try {
      const result = await handleG2ATokenExchange(request);
      return reply.status(result.status).send(result.body);
    } catch (err) {
      logger.error('G2A token exchange error', err as Error);
      return reply.status(500).send({ error: 'server_error' });
    }
  });

  app.post('/g2a/reservation', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    let items;
    try {
      items = parseReservationRequest(request.body);
    } catch (err) {
      if (err instanceof G2AParseError) {
        return reply.status(400).send(buildContractError('BR02', err.message));
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleG2AReservationUseCase>(UC_TOKENS.HandleG2AReservation);
    const result = await uc.execute({ items, providerAccountId: auth.providerAccountId });

    if (!result.ok) {
      return reply.status(result.status).send(buildContractError(result.code, result.message));
    }
    return reply.send(result.response);
  });

  app.put('/g2a/reservation/:id', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auth = getAuth(request);

    const uc = container.resolve<HandleG2ARenewReservationUseCase>(UC_TOKENS.HandleG2ARenewReservation);
    const result = await uc.execute({
      externalReservationId: id,
      providerAccountId: auth.providerAccountId,
    });

    if (!result.ok) {
      return reply.status(result.status).send(buildContractError(result.code, result.message));
    }
    return reply.send(result.response);
  });

  app.delete('/g2a/reservation/:id', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const uc = container.resolve<HandleG2ACancelReservationUseCase>(UC_TOKENS.HandleG2ACancelReservation);
    const result = await uc.execute({ externalReservationId: id });

    if (!result.ok) {
      return reply.status(result.status).send(buildContractError(result.code, result.message));
    }
    return reply.status(204).send();
  });

  app.post('/g2a/order', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseOrderRequest(request.body);
    } catch (err) {
      if (err instanceof G2AParseError) {
        return reply.status(400).send(buildContractError('BR02', err.message));
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleG2AOrderUseCase>(UC_TOKENS.HandleG2AOrder);
    const result = await uc.execute({
      reservation_id: parsed.reservation_id,
      g2a_order_id: parsed.g2a_order_id,
      providerAccountId: auth.providerAccountId,
    });

    if (!result.ok) {
      return reply.status(result.status).send(buildContractError(result.code, result.message));
    }
    return reply.status(result.status).send(result.response);
  });

  app.get('/g2a/order/:id/inventory', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const uc = container.resolve<HandleG2AGetInventoryUseCase>(UC_TOKENS.HandleG2AGetInventory);
    const result = await uc.execute({ orderId: id });

    if (!result.ok) {
      return reply.status(result.status).send(buildContractError(result.code, result.message));
    }
    return reply.send(result.response);
  });

  app.delete('/g2a/order/:id/inventory', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | string[]>;
    const itemIds = Array.isArray(query['id[]']) ? query['id[]'] : (query['id[]'] ? [query['id[]']] : []);

    const uc = container.resolve<HandleG2AReturnInventoryUseCase>(UC_TOKENS.HandleG2AReturnInventory);
    const result = await uc.execute({ orderId: id, itemIds });

    if (!result.ok) {
      return reply.status(result.status).send(buildContractError(result.code, result.message));
    }
    return reply.status(204).send();
  });

  app.post('/g2a/notifications', {
    preHandler: [createMarketplaceAuthMiddleware('g2a')],
  }, async (request, reply) => {
    let notifications;
    try {
      notifications = parseNotifications(request.body);
    } catch (err) {
      if (err instanceof G2AParseError) {
        return reply.status(400).send(buildContractError('BR02', err.message));
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleG2ANotificationsUseCase>(UC_TOKENS.HandleG2ANotifications);
    await uc.execute({ notifications, providerAccountId: auth.providerAccountId });

    return reply.status(204).send();
  });

  // ─── Kinguin Seller Callbacks (Envoy lifecycle webhooks) ─────────────
  //
  // Single endpoint handling 13+ status values via HandleKinguinWebhookUseCase.
  // Keys are delivered OUTBOUND (POST to Kinguin Sales Manager API),
  // not returned in the response body.

  app.post('/kinguin', {
    preHandler: [createMarketplaceAuthMiddleware('kinguin')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseKinguinWebhookPayload(request.body);
    } catch (err) {
      if (err instanceof KinguinParseError) {
        logger.warn('Kinguin payload validation failed', { error: err.message });
        return reply.status(400).send({ status: 'error', error: err.message });
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleKinguinWebhookUseCase>(UC_TOKENS.HandleKinguinWebhook);
    const result = await uc.execute({
      payload: parsed,
      providerAccountId: auth.providerAccountId,
    });

    return reply.status(result.status).send(result.body);
  });

  // ─── Kinguin Buyer Webhooks (ESA subscriptions) ────────────────────
  //
  // Authenticated via X-Event-Secret header (not X-Auth-Token).
  // MUST return 204 No Content (Kinguin ESA spec requirement).

  app.post('/kinguin-buyer', {
    preHandler: [createMarketplaceAuthMiddleware('kinguin-buyer')],
  }, async (request, reply) => {
    const eventName = (request.headers['x-event-name'] as string) ?? '';
    const auth = getAuth(request);

    const uc = container.resolve<HandleKinguinBuyerWebhookUseCase>(UC_TOKENS.HandleKinguinBuyerWebhook);
    await uc.execute({
      eventName,
      payload: request.body,
      providerAccountId: auth.providerAccountId,
    });

    return reply.status(204).send();
  });

  // ─── Gamivo Import API ───────────────────────────────────────────────

  app.get('/gamivo', async (_request, reply) => {
    return reply.status(204).send();
  });

  app.post('/gamivo/reservation', {
    preHandler: [createMarketplaceAuthMiddleware('gamivo')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseGamivoReservation(request.body);
    } catch (err) {
      if (err instanceof GamivoParseError) {
        return reply.status(400).send(buildGamivoError('invalid_request', err.message));
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleGamivoReservationUseCase>(UC_TOKENS.HandleGamivoReservation);
    const result = await uc.execute({
      productId: parsed.productId,
      quantity: parsed.quantity,
      unitPrice: parsed.unitPrice,
      providerAccountId: auth.providerAccountId,
    });

    if (!result.ok) {
      return reply.status(result.status).send(buildGamivoError(result.code, result.message));
    }
    return reply.send({ reservation_id: result.reservationId });
  });

  app.post('/gamivo/order', {
    preHandler: [createMarketplaceAuthMiddleware('gamivo')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseGamivoOrder(request.body);
    } catch (err) {
      if (err instanceof GamivoParseError) {
        return reply.status(400).send(buildGamivoError('invalid_request', err.message));
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleGamivoOrderUseCase>(UC_TOKENS.HandleGamivoOrder);
    const result = await uc.execute({
      reservationId: parsed.reservationId,
      gamivoOrderId: parsed.gamivoOrderId,
      createdTime: parsed.createdTime,
      providerAccountId: auth.providerAccountId,
    });

    if (!result.ok) {
      return reply.status(result.status).send(buildGamivoError(result.code, result.message));
    }
    return reply.send({
      provider_order_id: result.providerOrderId,
      keys: result.keys,
      available_stock: result.availableStock,
    });
  });

  const GAMIVO_ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

  app.get('/gamivo/order/:id/keys', {
    preHandler: [createMarketplaceAuthMiddleware('gamivo')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!GAMIVO_ID_SEGMENT.test(id)) {
      return reply.status(400).send(buildGamivoError('invalid_request', 'Invalid order ID'));
    }

    const uc = container.resolve<HandleGamivoGetKeysUseCase>(UC_TOKENS.HandleGamivoGetKeys);
    const result = await uc.execute({ providerOrderId: id });

    if (!result.ok) {
      return reply.status(result.status).send(buildGamivoError(result.code, result.message));
    }
    return reply.send({ keys: result.keys, available_stock: result.availableStock });
  });

  app.post('/gamivo/refund', {
    preHandler: [createMarketplaceAuthMiddleware('gamivo')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseGamivoRefund(request.body);
    } catch (err) {
      if (err instanceof GamivoParseError) {
        return reply.status(400).send(buildGamivoError('invalid_request', err.message));
      }
      throw err;
    }

    const uc = container.resolve<HandleGamivoRefundUseCase>(UC_TOKENS.HandleGamivoRefund);
    const result = await uc.execute({
      orderId: parsed.orderId,
      reservationId: parsed.reservationId,
      refundedAt: parsed.refundedAt,
      refundedKeysCount: parsed.refundedKeysCount,
    });

    return reply.status(result.status).send();
  });

  app.post('/gamivo/offer-deactivation', {
    preHandler: [createMarketplaceAuthMiddleware('gamivo')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseGamivoDeactivation(request.body);
    } catch (err) {
      if (err instanceof GamivoParseError) {
        return reply.status(400).send(buildGamivoError('invalid_request', err.message));
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleGamivoOfferDeactivationUseCase>(UC_TOKENS.HandleGamivoOfferDeactivation);
    const result = await uc.execute({
      offerId: parsed.offerId,
      productName: parsed.productName,
      reason: parsed.reason,
      providerAccountId: auth.providerAccountId,
    });

    return reply.status(result.status).send();
  });

  // ─── Digiseller Form Delivery (Supplier API) ─────────────────────────
  //
  // POST /digiseller          → sale notification → { id, inv, goods } | { id, inv, error }
  // POST /digiseller/quantity  → stock quantity    → { product_id, count }

  app.post('/digiseller', {
    preHandler: [createMarketplaceAuthMiddleware('digiseller')],
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const auth = getAuth(request);

    const uc = container.resolve<HandleDigisellerDeliveryUseCase>(UC_TOKENS.HandleDigisellerDelivery);
    const result = await uc.execute({
      providerAccountId: auth.providerAccountId,
      providerCode: 'digiseller',
      payload: body as import('../../core/use-cases/seller-webhook/seller-webhook.types.js').DigisellerFormDeliveryPayload,
    });

    if (!result.success || !result.keys?.length) {
      return reply.send({
        id: String(result.productId ?? ''),
        inv: Number(result.invoiceId ?? 0),
        error: result.errorMessage ?? 'Delivery failed',
      });
    }

    return reply.send({
      id: String(result.productId ?? ''),
      inv: Number(result.invoiceId ?? 0),
      goods: result.keys.join('\n'),
    });
  });

  app.post('/digiseller/quantity', {
    preHandler: [createMarketplaceAuthMiddleware('digiseller')],
  }, async (request, reply) => {
    const auth = getAuth(request);
    let rawBody: string | null = null;
    let productId: string | null = null;
    let requestedCount = 0;
    let sign: string | null = null;
    let isTestEnvelope = false;

    try {
      const body = request.body as Record<string, unknown> & {
        forward?: { product_id?: string | number; count?: number; sign?: string };
      };
      rawBody = JSON.stringify(body);
      productId = body.product_id ? String(body.product_id) : null;
      requestedCount = typeof body.count === 'number' ? body.count : 0;
      sign = typeof body.sign === 'string' ? body.sign : null;

      if (body.forward && typeof body.forward === 'object') {
        isTestEnvelope = true;
        if (!productId && body.forward.product_id) {
          productId = String(body.forward.product_id);
        }
        if (!requestedCount && typeof body.forward.count === 'number') {
          requestedCount = body.forward.count;
        }
      }
    } catch (err) {
      logger.warn('Digiseller quantity-check JSON parse failed — falling back to query params', err as Error);
    }

    if (!productId) {
      const query = request.query as Record<string, string>;
      productId = query.product_id ?? query.id_goods ?? null;
    }

    if (!productId) {
      return reply.send({ product_id: '', count: 0, error: 'Missing product_id' });
    }

    const uc = container.resolve<HandleDigisellerQuantityCheckUseCase>(UC_TOKENS.HandleDigisellerQuantityCheck);
    const result = await uc.execute({
      providerAccountId: auth.providerAccountId,
      productId,
      requestedCount,
      sign,
      isTestEnvelope,
      rawBody,
    });

    return reply.send(result);
  });

  // ─── Bamboo Procurement Callbacks ───────────────────────────────────
  //
  // POST /bamboo  → order notification callback (Succeeded / Failed / PartialFailed)
  //
  // Bamboo includes secretKey in the JSON body (not headers).
  // Auth is verified by comparing against configured BAMBOO_WEBHOOK_SECRET.

  app.post('/bamboo', {
    preHandler: [createMarketplaceAuthMiddleware('bamboo')],
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = parseBambooCallbackPayload(request.body);
    } catch (err) {
      if (err instanceof BambooParseError) {
        logger.warn('Bamboo callback parse error', { error: err.message });
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }

    const auth = getAuth(request);
    const uc = container.resolve<HandleBambooCallbackUseCase>(UC_TOKENS.HandleBambooCallback);
    const result = await uc.execute({
      payload: parsed,
      providerAccountId: auth.providerAccountId,
    });

    return reply.status(result.status).send(result.body);
  });
}

// ─── G2A OAuth2 Token Exchange ────────────────────────────────────────

const G2A_TOKEN_EXPIRY_SECONDS = 3600;

interface TokenExchangeResult {
  status: number;
  body: Record<string, unknown>;
}

function parseG2ACredentials(
  request: FastifyRequest,
): { grantType: string; clientId: string; clientSecret: string } {
  const query = request.query as Record<string, string>;

  if (query.grant_type) {
    return {
      grantType: query.grant_type,
      clientId: query.client_id ?? '',
      clientSecret: query.client_secret ?? '',
    };
  }

  const body = (request.body ?? {}) as Record<string, string>;
  return {
    grantType: body.grant_type ?? '',
    clientId: body.client_id ?? '',
    clientSecret: body.client_secret ?? '',
  };
}

async function handleG2ATokenExchange(
  request: FastifyRequest,
): Promise<TokenExchangeResult> {
  const { grantType, clientId, clientSecret } = parseG2ACredentials(request);

  if (grantType !== 'client_credentials') {
    logger.warn('G2A token request with invalid grant_type', { grantType });
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  const db = container.resolve<IDatabase>(TOKENS.Database);

  const account = await db.queryOne<{
    id: string;
    seller_config: Record<string, unknown>;
  }>('provider_accounts', {
    select: 'id, seller_config',
    eq: [['provider_code', 'g2a'], ['supports_seller', true]],
    single: true,
  });

  if (!account) {
    logger.error('G2A seller provider account not found');
    return { status: 500, body: { error: 'server_error' } };
  }

  const secrets = await resolveProviderSecrets(db, account.id);
  const expectedClientId = secrets['G2A_CLIENT_ID'] ?? '';
  const expectedClientSecret = secrets['G2A_CLIENT_SECRET'] ?? '';

  if (
    !expectedClientId ||
    !expectedClientSecret ||
    !timingSafeEqual(clientId, expectedClientId) ||
    !timingSafeEqual(clientSecret, expectedClientSecret)
  ) {
    logger.warn('G2A token request with invalid credentials');
    return { status: 401, body: { error: 'invalid_client' } };
  }

  const sellerConfig = (account.seller_config ?? {}) as Record<string, unknown>;
  let callbackToken = sellerConfig.g2a_callback_auth_token as string | undefined;

  if (!callbackToken) {
    const { randomUUID } = await import('node:crypto');
    callbackToken = randomUUID();
    const updatedConfig = { ...sellerConfig, g2a_callback_auth_token: callbackToken };

    await db.update('provider_accounts', { id: account.id }, {
      seller_config: updatedConfig,
    });

    logger.info('Auto-generated g2a_callback_auth_token', { accountId: account.id });
  }

  return {
    status: 200,
    body: {
      access_token: callbackToken,
      token_type: 'bearer',
      expires_in: G2A_TOKEN_EXPIRY_SECONDS,
    },
  };
}
