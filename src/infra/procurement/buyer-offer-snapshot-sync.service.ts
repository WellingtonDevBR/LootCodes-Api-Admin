/**
 * Bulk buyer-offer snapshot sync — replaces the Supabase `provider-catalog-sync` pg_cron.
 *
 * Queries every active `provider_variant_offers` row for buyer-capable providers,
 * fetches a live quote from each provider's API, and persists the fresh
 * `available_quantity`, `last_price_cents`, `currency`, and `last_checked_at`
 * back to the DB.
 *
 * Called:
 *   1. As the `sync-buyer-catalog` phase in `ReconcileSellerListingsUseCase` (before
 *      `declared-stock`), ensuring declared-stock decisions always use current data.
 *   2. From `POST /internal/cron/sync-buyer-catalog` for standalone external scheduling.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type {
  IBuyerOfferSnapshotSyncService,
  BuyerOfferSnapshotSyncResult,
} from '../../core/ports/buyer-offer-snapshot-sync.port.js';
import { resolveProviderSecrets } from '../marketplace/resolve-provider-secrets.js';
import {
  createBambooManualBuyer,
  type BambooOfferQuote,
} from './bamboo-manual-buyer.js';
import { normalizeBambooWalletCurrency } from './bamboo-resolve-checkout-account.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('buyer-offer-snapshot-sync');

interface OfferRow {
  readonly id: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string | null;
  readonly currency: string | null;
}

interface ProviderAccountRow {
  readonly id: string;
  readonly provider_code: string;
  readonly api_profile: Record<string, unknown> | null;
  readonly is_enabled: boolean;
  readonly health_status: string;
}

function asProfile(raw: unknown): Record<string, unknown> {
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

@injectable()
export class BuyerOfferSnapshotSyncService implements IBuyerOfferSnapshotSyncService {
  constructor(
    @inject(TOKENS.Database) private readonly db: IDatabase,
  ) {}

  async syncAll(requestId: string): Promise<BuyerOfferSnapshotSyncResult> {
    const startedAt = Date.now();

    const offerRows = await this.db.queryAll<OfferRow>('provider_variant_offers', {
      select: 'id, provider_account_id, external_offer_id, currency',
      filter: { is_active: true },
    });

    if (!offerRows.length) {
      return { scanned: 0, updated: 0, failed: 0, skipped: 0, durationMs: Date.now() - startedAt };
    }

    const accountIds = [...new Set(offerRows.map((r) => r.provider_account_id))];
    const accountRows = await this.db.queryAll<ProviderAccountRow>('provider_accounts', {
      select: 'id, provider_code, api_profile, is_enabled, health_status',
      in: [['id', accountIds]],
    });

    const accountsById = new Map(accountRows.map((a) => [a.id, a]));

    const bambooOffers = offerRows.filter((o) => {
      const acc = accountsById.get(o.provider_account_id);
      return acc?.provider_code?.toLowerCase() === 'bamboo'
        && acc.is_enabled
        && acc.health_status === 'healthy'
        && o.external_offer_id?.trim();
    });

    logger.info('Buyer offer snapshot sync started', {
      requestId,
      totalOffers: offerRows.length,
      bambooOffers: bambooOffers.length,
    });

    const byAccount = new Map<string, OfferRow[]>();
    for (const offer of bambooOffers) {
      const existing = byAccount.get(offer.provider_account_id) ?? [];
      existing.push(offer);
      byAccount.set(offer.provider_account_id, existing);
    }

    let updated = 0;
    let failed = 0;
    const skipped = offerRows.length - bambooOffers.length;

    for (const [accountId, offers] of byAccount) {
      const acc = accountsById.get(accountId)!;
      let secrets: Record<string, string>;
      try {
        secrets = await resolveProviderSecrets(this.db, accountId);
      } catch (err) {
        logger.warn('Failed to resolve Bamboo secrets — skipping account', {
          requestId,
          accountId,
          error: err instanceof Error ? err.message : String(err),
        });
        failed += offers.length;
        continue;
      }

      const buyer = createBambooManualBuyer({ secrets, profile: asProfile(acc.api_profile) });
      if (!buyer) {
        logger.warn('Bamboo buyer could not be created — missing credentials', {
          requestId,
          accountId,
        });
        failed += offers.length;
        continue;
      }

      for (const offer of offers) {
        const offerId = offer.external_offer_id!.trim();
        try {
          const walletCurrency = normalizeBambooWalletCurrency(offer.currency ?? 'USD');
          const quote: BambooOfferQuote = await buyer.quote(offerId, walletCurrency);
          const now = new Date().toISOString();

          await this.db.update(
            'provider_variant_offers',
            { id: offer.id },
            {
              last_price_cents: quote.price_cents,
              available_quantity: quote.available_quantity,
              currency: quote.currency,
              last_checked_at: now,
              updated_at: now,
            },
          );

          updated++;
        } catch (err) {
          logger.warn('Bamboo live quote failed for offer', {
            requestId,
            offerRowId: offer.id,
            externalOfferId: offerId,
            error: err instanceof Error ? err.message : String(err),
          });
          failed++;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    logger.info('Buyer offer snapshot sync complete', {
      requestId,
      scanned: offerRows.length,
      updated,
      failed,
      skipped,
      durationMs,
    });

    return { scanned: offerRows.length, updated, failed, skipped, durationMs };
  }
}
