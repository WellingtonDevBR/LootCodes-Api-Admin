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

  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(adminOrderRoutes, { prefix: '/api/admin/orders' });
  await app.register(adminInventoryRoutes, { prefix: '/api/admin/inventory' });
  await app.register(adminInventorySourceRoutes, { prefix: '/api/admin/inventory-sources' });
  await app.register(adminUserRoutes, { prefix: '/api/admin/users' });
  await app.register(adminSecurityRoutes, { prefix: '/api/admin/security' });
  await app.register(adminPromoRoutes, { prefix: '/api/admin/promo' });
  await app.register(adminSupportRoutes, { prefix: '/api/admin/support' });
  await app.register(adminCurrencyRoutes, { prefix: '/api/admin/currency' });
  await app.register(adminProcurementRoutes, { prefix: '/api/admin/procurement' });
  await app.register(adminPriceMatchRoutes, { prefix: '/api/admin/price-match' });
  await app.register(adminReferralRoutes, { prefix: '/api/admin/referrals' });
  await app.register(adminReviewRoutes, { prefix: '/api/admin/reviews' });
  await app.register(adminAnalyticsRoutes, { prefix: '/api/admin/analytics' });
  await app.register(adminNotificationRoutes, { prefix: '/api/admin/notifications' });
  await app.register(adminAlgoliaRoutes, { prefix: '/api/admin/algolia' });
  await app.register(adminSettingsRoutes, { prefix: '/api/admin/settings' });
  await app.register(adminApprovalRoutes, { prefix: '/api/admin/approvals' });
  await app.register(adminAuditRoutes, { prefix: '/api/admin/audit' });
  await app.register(adminVerificationRoutes, { prefix: '/api/admin/verification' });
  await app.register(adminAuthRoutes, { prefix: '/api/admin/auth' });
  await app.register(adminDigisellerRoutes, { prefix: '/api/admin/digiseller' });
  await app.register(adminPricingRoutes, { prefix: '/api/admin/pricing' });
  await app.register(adminProductRoutes, { prefix: '/api/admin/products' });
  await app.register(adminSellerRoutes, { prefix: '/api/admin/seller' });

  Sentry.setupFastifyErrorHandler(app);

  app.setErrorHandler(errorHandler);

  return app;
}
