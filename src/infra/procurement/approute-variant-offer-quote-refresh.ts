/**
 * Live AppRoute catalog snapshot refresh for linked `provider_variant_offers` rows.
 * Uses GET /services/{parentServiceId} and matches denominations by `external_offer_id`.
 */
import type { IDatabase } from '../../core/ports/database.port.js';
import { createLogger } from '../../shared/logger.js';
import { resolveProviderSecrets } from '../marketplace/resolve-provider-secrets.js';
import { AppRoutePublicApi } from '../marketplace/approute/app-route-public-api.js';
import { appRouteDenominationToQuoteSnapshot } from '../marketplace/approute/catalog-mapper.js';
import { createAppRouteMarketplaceHttpClient } from '../marketplace/approute/create-app-route-http-client.js';
import { resolveAppRouteBaseUrlFromApiProfile } from '../marketplace/approute/resolve-app-route-base-url.js';
import type { AppRouteServiceNode } from '../marketplace/approute/types.js';
import type { ProviderAccountRowLite } from './bamboo-variant-offer-quote-refresh.js';

const logger = createLogger('approute-offer-quote-refresh');

export interface AppRouteOfferSnapshotRow {
  readonly id: string;
  readonly provider_account_id: string;
  external_offer_id: string | null;
  external_parent_product_id: string | null;
  currency: string | null;
  last_price_cents: number | null;
  available_quantity: number | null;
}

function asProfile(raw: unknown): Record<string, unknown> {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

async function loadParentIdsFromCatalog(
  db: IDatabase,
  missing: readonly { readonly provider_account_id: string; readonly external_offer_id: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const m of missing) {
    const dedupeKey = `${m.provider_account_id}\t${m.external_offer_id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rows = await db.query<{ external_parent_product_id: string | null; slug: string | null }>(
      'provider_product_catalog',
      {
        filter: {
          provider_account_id: m.provider_account_id,
          external_product_id: m.external_offer_id,
        },
        limit: 1,
      },
    );
    const row = rows[0];
    const parent = row?.external_parent_product_id?.trim() || row?.slug?.trim();
    if (parent) out.set(dedupeKey, parent);
  }
  return out;
}

/**
 * Calls AppRoute GET /services/{id} for each distinct parent service and persists quote fields.
 * Mutates `offers` in place on success.
 */
export async function refreshAppRouteOfferSnapshotsForVariant(
  db: IDatabase,
  offers: AppRouteOfferSnapshotRow[],
  accountsById: ReadonlyMap<string, ProviderAccountRowLite>,
  options?: { readonly providerCodeFilter?: string | undefined },
): Promise<void> {
  const filter = options?.providerCodeFilter?.trim().toLowerCase();
  if (filter && filter !== 'approute') {
    return;
  }

  const approuteOffers = offers.filter((o) => {
    const acc = accountsById.get(o.provider_account_id);
    return (acc?.provider_code ?? '').trim().toLowerCase() === 'approute';
  });

  if (approuteOffers.length === 0) return;

  const needCatalogParent = approuteOffers
    .map((o) => {
      const ext = o.external_offer_id?.trim();
      if (!ext) return null;
      if (o.external_parent_product_id?.trim()) return null;
      return { provider_account_id: o.provider_account_id, external_offer_id: ext };
    })
    .filter((x): x is { provider_account_id: string; external_offer_id: string } => x != null);

  const parentFromCatalog =
    needCatalogParent.length > 0 ? await loadParentIdsFromCatalog(db, needCatalogParent) : new Map<string, string>();

  const secretsByAccount = new Map<string, Record<string, string>>();
  const apiByAccount = new Map<string, AppRoutePublicApi>();
  const serviceCacheByAccount = new Map<string, Map<string, AppRouteServiceNode>>();

  async function apiForAccount(accountId: string): Promise<AppRoutePublicApi | null> {
    const cached = apiByAccount.get(accountId);
    if (cached) return cached;

    const acc = accountsById.get(accountId);
    const code = (acc?.provider_code ?? '').trim().toLowerCase();
    if (code !== 'approute') return null;

    let secrets = secretsByAccount.get(accountId);
    if (!secrets) {
      secrets = await resolveProviderSecrets(db, accountId);
      secretsByAccount.set(accountId, secrets);
    }
    const apiKey = (secrets['APPROUTE_API_KEY'] ?? '').trim();
    const baseUrl = (resolveAppRouteBaseUrlFromApiProfile(asProfile(acc?.api_profile)) ?? '').trim();
    if (!apiKey || !baseUrl) {
      logger.warn('AppRoute live quote refresh skipped — missing APPROUTE_API_KEY or api_profile.base_url', {
        providerAccountId: accountId,
      });
      return null;
    }

    const http = createAppRouteMarketplaceHttpClient({
      baseUrl,
      apiKey,
      rateLimiter: { maxRequests: 60, windowMs: 60_000 },
    });
    const api = new AppRoutePublicApi(http);
    apiByAccount.set(accountId, api);
    return api;
  }

  async function getServiceCached(accountId: string, parentId: string): Promise<AppRouteServiceNode | null> {
    let perAccount = serviceCacheByAccount.get(accountId);
    if (!perAccount) {
      perAccount = new Map();
      serviceCacheByAccount.set(accountId, perAccount);
    }
    const hit = perAccount.get(parentId);
    if (hit) return hit;

    const api = await apiForAccount(accountId);
    if (!api) return null;

    try {
      const svc = await api.getService(parentId);
      perAccount.set(parentId, svc);
      return svc;
    } catch (err) {
      logger.warn('AppRoute GET services/{id} failed for offer snapshot', {
        providerAccountId: accountId,
        parentServiceId: parentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  for (const offer of approuteOffers) {
    const extId = offer.external_offer_id?.trim();
    if (!extId) continue;

    let parentId = offer.external_parent_product_id?.trim();
    if (!parentId) {
      parentId = parentFromCatalog.get(`${offer.provider_account_id}\t${extId}`);
    }
    if (!parentId) {
      logger.warn('AppRoute offer snapshot skipped — no parent service id (link from catalog or set external_parent_product_id)', {
        offerRowId: offer.id,
        external_offer_id: extId,
      });
      continue;
    }

    const svc = await getServiceCached(offer.provider_account_id, parentId);
    if (!svc) continue;

    const denom = (svc.items ?? []).find((d) => String(d.id) === extId);
    if (!denom) {
      logger.warn('AppRoute service payload missing denomination for linked offer', {
        offerRowId: offer.id,
        parentServiceId: parentId,
        external_offer_id: extId,
      });
      continue;
    }

    const snap = appRouteDenominationToQuoteSnapshot(denom);
    const now = new Date().toISOString();

    try {
      await db.update(
        'provider_variant_offers',
        { id: offer.id },
        {
          last_price_cents: snap.price_cents,
          available_quantity: snap.available_quantity,
          currency: snap.currency,
          last_checked_at: now,
          updated_at: now,
          ...(offer.external_parent_product_id?.trim() ? {} : { external_parent_product_id: parentId }),
        },
      );

      offer.last_price_cents = snap.price_cents;
      offer.available_quantity = snap.available_quantity;
      offer.currency = snap.currency;
      if (!offer.external_parent_product_id?.trim()) {
        offer.external_parent_product_id = parentId;
      }
    } catch (err) {
      logger.warn('AppRoute live quote refresh failed to persist', {
        offerRowId: offer.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
