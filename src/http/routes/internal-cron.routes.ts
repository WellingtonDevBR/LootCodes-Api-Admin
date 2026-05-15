import * as Sentry from '@sentry/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import type { IBuyerOfferSnapshotSyncService } from '../../core/ports/buyer-offer-snapshot-sync.port.js';
import type { ReconcileSellerListingsUseCase } from '../../core/use-cases/seller/reconcile-seller-listings.use-case.js';
import { RECONCILE_PHASES } from '../../core/use-cases/seller/reconcile-seller-listings.types.js';
import type { RecryptProductKeysBatchUseCase } from '../../core/use-cases/inventory/recrypt-product-keys-batch.use-case.js';
import type { ExpirePriceMatchClaimsUseCase } from '../../core/use-cases/price-match/expire-price-match-claims.use-case.js';
import type { ProcessPriceDropRefundsUseCase } from '../../core/use-cases/price-match/process-price-drop-refunds.use-case.js';
import type { SettlePendingReferralsUseCase } from '../../core/use-cases/referrals/settle-pending-referrals.use-case.js';
import { procurementCronSecretGuard } from '../middleware/procurement-cron-secret.guard.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('internal-cron-routes');

const reconcileBodySchema = z
  .object({
    variant_ids: z.array(z.string().uuid()).min(1).optional(),
    batch_limit: z.number().int().positive().optional(),
    dry_run: z.boolean().optional(),
    phases: z.array(z.enum(RECONCILE_PHASES)).min(1).optional(),
  })
  .strict();

const recryptBodySchema = z
  .object({
    batch_size: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const settlePendingReferralsBodySchema = z
  .object({
    batch_size: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

function resolveRequestId(request: FastifyRequest, fallback: string): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.trim().length > 0) return header.trim();
  const requestId = (request as unknown as { requestId?: string }).requestId;
  if (typeof requestId === 'string' && requestId.length > 0) return requestId;
  return fallback;
}

export async function internalCronRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/recrypt-product-keys',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-recrypt-product-keys');

      const parsed = recryptBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '<root>',
          message: i.message,
        }));
        logger.warn('Recrypt product-keys cron rejected — invalid body', { requestId, issues });
        return reply.code(400).send({ error: 'invalid_request_body', issues });
      }

      const { batch_size } = parsed.data;
      logger.info('Recrypt product-keys cron accepted — running in background', { requestId, batch_size });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const uc = container.resolve<RecryptProductKeysBatchUseCase>(UC_TOKENS.RecryptProductKeysBatch);
      uc.execute({ batchSize: batch_size }).catch((err: unknown) => {
        logger.error('Recrypt product-keys background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'recrypt-product-keys');
          scope.setContext('cron', { requestId, batch_size });
          Sentry.captureException(err);
        });
      });
    },
  );

  app.post(
    '/expire-price-match-claims',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-expire-price-match-claims');
      logger.info('Expire price-match claims cron accepted — running in background', { requestId });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const uc = container.resolve<ExpirePriceMatchClaimsUseCase>(UC_TOKENS.ExpirePriceMatchClaims);
      uc.execute().catch((err: unknown) => {
        logger.error('Expire price-match claims background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'expire-price-match-claims');
          scope.setContext('cron', { requestId });
          Sentry.captureException(err);
        });
      });
    },
  );

  app.post(
    '/process-price-drop-refunds',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-process-price-drop-refunds');
      logger.info('Process price-drop refunds cron accepted — running in background', { requestId });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const uc = container.resolve<ProcessPriceDropRefundsUseCase>(UC_TOKENS.ProcessPriceDropRefunds);
      uc.execute().catch((err: unknown) => {
        logger.error('Process price-drop refunds background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'process-price-drop-refunds');
          scope.setContext('cron', { requestId });
          Sentry.captureException(err);
        });
      });
    },
  );

  app.post(
    '/settle-pending-referrals',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-settle-pending-referrals');

      const parsed = settlePendingReferralsBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '<root>',
          message: i.message,
        }));
        logger.warn('Settle pending referrals cron rejected — invalid body', { requestId, issues });
        return reply.code(400).send({ error: 'invalid_request_body', issues });
      }

      const batchSize = parsed.data.batch_size ?? 200;
      logger.info('Settle pending referrals cron accepted — running in background', { requestId, batchSize });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const uc = container.resolve<SettlePendingReferralsUseCase>(UC_TOKENS.SettlePendingReferrals);
      uc.execute({ batchSize }).catch((err: unknown) => {
        logger.error('Settle pending referrals background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'settle-pending-referrals');
          scope.setContext('cron', { requestId, batchSize });
          Sentry.captureException(err);
        });
      });
    },
  );

  /**
   * POST /internal/cron/seller-housekeeping
   *
   * Lightweight DB-only maintenance: expire stale reservations, refresh cost
   * bases, and reconcile paused-listing admin alerts.
   * No external marketplace calls — safe to run every 5 minutes.
   */
  app.post(
    '/seller-housekeeping',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-seller-housekeeping');
      logger.info('Seller housekeeping cron accepted — running in background', { requestId });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const orchestrator = container.resolve<ReconcileSellerListingsUseCase>(
        UC_TOKENS.ReconcileSellerListings,
      );
      orchestrator.execute(requestId, {
        phases: ['expire-reservations', 'cost-basis', 'paused-listing-alerts', 'pricing-frozen-alerts'],
      }).catch((err: unknown) => {
        logger.error('Seller housekeeping background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'seller-housekeeping');
          scope.setContext('cron', { requestId });
          Sentry.captureException(err);
        });
      });
    },
  );

  /**
   * POST /internal/cron/seller-pricing
   *
   * Recompute prices and push to all marketplaces (Eneba, Kinguin, …).
   * Depends on cost-basis being fresh — schedule after seller-housekeeping.
   * Recommended cadence: every 10 minutes.
   */
  app.post(
    '/seller-pricing',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-seller-pricing');
      logger.info('Seller pricing cron accepted — running in background', { requestId });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const orchestrator = container.resolve<ReconcileSellerListingsUseCase>(
        UC_TOKENS.ReconcileSellerListings,
      );
      orchestrator.execute(requestId, { phases: ['pricing'] }).catch((err: unknown) => {
        logger.error('Seller pricing background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'seller-pricing');
          scope.setContext('cron', { requestId });
          Sentry.captureException(err);
        });
      });
    },
  );

  /**
   * POST /internal/cron/seller-declared-stock
   *
   * Credit-aware declared-stock reconcile: snapshots buyer wallets, picks the
   * cheapest funded offer per listing, and pushes stock quantities to all
   * marketplaces. Schedule immediately after sync-buyer-catalog so quotes are
   * fresh. Accepts the same optional body as reconcile-seller-listings.
   * Recommended cadence: every 5 minutes.
   */
  app.post(
    '/seller-declared-stock',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-seller-declared-stock');

      const parsed = reconcileBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '<root>',
          message: i.message,
        }));
        logger.warn('Seller declared-stock cron rejected — invalid body', { requestId, issues });
        return reply.code(400).send({ error: 'invalid_request_body', issues });
      }

      const { variant_ids, batch_limit, dry_run } = parsed.data;
      logger.info('Seller declared-stock cron accepted — running in background', {
        requestId,
        variantFilterCount: variant_ids?.length ?? 0,
        batch_limit,
        dry_run: dry_run === true,
      });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const orchestrator = container.resolve<ReconcileSellerListingsUseCase>(
        UC_TOKENS.ReconcileSellerListings,
      );
      orchestrator.execute(requestId, {
        phases: ['declared-stock'],
        variant_ids,
        batch_limit,
        dry_run,
      }).catch((err: unknown) => {
        logger.error('Seller declared-stock background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'seller-declared-stock');
          scope.setContext('cron', { requestId, dry_run, variant_ids });
          Sentry.captureException(err);
        });
      });
    },
  );

  /**
   * POST /internal/cron/seller-remote-stock
   *
   * Pulls remote stock levels back from marketplaces for all
   * auto_sync_stock=true listings. Read-only against marketplaces — safe to
   * run at a slower cadence (every 15–30 minutes) to reduce API load.
   */
  app.post(
    '/seller-remote-stock',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-seller-remote-stock');
      logger.info('Seller remote-stock cron accepted — running in background', { requestId });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const orchestrator = container.resolve<ReconcileSellerListingsUseCase>(
        UC_TOKENS.ReconcileSellerListings,
      );
      orchestrator.execute(requestId, { phases: ['remote-stock'] }).catch((err: unknown) => {
        logger.error('Seller remote-stock background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'seller-remote-stock');
          scope.setContext('cron', { requestId });
          Sentry.captureException(err);
        });
      });
    },
  );

  /**
   * POST /internal/cron/sync-buyer-catalog
   *
   * Fetches live quotes from all active buyer providers (currently Bamboo) and
   * refreshes `provider_variant_offers` in place. Replaces the deprecated
   * Supabase `provider-catalog-sync` pg_cron job.
   *
   * Schedule this endpoint from your external cron runner at whatever cadence
   * you need (recommended: every 5 minutes, right before reconcile-seller-listings).
   * No body required.
   */
  app.post(
    '/sync-buyer-catalog',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-sync-buyer-catalog');
      logger.info('Sync buyer catalog cron accepted — running in background', { requestId });
      reply.code(202).send({ accepted: true, request_id: requestId });

      const svc = container.resolve<IBuyerOfferSnapshotSyncService>(TOKENS.BuyerOfferSnapshotSyncService);
      svc.syncAll(requestId).catch((err: unknown) => {
        logger.error('Sync buyer catalog background run failed', err as Error, { requestId });
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'sync-buyer-catalog');
          scope.setContext('cron', { requestId });
          Sentry.captureException(err);
        });
      });
    },
  );
}
