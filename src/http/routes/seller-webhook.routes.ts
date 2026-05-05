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
 *   POST /webhooks/gamivo                        -> Gamivo refund/deactivation
 *   GET  /webhooks/gamivo                        -> Gamivo health check (204)
 *   POST /webhooks/digiseller                    -> Digiseller form delivery
 *   POST /webhooks/digiseller/quantity            -> Digiseller quantity check
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import {
  createMarketplaceAuthMiddleware,
  type ProviderAuthResult,
} from '../middleware/marketplace-auth.middleware.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { HandleDeclaredStockReserveUseCase } from '../../core/use-cases/seller-webhook/handle-declared-stock-reserve.use-case.js';
import type { HandleDeclaredStockProvideUseCase } from '../../core/use-cases/seller-webhook/handle-declared-stock-provide.use-case.js';
import type { HandleDeclaredStockCancelUseCase } from '../../core/use-cases/seller-webhook/handle-declared-stock-cancel.use-case.js';
import type { HandleMarketplaceRefundUseCase } from '../../core/use-cases/seller-webhook/handle-marketplace-refund.use-case.js';
import type { HandleListingDeactivationUseCase } from '../../core/use-cases/seller-webhook/handle-listing-deactivation.use-case.js';
import type { HandleDigisellerDeliveryUseCase } from '../../core/use-cases/seller-webhook/handle-digiseller-delivery.use-case.js';
import type { HandleDigisellerQuantityCheckUseCase } from '../../core/use-cases/seller-webhook/handle-digiseller-quantity-check.use-case.js';
import type { HandleKeyUploadOrderUseCase } from '../../core/use-cases/seller-webhook/handle-key-upload-order.use-case.js';
import type { HandleG2AReservationUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-reservation.use-case.js';
import type { HandleG2AOrderUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-order.use-case.js';
import type { HandleG2ARenewReservationUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-renew-reservation.use-case.js';
import type { HandleG2ACancelReservationUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-cancel-reservation.use-case.js';
import type { HandleG2AGetInventoryUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-get-inventory.use-case.js';
import type { HandleG2AReturnInventoryUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-return-inventory.use-case.js';
import type { HandleG2ANotificationsUseCase } from '../../core/use-cases/seller-webhook/handle-g2a-notifications.use-case.js';
import {
  parseReservationRequest,
  parseOrderRequest,
  parseNotifications,
  G2AParseError,
  buildContractError,
} from '../../core/use-cases/seller-webhook/g2a-parser.js';
import { resolveProviderSecrets } from '../../infra/marketplace/resolve-provider-secrets.js';
import { timingSafeEqual } from '../../infra/marketplace/_shared/marketplace-http.js';
import {
  parseCallbackPayload,
  ParseError,
  buildReservationResponse,
  buildProvisionResponse,
  buildAuctionKeysResponse,
  buildTextKey,
} from '../parsers/eneba-payload-parser.js';
import {
  buildMarketplaceFinancialsFromEnebaAuction,
  computeAggregateFeesCents,
} from '../parsers/eneba-marketplace-financials.js';
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
          } catch {
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
    } catch {
      // fall through
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
