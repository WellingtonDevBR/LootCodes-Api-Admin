/**
 * Lazy marketplace adapter bootstrap.
 *
 * Loads all `provider_accounts` where `is_enabled = true` (seller and
 * procurement-only providers), resolves secrets via `provider_secrets_ref`
 * + Vault, merges `api_profile`, and registers adapters in the
 * MarketplaceAdapterRegistry.
 *
 * Called once on first request via a Fastify onRequest hook.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../../core/ports/marketplace-adapter.port.js';
import { MarketplaceHttpClient, OAuth2TokenManager } from './_shared/marketplace-http.js';
import { EnebaGraphQLClient } from './eneba/graphql-client.js';
import { EnebaAdapter } from './eneba/adapter.js';
import { G2AAdapter } from './g2a/adapter.js';
import { GamivoMarketplaceAdapter } from './gamivo/adapter.js';
import { KinguinMarketplaceAdapter } from './kinguin/adapter.js';
import { DigisellerMarketplaceAdapter } from './digiseller/adapter.js';
import { DigisellerTokenManager, type DigisellerCachedToken } from './digiseller/token-manager.js';
import { BambooMarketplaceAdapter } from './bamboo/adapter.js';
import { resolveAppRouteBaseUrlFromApiProfile } from './approute/resolve-app-route-base-url.js';
import type { AnyMarketplaceAdapter } from './marketplace-adapter-registry.js';
import { resolveProviderSecrets } from './resolve-provider-secrets.js';
import { kinguinBuyerApiKeyFromSecrets } from './kinguin-buyer-api-key.js';
import { createLogger } from '../../shared/logger.js';
import { getEnv } from '../../config/env.js';

const logger = createLogger('marketplace-bootstrap');

interface ProviderAccountRow {
  id: string;
  provider_code: string;
  api_profile: Record<string, unknown> | null;
  seller_config: Record<string, unknown> | null;
  cached_token: DigisellerCachedToken | null;
}

const ENEBA_BASE_URL = 'https://api.eneba.com';
const ENEBA_TOKEN_URL_FALLBACK = 'https://user.eneba.com/oauth/token';

/** Match typical EC2 reverse-proxy hostnames stored in `api_profile` (OAuth often fails with Invalid signature). */
const ENEBA_RELAY_HOST = /^ec2-\d+-\d+-\d+-\d+\.compute-[a-z0-9-]+\.amazonaws\.com$/i;

let initialized = false;

function asProfile(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function profileStr(profile: Record<string, unknown>, key: string): string | undefined {
  const v = profile[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function shouldReplaceEnebaProfileUrlWithPublic(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol === 'http:' && u.hostname.includes('amazonaws.com')) return true;
    return ENEBA_RELAY_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export async function bootstrapMarketplaceAdapters(
  db: IDatabase,
  registry: IMarketplaceAdapterRegistry,
): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const accounts = await db.query<ProviderAccountRow>('provider_accounts', {
      select: 'id, provider_code, api_profile, seller_config, cached_token',
      filter: { is_enabled: true },
    });

    if (accounts.length === 0) {
      logger.info('No enabled provider accounts found — skipping adapter registration');
      return;
    }

    logger.info('Marketplace bootstrap: enabled provider_accounts loaded', {
      count: accounts.length,
      providerCodes: [...new Set(accounts.map((a) => a.provider_code))].sort(),
    });

    for (const account of accounts) {
      try {
        const secrets = await resolveProviderSecrets(db, account.id);
        const profile = asProfile(account.api_profile);
        const adapter = await buildAdapter(db, account, secrets, profile);
        if (adapter) {
          registry.registerAdapter(account.provider_code, adapter);
        }
      } catch (err) {
        logger.error(`Failed to build adapter for ${account.provider_code}`, err as Error, {
          accountId: account.id,
        });
      }
    }

    const registered = registry.getSupportedProviders();
    logger.info('Marketplace adapters bootstrapped', {
      registered,
      registeredCount: registered.length,
      attemptedAccounts: accounts.length,
    });
  } catch (err) {
    logger.error('Failed to bootstrap marketplace adapters', err as Error);
  }
}

async function buildAdapter(
  db: IDatabase,
  account: ProviderAccountRow,
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): Promise<unknown | null> {
  switch (account.provider_code) {
    case 'eneba':
      return buildEnebaAdapter(secrets, profile);
    case 'g2a':
      return buildG2AAdapter(secrets, profile);
    case 'gamivo':
      return buildGamivoAdapter(secrets, profile);
    case 'kinguin':
      return buildKinguinAdapter(secrets, profile);
    case 'digiseller':
      return buildDigisellerAdapter(db, account.id, secrets, profile, account.seller_config, account.cached_token);
    case 'bamboo':
      return buildBambooAdapter(secrets, profile);
    case 'approute':
      return buildApprouteCatalogOnlyMarker(secrets, profile);
    case 'wgcards':
      return buildWgcardsCatalogOnlyMarker(secrets);
    default:
      logger.warn(`Unknown provider code — no adapter factory`, { providerCode: account.provider_code });
      return null;
  }
}

function buildEnebaAdapter(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): EnebaAdapter | null {
  const authId = secrets['ENEBA_AUTH_ID'];
  const authSecret = secrets['ENEBA_AUTH_SECRET'];
  const clientId = profileStr(profile, 'client_id');
  let baseUrl = profileStr(profile, 'base_url') ?? ENEBA_BASE_URL;
  let tokenEndpoint = profileStr(profile, 'token_endpoint') ?? ENEBA_TOKEN_URL_FALLBACK;

  let baseFromEnv = false;
  let tokenFromEnv = false;
  try {
    const env = getEnv();
    const overrideBase = env.ENEBA_GRAPHQL_BASE_URL;
    const overrideToken = env.ENEBA_OAUTH_TOKEN_URL;
    if (overrideBase) {
      baseUrl = overrideBase;
      baseFromEnv = true;
    }
    if (overrideToken) {
      tokenEndpoint = overrideToken;
      tokenFromEnv = true;
    }
    if (overrideBase || overrideToken) {
      logger.info('Eneba API URLs overridden from environment', {
        baseFromEnv: !!overrideBase,
        tokenFromEnv: !!overrideToken,
      });
    }
  } catch {
    // Should not happen after server startup (loadEnv before bootstrap).
  }

  if (!baseFromEnv && shouldReplaceEnebaProfileUrlWithPublic(baseUrl)) {
    // Profile drift is auto-corrected to the official Eneba host. Bootstrap-time
    // info — not actionable at runtime — keep out of Sentry.
    logger.info('Eneba api_profile base_url looks like an HTTP/AWS relay; using official GraphQL host', {
      previousBaseUrl: baseUrl,
    });
    baseUrl = ENEBA_BASE_URL;
  }
  if (!tokenFromEnv && shouldReplaceEnebaProfileUrlWithPublic(tokenEndpoint)) {
    logger.info('Eneba api_profile token_endpoint looks like an HTTP/AWS relay; using official OAuth URL', {
      previousTokenUrl: tokenEndpoint,
    });
    tokenEndpoint = ENEBA_TOKEN_URL_FALLBACK;
  }

  if (!authId || !authSecret || !clientId) {
    logger.warn('Eneba seller adapter skipped — need ENEBA_AUTH_ID, ENEBA_AUTH_SECRET, api_profile.client_id', {
      hasAuthId: !!authId,
      hasAuthSecret: !!authSecret,
      hasClientId: !!clientId,
    });
    return null;
  }

  const tokenManager = new OAuth2TokenManager({
    tokenUrl: tokenEndpoint,
    clientId,
    clientSecret: '',
    grantType: 'api_consumer',
    extraParams: { id: authId, secret: authSecret },
  });

  const httpClient = new MarketplaceHttpClient({
    baseUrl: baseUrl.replace(/\/$/, ''),
    providerCode: 'eneba',
    headers: async () => {
      const token = await tokenManager.getAccessToken();
      return { Authorization: `Bearer ${token}` };
    },
  });

  const gqlClient = new EnebaGraphQLClient(httpClient, tokenManager, {
    baseUrl: baseUrl.replace(/\/$/, ''),
  });

  return new EnebaAdapter(gqlClient, { baseUrl: baseUrl.replace(/\/$/, ''), clientId });
}

function buildG2AAdapter(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): G2AAdapter | null {
  const clientId = secrets['G2A_CLIENT_ID'];
  const clientSecret = secrets['G2A_CLIENT_SECRET'];
  const baseUrlRaw = profileStr(profile, 'base_url') ?? 'https://api.g2a.com';

  if (!clientId || !clientSecret) {
    logger.warn('G2A seller adapter skipped — need G2A_CLIENT_ID and G2A_CLIENT_SECRET');
    return null;
  }

  const baseUrl = baseUrlRaw.replace(/\/$/, '');
  const tokenEndpoint = profileStr(profile, 'token_endpoint') ?? `${baseUrl}/oauth/token`;

  const tokenManager = new OAuth2TokenManager({
    tokenUrl: tokenEndpoint,
    clientId,
    clientSecret,
    grantType: 'client_credentials',
  });

  const httpClient = new MarketplaceHttpClient({
    baseUrl,
    providerCode: 'g2a',
    headers: async () => ({
      Authorization: `Bearer ${await tokenManager.getAccessToken()}`,
    }),
  });

  return new G2AAdapter(httpClient);
}

function buildGamivoAdapter(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): GamivoMarketplaceAdapter | null {
  const apiToken = secrets['GAMIVO_API_TOKEN'];
  const baseUrl = profileStr(profile, 'base_url') ?? 'https://api.gamivo.com';

  if (!apiToken) {
    logger.warn('Gamivo seller adapter skipped — need GAMIVO_API_TOKEN');
    return null;
  }

  const httpClient = new MarketplaceHttpClient({
    baseUrl: baseUrl.replace(/\/$/, ''),
    providerCode: 'gamivo',
    headers: async () => ({
      Authorization: `Bearer ${apiToken}`,
    }),
  });

  return new GamivoMarketplaceAdapter(httpClient);
}

function buildKinguinAdapter(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): KinguinMarketplaceAdapter | null {
  const clientId = secrets['KINGUIN_CLIENT_ID'];
  const clientSecret = secrets['KINGUIN_CLIENT_SECRET'];
  const tokenEndpoint = profileStr(profile, 'token_endpoint');
  const sellerBaseUrl = profileStr(profile, 'seller_base_url');
  const webhookBaseUrl = profileStr(profile, 'webhook_base_url');

  if (!clientId || !clientSecret || !tokenEndpoint || !sellerBaseUrl) {
    logger.warn(
      'Kinguin seller adapter skipped — need KINGUIN_CLIENT_ID, KINGUIN_CLIENT_SECRET, api_profile.token_endpoint, seller_base_url',
      {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
        hasTokenEndpoint: !!tokenEndpoint,
        hasSellerBase: !!sellerBaseUrl,
      },
    );
    return null;
  }

  const tokenManager = new OAuth2TokenManager({
    tokenUrl: tokenEndpoint,
    clientId,
    clientSecret,
    grantType: 'client_credentials',
  });

  const headers = async (): Promise<Record<string, string>> => ({
    Authorization: `Bearer ${await tokenManager.getAccessToken()}`,
  });

  const sellerRoot = sellerBaseUrl.replace(/\/$/, '');
  const httpClient = new MarketplaceHttpClient({
    baseUrl: sellerRoot,
    providerCode: 'kinguin',
    headers,
  });

  let webhookClient: MarketplaceHttpClient | undefined;
  if (webhookBaseUrl) {
    const wRoot = webhookBaseUrl.replace(/\/$/, '');
    if (wRoot !== sellerRoot) {
      webhookClient = new MarketplaceHttpClient({
        baseUrl: wRoot,
        providerCode: 'kinguin',
        headers,
      });
    }
  }

  let buyerClient: MarketplaceHttpClient | undefined;
  const buyerApiKey = kinguinBuyerApiKeyFromSecrets(secrets);
  const buyerBaseUrl = profileStr(profile, 'buyer_base_url');
  if (buyerApiKey && buyerBaseUrl) {
    buyerClient = new MarketplaceHttpClient({
      baseUrl: buyerBaseUrl.replace(/\/$/, ''),
      providerCode: 'kinguin',
      headers: async () => ({ 'X-Api-Key': buyerApiKey }),
    });
  }

  return new KinguinMarketplaceAdapter(httpClient, webhookClient, buyerClient);
}

async function buildDigisellerAdapter(
  db: IDatabase,
  accountId: string,
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
  sellerConfig: Record<string, unknown> | null,
  cachedToken: DigisellerCachedToken | null,
): Promise<DigisellerMarketplaceAdapter | null> {
  const apiKey = secrets['DIGISELLER_API_KEY'];
  const sellerIdRaw = secrets['DIGISELLER_SELLER_ID'];
  const baseUrl = (profileStr(profile, 'base_url') ?? 'https://api.digiseller.com').replace(/\/$/, '');
  const apiLoginUrl = `${baseUrl}/api/apilogin`;

  if (!apiKey || !sellerIdRaw) {
    logger.warn('Digiseller seller adapter skipped — need DIGISELLER_API_KEY and DIGISELLER_SELLER_ID');
    return null;
  }

  const sellerNumericId = Number.parseInt(sellerIdRaw.trim(), 10);
  if (!Number.isFinite(sellerNumericId)) {
    logger.warn('Digiseller seller adapter skipped — DIGISELLER_SELLER_ID is not a valid integer', {
      raw: sellerIdRaw,
    });
    return null;
  }

  const cfg = sellerConfig != null && typeof sellerConfig === 'object' && !Array.isArray(sellerConfig)
    ? sellerConfig
    : {};

  const tokenManager = new DigisellerTokenManager({
    apiKey,
    sellerId: sellerNumericId,
    apiLoginUrl,
    initialCache: cachedToken,
    onTokenRefreshed: (entry) => {
      db.update('provider_accounts', { id: accountId }, { cached_token: entry }).catch((err: unknown) => {
        logger.warn('Digiseller: failed to persist refreshed token to DB', {
          accountId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    },
  });

  const httpClient = new MarketplaceHttpClient({
    baseUrl,
    providerCode: 'digiseller',
    headers: async () => ({ Accept: 'application/json' }),
    queryParams: async () => ({
      token: await tokenManager.getToken(),
    }),
  });

  const callbackUrl = (cfg['callback_url'] as string | undefined) ?? '';
  const callbackAuthToken = (cfg['callback_auth_token'] as string | undefined) ?? '';

  return new DigisellerMarketplaceAdapter(httpClient, {
    defaultCurrency: (cfg['default_currency'] as string) ?? 'EUR',
    commissionRatePercent: typeof cfg['commission_rate_percent'] === 'number'
      ? cfg['commission_rate_percent'] : undefined,
    sellerNumericId,
    listingOpts: {
      callbackUrl,
      callbackAuthToken,
      contentType: (cfg['content_type'] as string | undefined) === 'Form' ? 'Form' : 'Text',
      guaranteeHours: typeof cfg['guarantee_hours'] === 'number' ? cfg['guarantee_hours'] : 24,
      platiCategoryId: typeof cfg['plati_category_id'] === 'number' ? cfg['plati_category_id'] : null,
      locale: (cfg['locale'] as string | undefined) ?? 'en-US',
    },
  });
}


/**
 * Registers AppRoute in the adapter registry without marketplace HTTP capabilities — CRM live-search
 * merges catalog hits from `provider_product_catalog` only (`product_search` stays unavailable).
 */
function buildApprouteCatalogOnlyMarker(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): AnyMarketplaceAdapter | null {
  const apiKey = secrets['APPROUTE_API_KEY'];
  const baseUrl = resolveAppRouteBaseUrlFromApiProfile(profile);
  if (!apiKey?.trim() || !baseUrl?.trim()) {
    logger.warn('AppRoute catalog-only registration skipped — need APPROUTE_API_KEY and api_profile.base_url');
    return null;
  }
  return {};
}

function buildBambooAdapter(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): BambooMarketplaceAdapter | null {
  const clientId = secrets['BAMBOO_CLIENT_ID'];
  const clientSecret = secrets['BAMBOO_CLIENT_SECRET'];
  const baseUrlV2 = profileStr(profile, 'base_url_v2') ?? profileStr(profile, 'base_url') ?? 'https://api.bamboocardportal.com/api/integration/v2.0';
  const baseUrlV1 = profileStr(profile, 'base_url') ?? 'https://api.bamboocardportal.com/api/integration/v1.0';

  if (!clientId || !clientSecret) {
    logger.warn('Bamboo adapter skipped — need BAMBOO_CLIENT_ID and BAMBOO_CLIENT_SECRET');
    return null;
  }

  const basicAuth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const catalogClient = new MarketplaceHttpClient({
    baseUrl: baseUrlV2.replace(/\/$/, ''),
    providerCode: 'bamboo',
    rateLimiter: { maxRequests: 50, windowMs: 60_000 },
    headers: async () => ({ Authorization: basicAuth }),
  });

  const ordersClient = new MarketplaceHttpClient({
    baseUrl: baseUrlV1.replace(/\/$/, ''),
    providerCode: 'bamboo',
    rateLimiter: { maxRequests: 50, windowMs: 60_000 },
    headers: async () => ({ Authorization: basicAuth }),
  });

  return new BambooMarketplaceAdapter(catalogClient, ordersClient, catalogTargetCurrency(profile));
}

function catalogTargetCurrency(profile: Record<string, unknown>): string {
  const fromProfile =
    profileStr(profile, 'catalog_target_currency')?.trim().toUpperCase() ??
    profileStr(profile, 'checkout_wallet_currency')?.trim().toUpperCase();
  return /^[A-Za-z]{3}$/.test(fromProfile ?? '') ? fromProfile! : 'USD';
}

/**
 * WGCards does not expose a product-search or catalog-listing API — `getStock` requires
 * known SKU IDs, so live search is not possible. Registering a no-capability marker lets
 * the live-search panel show WGCards in the provider list and return any hits from the
 * locally ingested `provider_product_catalog` table.
 */
function buildWgcardsCatalogOnlyMarker(
  secrets: Record<string, string>,
): AnyMarketplaceAdapter | null {
  const appId = secrets['WGCARDS_APP_ID'];
  const appKey = secrets['WGCARDS_APP_KEY'];
  if (!appId?.trim() || !appKey?.trim()) {
    logger.warn('WGCards catalog-only registration skipped — need WGCARDS_APP_ID and WGCARDS_APP_KEY');
    return null;
  }
  return {};
}
