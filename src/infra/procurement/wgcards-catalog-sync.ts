/**
 * WGCards catalog sync — pulls `/api/getAllItem` (2/hour limit) and upserts
 * every SKU into `provider_product_catalog`.
 *
 * Prices and stock are NOT included in `getAllItem`; they default to 0/false
 * and are enriched automatically by subsequent live-search upserts.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import { resolveProviderSecrets } from '../marketplace/resolve-provider-secrets.js';
import { createWgcardsHttpClient } from './wgcards/wgcards-manual-buyer.js';
import { flattenWgcardsItemsToCatalogRows } from '../marketplace/wgcards/wgcards-catalog-mapper.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('wgcards-catalog-sync');

export type SyncWgcardsCatalogResult =
  | { readonly success: true; readonly upserted: number }
  | { readonly success: false; readonly error: string };

/** Pulls the full WGCards catalog and upserts all SKUs into `provider_product_catalog`. */
export async function syncWgcardsProductCatalog(
  db: IDatabase,
  providerAccountId: string,
): Promise<SyncWgcardsCatalogResult> {
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

  if (row.provider_code.trim().toLowerCase() !== 'wgcards') {
    return { success: false, error: `Expected provider_code wgcards, got ${row.provider_code}` };
  }

  const secrets = await resolveProviderSecrets(db, providerAccountId);
  const profile = (row.api_profile && typeof row.api_profile === 'object' && !Array.isArray(row.api_profile))
    ? row.api_profile as Record<string, unknown>
    : {};

  const bundle = createWgcardsHttpClient({ secrets, profile });
  if (!bundle) {
    return {
      success: false,
      error: 'WGCards credentials missing — ensure WGCARDS_APP_ID, WGCARDS_APP_KEY, WGCARDS_ACCOUNT_ID are set in provider_secrets_ref',
    };
  }

  let items;
  try {
    items = await bundle.client.getAllItem({ appId: bundle.appId, language: 'en' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('WGCards catalog sync — getAllItem failed', { providerAccountId, error: msg });
    return { success: false, error: msg };
  }

  if (!items || items.length === 0) {
    logger.info('WGCards catalog sync — API returned empty catalog', { providerAccountId });
    return { success: true, upserted: 0 };
  }

  const rows = flattenWgcardsItemsToCatalogRows(
    items,
    'wgcards',
    providerAccountId,
    new Date().toISOString(),
  );

  try {
    await db.upsertMany('provider_product_catalog', rows, 'provider_account_id,external_product_id');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('WGCards catalog sync — upsert failed', err as Error, { providerAccountId });
    return { success: false, error: msg };
  }

  logger.info('WGCards catalog sync completed', {
    providerAccountId,
    itemCount: items.length,
    upserted: rows.length,
  });
  return { success: true, upserted: rows.length };
}
