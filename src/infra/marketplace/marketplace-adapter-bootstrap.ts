/**
 * Lazy marketplace adapter bootstrap.
 *
 * Loads `provider_accounts` where `supports_seller = true`, resolves secrets
 * via `provider_secrets_ref` + Vault (same pattern as Edge `provider-procurement`),
 * merges `api_profile`, and registers adapters in the MarketplaceAdapterRegistry.
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
import { resolveProviderSecrets } from './resolve-provider-secrets.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('marketplace-bootstrap');

interface ProviderAccountRow {
  id: string;
  provider_code: string;
  api_profile: Record<string, unknown> | null;
  seller_config: Record<string, unknown> | null;
}

const ENEBA_BASE_URL = 'https://api.eneba.com';
const ENEBA_TOKEN_URL_FALLBACK = 'https://user.eneba.com/oauth/token';

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

export async function bootstrapMarketplaceAdapters(
  db: IDatabase,
  registry: IMarketplaceAdapterRegistry,
): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    const accounts = await db.query<ProviderAccountRow>('provider_accounts', {
      select: 'id, provider_code, api_profile, seller_config',
      eq: [['is_enabled', true]],
    });

    if (accounts.length === 0) {
      logger.info('No enabled provider accounts found — skipping adapter registration');
      return;
    }

    for (const account of accounts) {
      try {
        const secrets = await resolveProviderSecrets(db, account.id);
        const profile = asProfile(account.api_profile);
        const adapter = buildAdapter(account, secrets, profile);
        if (adapter) {
          registry.registerAdapter(account.provider_code, adapter);
        }
      } catch (err) {
        logger.error(`Failed to build adapter for ${account.provider_code}`, err as Error, {
          accountId: account.id,
        });
      }
    }

    logger.info('Marketplace adapters bootstrapped', {
      registered: registry.getSupportedProviders(),
    });
  } catch (err) {
    logger.error('Failed to bootstrap marketplace adapters', err as Error);
  }
}

function buildAdapter(
  account: ProviderAccountRow,
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
): unknown | null {
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
      return buildDigisellerAdapter(secrets, profile, account.seller_config);
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
  const baseUrl = profileStr(profile, 'base_url') ?? ENEBA_BASE_URL;
  const tokenEndpoint = profileStr(profile, 'token_endpoint') ?? ENEBA_TOKEN_URL_FALLBACK;

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
  const buyerApiKey = secrets['KINGUIN_BUYER_API_KEY'];
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

function buildDigisellerAdapter(
  secrets: Record<string, string>,
  profile: Record<string, unknown>,
  sellerConfig: Record<string, unknown> | null,
): DigisellerMarketplaceAdapter | null {
  const apiKey = secrets['DIGISELLER_API_KEY'];
  const sellerId = secrets['DIGISELLER_SELLER_ID'];
  const baseUrl = profileStr(profile, 'base_url') ?? 'https://api.digiseller.ru/api';

  if (!apiKey || !sellerId) {
    logger.warn('Digiseller seller adapter skipped — need DIGISELLER_API_KEY and DIGISELLER_SELLER_ID');
    return null;
  }

  const httpClient = new MarketplaceHttpClient({
    baseUrl: baseUrl.replace(/\/$/, ''),
    providerCode: 'digiseller',
    headers: async () => ({
      Authorization: `Bearer ${apiKey}`,
      'X-Seller-Id': sellerId,
    }),
  });

  const cfg = sellerConfig != null && typeof sellerConfig === 'object' && !Array.isArray(sellerConfig)
    ? sellerConfig
    : {};

  return new DigisellerMarketplaceAdapter(httpClient, {
    defaultCurrency: (cfg['default_currency'] as string) ?? 'USD',
  });
}
