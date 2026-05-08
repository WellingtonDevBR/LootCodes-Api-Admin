import type { IDatabase } from '../../core/ports/database.port.js';
import { resolveProviderSecrets } from '../marketplace/resolve-provider-secrets.js';
import { AppRoutePublicApi } from '../marketplace/approute/app-route-public-api.js';
import { createAppRouteMarketplaceHttpClient } from '../marketplace/approute/create-app-route-http-client.js';
import { flattenAppRouteServicesToCatalogRows } from '../marketplace/approute/catalog-mapper.js';
import { resolveAppRouteBaseUrlFromApiProfile } from '../marketplace/approute/resolve-app-route-base-url.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('approute-catalog-sync');

export type SyncAppRouteCatalogResult =
  | { readonly success: true; readonly upserted: number }
  | { readonly success: false; readonly error: string };

/** Pulls `GET /services` once and upserts flattened denominations into `provider_product_catalog`. */
export async function syncAppRouteProductCatalog(
  db: IDatabase,
  providerAccountId: string,
): Promise<SyncAppRouteCatalogResult> {
  const row = await db.queryOne<{
    readonly provider_code: string;
    readonly api_profile: unknown;
  }>('provider_accounts', {
    select: 'provider_code, api_profile',
    filter: { id: providerAccountId },
  });

  if (!row) {
    return { success: false, error: 'Provider account not found' };
  }

  const code = row.provider_code.trim().toLowerCase();
  if (code !== 'approute') {
    return { success: false, error: `Expected provider_code approute, got ${row.provider_code}` };
  }

  const secrets = await resolveProviderSecrets(db, providerAccountId);
  const resolvedKey = (secrets['APPROUTE_API_KEY'] ?? '').trim();
  const resolvedBase = (resolveAppRouteBaseUrlFromApiProfile(row.api_profile) ?? '').trim();

  const missingKey = resolvedKey.length === 0;
  const missingBase = resolvedBase.length === 0;
  if (missingKey || missingBase) {
    const parts: string[] = [];
    if (missingKey) {
      parts.push(
        'APPROUTE_API_KEY is not resolving - set env APPROUTE_API_KEY or link provider_secrets_ref.vault_secret_id to vault.secrets (same pattern as Bamboo)',
      );
    }
    if (missingBase) {
      parts.push(
        'api_profile.base_url is missing or blank - set the HTTP origin including path prefix (e.g. https://api.vendor.example/api/v1)',
      );
    }
    return {
      success: false,
      error: parts.join(' '),
    };
  }

  const http = createAppRouteMarketplaceHttpClient({
    baseUrl: resolvedBase,
    apiKey: resolvedKey,
    rateLimiter: { maxRequests: 2, windowMs: 60_000 },
  });

  let servicesData;
  try {
    servicesData = await new AppRoutePublicApi(http).getServices();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('AppRoute catalog sync — GET services failed', { providerAccountId, error: msg });
    return { success: false, error: msg };
  }

  const rows = flattenAppRouteServicesToCatalogRows(
    servicesData,
    'approute',
    providerAccountId,
    new Date().toISOString(),
  );

  try {
    await db.upsertMany('provider_product_catalog', rows, 'provider_account_id,external_product_id');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('AppRoute catalog sync — upsert failed', err as Error, { providerAccountId });
    return { success: false, error: msg };
  }

  logger.info('AppRoute catalog sync completed', { providerAccountId, upserted: rows.length });
  return { success: true, upserted: rows.length };
}
