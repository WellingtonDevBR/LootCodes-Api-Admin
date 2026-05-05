/**
 * Per-provider marketplace authentication middleware.
 *
 * Each marketplace uses a different authentication scheme:
 *   - Eneba:     Bearer token -> seller_config.callback_auth_token
 *   - Kinguin:   X-Auth-Token header -> seller_config.callback_auth_token
 *   - Kinguin (buyer): X-Event-Secret -> api_profile.buyer_webhook_secret
 *   - G2A:       Bearer token -> seller_config.g2a_callback_auth_token
 *   - Gamivo:    Bearer token -> seller_config.callback_auth_token
 *   - Digiseller: X-Callback-Secret header or ?secret= query -> seller_config.callback_auth_token
 *
 * Uses timing-safe comparison to prevent timing attacks.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import { timingSafeEqual } from '../../infra/marketplace/_shared/marketplace-http.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('marketplace-auth');

export interface ProviderAuthResult {
  providerAccountId: string;
  providerCode: string;
  sellerConfig: Record<string, unknown>;
  apiProfile?: Record<string, unknown>;
}

type AuthStrategy = (req: FastifyRequest, db: IDatabase) => Promise<ProviderAuthResult | null>;

// ─── Auth Strategy: Bearer Token (seller_config) ─────────────────────

function bearerTokenStrategy(providerCode: string, configKey = 'callback_auth_token'): AuthStrategy {
  return async (req, db) => {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!token) {
      logger.warn(`Missing auth token for ${providerCode}`);
      return null;
    }

    return authenticateCallback(db, providerCode, token, configKey);
  };
}

// ─── Auth Strategy: Custom Header (seller_config) ────────────────────

function customHeaderStrategy(providerCode: string, headerName: string, configKey = 'callback_auth_token'): AuthStrategy {
  return async (req, db) => {
    const token = (req.headers[headerName.toLowerCase()] as string) ?? '';

    if (!token) {
      logger.warn(`Missing ${headerName} for ${providerCode}`);
      return null;
    }

    return authenticateCallback(db, providerCode, token, configKey);
  };
}

// ─── Auth Strategy: Query/Header Secret (seller_config) ──────────────

function secretParamStrategy(providerCode: string): AuthStrategy {
  return async (req, db) => {
    const headerSecret = (req.headers['x-callback-secret'] as string) ?? '';
    const querySecret = (req.query as Record<string, string>).secret ?? '';
    const token = headerSecret || querySecret;

    if (!token) {
      logger.warn(`Missing secret for ${providerCode}`);
      return null;
    }

    return authenticateCallback(db, providerCode, token, 'callback_auth_token');
  };
}

// ─── Auth Strategy: API Profile Secret ───────────────────────────────

function apiProfileSecretStrategy(providerCode: string, headerName: string, configKey: string): AuthStrategy {
  return async (req, db) => {
    const token = (req.headers[headerName.toLowerCase()] as string) ?? '';

    if (!token) {
      logger.warn(`Missing ${headerName} for ${providerCode}`);
      return null;
    }

    return authenticateApiProfileSecret(db, providerCode, token, configKey);
  };
}

// ─── Shared Authentication ───────────────────────────────────────────

async function authenticateCallback(
  db: IDatabase,
  providerCode: string,
  token: string,
  configKey: string,
): Promise<ProviderAuthResult | null> {
  const account = await db.queryOne<{
    id: string;
    provider_code: string;
    seller_config: Record<string, unknown>;
  }>('provider_accounts', {
    select: 'id, provider_code, seller_config',
    eq: [['provider_code', providerCode], ['supports_seller', true]],
    single: true,
  });

  if (!account) {
    logger.error(`${providerCode} seller provider account not found`);
    return null;
  }

  const sellerConfig = (account.seller_config ?? {}) as Record<string, unknown>;
  const DUMMY = '0'.repeat(64);
  const stored = sellerConfig[configKey] as string | undefined;
  const compareTarget = typeof stored === 'string' && stored.length > 0 ? stored : DUMMY;

  const matches = timingSafeEqual(token, compareTarget);
  if (!stored || !matches) {
    logger.warn(`Invalid auth token for ${providerCode}`, { configKey });
    return null;
  }

  return {
    providerAccountId: account.id,
    providerCode: account.provider_code,
    sellerConfig,
  };
}

async function authenticateApiProfileSecret(
  db: IDatabase,
  providerCode: string,
  token: string,
  configKey: string,
): Promise<ProviderAuthResult | null> {
  const account = await db.queryOne<{
    id: string;
    provider_code: string;
    api_profile: Record<string, unknown>;
    seller_config: Record<string, unknown>;
  }>('provider_accounts', {
    select: 'id, provider_code, api_profile, seller_config',
    eq: [['provider_code', providerCode]],
    single: true,
  });

  if (!account) {
    logger.error(`${providerCode} provider account not found`);
    return null;
  }

  const apiProfile = (account.api_profile ?? {}) as Record<string, unknown>;
  const DUMMY = '0'.repeat(64);
  const stored = apiProfile[configKey] as string | undefined;
  const compareTarget = typeof stored === 'string' && stored.length > 0 ? stored : DUMMY;

  const matches = timingSafeEqual(token, compareTarget);
  if (!stored || !matches) {
    logger.warn(`Invalid ${configKey} for ${providerCode}`, { configKey });
    return null;
  }

  return {
    providerAccountId: account.id,
    providerCode: account.provider_code,
    sellerConfig: (account.seller_config ?? {}) as Record<string, unknown>,
    apiProfile,
  };
}

// ─── Provider → Strategy Map ─────────────────────────────────────────

const PROVIDER_AUTH_STRATEGIES: Record<string, AuthStrategy> = {
  eneba: bearerTokenStrategy('eneba'),
  g2a: bearerTokenStrategy('g2a', 'g2a_callback_auth_token'),
  kinguin: customHeaderStrategy('kinguin', 'x-auth-token'),
  'kinguin-buyer': apiProfileSecretStrategy('kinguin', 'x-event-secret', 'buyer_webhook_secret'),
  gamivo: bearerTokenStrategy('gamivo'),
  digiseller: secretParamStrategy('digiseller'),
};

// ─── Fastify Middleware Factory ──────────────────────────────────────

export function createMarketplaceAuthMiddleware(providerKey: string) {
  const strategy = PROVIDER_AUTH_STRATEGIES[providerKey];

  if (!strategy) {
    throw new Error(`No auth strategy registered for provider: ${providerKey}`);
  }

  return async function marketplaceAuth(req: FastifyRequest, reply: FastifyReply) {
    const db = container.resolve<IDatabase>(TOKENS.Database);
    const result = await strategy(req, db);

    if (!result) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    (req as FastifyRequest & { providerAuth: ProviderAuthResult }).providerAuth = result;
  };
}
