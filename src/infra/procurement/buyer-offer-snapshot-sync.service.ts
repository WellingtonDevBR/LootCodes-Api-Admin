/**
 * Bulk buyer-offer snapshot sync — replaces the Supabase `provider-catalog-sync` pg_cron.
 *
 * Queries every active `provider_variant_offers` row for buyer-capable providers,
 * fetches a live quote from each provider's API, and persists the fresh
 * `available_quantity`, `last_price_cents`, `currency`, and `last_checked_at`
 * back to the DB.
 *
 * Supported providers (auto-detected from `provider_accounts.provider_code`):
 *   - bamboo   — individual GET /catalog?ProductId= (Catalog v2, 1 req/s limit) per linked offer
 *   - approute — grouped GET /services/{parentId} per parent service (denomination match)
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
import { createBambooManualBuyer } from './bamboo-manual-buyer.js';
import { normalizeBambooWalletCurrency } from './bamboo-resolve-checkout-account.js';
import {
  refreshAppRouteOfferSnapshotsForVariant,
  type AppRouteOfferSnapshotRow,
} from './approute-variant-offer-quote-refresh.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('buyer-offer-snapshot-sync');

/**
 * Bamboo Catalog v2 enforces 1 request/second.
 * 3 000 ms between consecutive calls gives 3× headroom over the 1 req/s limit,
 * absorbing clock skew, network jitter, and any tail requests from the
 * previous cron run that may still be inside Bamboo's rate-limit window.
 *
 * Why 3 s and not 1 s: Bamboo's published limit is 1 req/s but in practice
 * a "burst" of requests at the window boundary triggers 429s even at 2 s
 * intervals when consecutive fast responses land within the same server-side
 * window. 3 s eliminates all observed 429s in production.
 */
const BAMBOO_INTER_OFFER_DELAY_MS = 3_000;

/**
 * Extra cooldown injected before the NEXT offer whenever Bamboo returns a 429.
 * This is ON TOP of BAMBOO_INTER_OFFER_DELAY_MS so the effective pause after
 * a rate-limit hit is 3 + 7 = 10 s — enough to guarantee Bamboo's window has
 * fully reset before the next attempt.
 */
const BAMBOO_429_EXTRA_COOLDOWN_MS = 7_000;

/**
 * Random startup jitter applied before the very first Bamboo request in each
 * cron run. Prevents the cron's first request from overlapping with the tail
 * requests of the previous run (which are still inside Bamboo's 1 s window).
 */
const BAMBOO_STARTUP_JITTER_MAX_MS = 2_000;

/**
 * Client-side rate-limiter guard: 1 request per 2 800 ms sliding window.
 * Acts as a hard backstop on top of the inter-offer sleep.
 */
const BAMBOO_BULK_RATE_LIMITER = { maxRequests: 1, windowMs: 2_800 } as const;

/**
 * No retries on 429 for bulk sync. Retrying a 429 response sends an EXTRA
 * request when Bamboo's rate-limit window is already saturated — that makes
 * the cascading 429 problem WORSE, not better. The outer per-offer loop
 * handles 429s gracefully via BAMBOO_429_EXTRA_COOLDOWN_MS instead.
 */
const BAMBOO_BULK_RETRY = { maxRetries: 0 } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OfferRow {
  readonly id: string;
  readonly provider_account_id: string;
  readonly external_offer_id: string | null;
  readonly currency: string | null;
  /** Required by AppRoute refresh to resolve the parent service endpoint. */
  external_parent_product_id: string | null;
  /** Mutated in place by AppRoute refresh so we can detect successful updates. */
  last_price_cents: number | null;
  available_quantity: number | null;
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
      select: 'id, provider_account_id, external_offer_id, currency, external_parent_product_id, last_price_cents, available_quantity',
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
      return (
        acc?.provider_code?.toLowerCase() === 'bamboo' &&
        acc.is_enabled &&
        acc.health_status === 'healthy' &&
        Boolean(o.external_offer_id?.trim())
      );
    });

    const approuteOffers = offerRows.filter((o) => {
      const acc = accountsById.get(o.provider_account_id);
      return (
        acc?.provider_code?.toLowerCase() === 'approute' &&
        acc.is_enabled &&
        acc.health_status === 'healthy' &&
        Boolean(o.external_offer_id?.trim())
      );
    });

    const skipped =
      offerRows.length - bambooOffers.length - approuteOffers.length;

    logger.info('Buyer offer snapshot sync started', {
      requestId,
      totalOffers: offerRows.length,
      bambooOffers: bambooOffers.length,
      approuteOffers: approuteOffers.length,
      skippedOffers: skipped,
    });

    let updated = 0;
    let failed = 0;

    // ── Bamboo ────────────────────────────────────────────────────────────────
    // Group by account to create one BambooManualBuyer per credential set.
    const bambooByAccount = new Map<string, OfferRow[]>();
    for (const offer of bambooOffers) {
      const existing = bambooByAccount.get(offer.provider_account_id) ?? [];
      existing.push(offer);
      bambooByAccount.set(offer.provider_account_id, existing);
    }

    for (const [accountId, offers] of bambooByAccount) {
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

      const buyer = createBambooManualBuyer({
        secrets,
        profile: asProfile(acc.api_profile),
        // Catalog v2 allows 1 req/s — enforce it client-side so we never
        // trigger a 429 from rapid sequential calls during bulk sync.
        catalogRateLimiter: BAMBOO_BULK_RATE_LIMITER,
        // No retries on 429: retrying a rate-limited request sends another call
        // into a saturated window and makes cascading 429s worse. The per-offer
        // loop handles recovery via BAMBOO_429_EXTRA_COOLDOWN_MS instead.
        catalogRetry: BAMBOO_BULK_RETRY,
      });
      if (!buyer) {
        logger.warn('Bamboo buyer could not be created — missing credentials', {
          requestId,
          accountId,
        });
        failed += offers.length;
        continue;
      }

      // Startup jitter: delay a random 0–2 s before the first request so
      // this run's first call cannot overlap with the tail of the previous
      // cron run still inside Bamboo's server-side rate-limit window.
      await sleep(Math.floor(Math.random() * BAMBOO_STARTUP_JITTER_MAX_MS));

      let extraCooldownNeeded = false;

      for (let i = 0; i < offers.length; i++) {
        // Base inter-offer delay on every call except the first.
        if (i > 0) await sleep(BAMBOO_INTER_OFFER_DELAY_MS);

        // When the PREVIOUS offer returned 429, add an extra cooldown on top
        // of the base delay so Bamboo's window is guaranteed to have reset.
        if (extraCooldownNeeded) {
          await sleep(BAMBOO_429_EXTRA_COOLDOWN_MS);
          extraCooldownNeeded = false;
        }

        const offer = offers[i]!;
        const offerId = offer.external_offer_id!.trim();
        try {
          const walletCurrency = normalizeBambooWalletCurrency(offer.currency ?? 'USD');
          const quote = await buyer.quote(offerId, walletCurrency);
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
          const errMsg = err instanceof Error ? err.message : String(err);
          const is429 = errMsg.includes('429');

          if (is429) {
            // 429 is an expected rate-limit response — already handled by the
            // extraCooldownNeeded flag below. Log at info so it doesn't create
            // Sentry noise; every genuine failure is still logged at warn.
            logger.info('Bamboo live quote rate-limited (429) — cooldown will apply before next offer', {
              requestId,
              offerRowId: offer.id,
              externalOfferId: offerId,
            });
            extraCooldownNeeded = true;
          } else {
            logger.warn('Bamboo live quote failed for offer', {
              requestId,
              offerRowId: offer.id,
              externalOfferId: offerId,
              error: errMsg,
            });
          }

          failed++;
        }
      }
    }

    // ── AppRoute ───────────────────────────────────────────────────────────────
    // The refresh function groups calls by parent service internally (one GET per
    // service node), so we pass all AppRoute offers at once and let it batch.
    if (approuteOffers.length > 0) {
      // Snapshot last_price_cents before the call to detect which rows were updated.
      const pricesBefore = new Map(approuteOffers.map((o) => [o.id, o.last_price_cents]));

      try {
        await refreshAppRouteOfferSnapshotsForVariant(
          this.db,
          approuteOffers as AppRouteOfferSnapshotRow[],
          accountsById,
        );
      } catch (err) {
        // refreshAppRouteOfferSnapshotsForVariant is defensive and logs internally,
        // so a top-level throw is unexpected — record it and continue.
        logger.error('AppRoute offer snapshot refresh threw unexpectedly', err as Error, {
          requestId,
          approuteOfferCount: approuteOffers.length,
        });
      }

      // Count offers whose last_price_cents changed as successfully updated.
      for (const offer of approuteOffers) {
        if (offer.last_price_cents !== pricesBefore.get(offer.id)) {
          updated++;
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
