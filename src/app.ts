import * as Sentry from '@sentry/node';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import crypto from 'node:crypto';
import { loadEnv } from './config/env.js';
import { buildCorsOrigins, corsOriginValidator } from './config/cors.js';
import { errorHandler } from './http/middleware/error-handler.js';
import { registerIpBlocklistHook } from './http/middleware/ip-blocklist.hook.js';
import { healthRoutes } from './http/routes/health.routes.js';
import { adminOrderRoutes } from './http/routes/orders.routes.js';
import { adminInventoryRoutes } from './http/routes/inventory.routes.js';
import { adminInventorySourceRoutes } from './http/routes/inventory-sources.routes.js';
import { adminUserRoutes } from './http/routes/users.routes.js';
import { adminSecurityRoutes } from './http/routes/security.routes.js';
import { adminPromoRoutes } from './http/routes/promo.routes.js';
import { adminSupportRoutes } from './http/routes/support.routes.js';
import { adminCurrencyRoutes } from './http/routes/currency.routes.js';
import { adminProcurementRoutes } from './http/routes/procurement.routes.js';
import { adminPriceMatchRoutes } from './http/routes/price-match.routes.js';
import { adminReferralRoutes } from './http/routes/referrals.routes.js';
import { adminReviewRoutes } from './http/routes/reviews.routes.js';
import { adminAnalyticsRoutes } from './http/routes/analytics.routes.js';
import { adminNotificationRoutes } from './http/routes/notifications.routes.js';
import { adminAlgoliaRoutes } from './http/routes/algolia.routes.js';
import { adminSettingsRoutes } from './http/routes/settings.routes.js';
import { adminApprovalRoutes } from './http/routes/approvals.routes.js';
import { adminAuditRoutes } from './http/routes/audit.routes.js';
import { adminVerificationRoutes } from './http/routes/verification.routes.js';
import { adminAuthRoutes } from './http/routes/admin-auth.routes.js';
import { adminDigisellerRoutes } from './http/routes/digiseller.routes.js';
import { adminPricingRoutes } from './http/routes/pricing.routes.js';
import { adminProductRoutes } from './http/routes/products.routes.js';
import { adminSellerRoutes } from './http/routes/seller.routes.js';
import { adminSellerPricingRoutes } from './http/routes/seller-pricing.routes.js';
import { adminOpportunitiesRoutes } from './http/routes/opportunities.routes.js';
import { adminAlertsRoutes } from './http/routes/alerts.routes.js';
import { sellerWebhookRoutes } from './http/routes/seller-webhook.routes.js';
import { registerCronJobs } from './infra/scheduler/cron-registry.js';
import { bootstrapMarketplaceAdapters } from './infra/marketplace/marketplace-adapter-bootstrap.js';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    trustProxy: true,
    requestTimeout: 30_000,
    bodyLimit: 1_048_576,
  });

  const origins = buildCorsOrigins(env);
  await app.register(cors, {
    origin: corsOriginValidator(origins),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-requested-with', 'x-requested-by', 'x-internal-secret'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
  });

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });

  await app.register(sensible);

  app.addHook('onRequest', async (request, reply) => {
    const incomingId = request.headers['x-request-id'];
    const requestId = typeof incomingId === 'string' && incomingId.length > 0
      ? incomingId
      : crypto.randomUUID();
    (request as unknown as Record<string, unknown>).requestId = requestId;
    void reply.header('X-Request-Id', requestId);
  });

  registerIpBlocklistHook(app);

  app.get('/eneba-verification.txt', async (_request, reply) => {
    return reply
      .type('text/plain')
      .send('eneba-merchant-verification=9ed945eae2edf4fdd7c4cb59aa8093b1cbc4aef73addd0368bd054c8339defd2');
  });

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(adminOrderRoutes, { prefix: '/orders' });
  await app.register(adminInventoryRoutes, { prefix: '/inventory' });
  await app.register(adminInventorySourceRoutes, { prefix: '/inventory-sources' });
  await app.register(adminUserRoutes, { prefix: '/users' });
  await app.register(adminSecurityRoutes, { prefix: '/security' });
  await app.register(adminPromoRoutes, { prefix: '/promo' });
  await app.register(adminSupportRoutes, { prefix: '/support' });
  await app.register(adminCurrencyRoutes, { prefix: '/currency' });
  await app.register(adminProcurementRoutes, { prefix: '/procurement' });
  await app.register(adminPriceMatchRoutes, { prefix: '/price-match' });
  await app.register(adminReferralRoutes, { prefix: '/referrals' });
  await app.register(adminReviewRoutes, { prefix: '/reviews' });
  await app.register(adminAnalyticsRoutes, { prefix: '/analytics' });
  await app.register(adminNotificationRoutes, { prefix: '/notifications' });
  await app.register(adminAlgoliaRoutes, { prefix: '/algolia' });
  await app.register(adminSettingsRoutes, { prefix: '/settings' });
  await app.register(adminApprovalRoutes, { prefix: '/approvals' });
  await app.register(adminAuditRoutes, { prefix: '/audit' });
  await app.register(adminVerificationRoutes, { prefix: '/verification' });
  await app.register(adminAuthRoutes, { prefix: '/auth' });
  await app.register(adminDigisellerRoutes, { prefix: '/digiseller' });
  await app.register(adminPricingRoutes, { prefix: '/pricing' });
  await app.register(adminProductRoutes, { prefix: '/products' });
  await app.register(adminSellerRoutes, { prefix: '/seller' });
  await app.register(adminSellerPricingRoutes, { prefix: '/seller-pricing' });
  await app.register(adminOpportunitiesRoutes, { prefix: '/opportunities' });
  await app.register(adminAlertsRoutes, { prefix: '/alerts' });
  await app.register(sellerWebhookRoutes, { prefix: '/webhooks' });

  Sentry.setupFastifyErrorHandler(app);

  app.setErrorHandler(errorHandler);

  await registerCronJobs(app);

  app.addHook('onReady', async () => {
    const { container } = await import('./di/container.js');
    const { TOKENS } = await import('./di/tokens.js');
    const db = container.resolve(TOKENS.Database) as import('./core/ports/database.port.js').IDatabase;
    const registry = container.resolve(TOKENS.MarketplaceAdapterRegistry) as import('./core/ports/marketplace-adapter.port.js').IMarketplaceAdapterRegistry;
    await bootstrapMarketplaceAdapters(db, registry);
  });

  return app;
}
