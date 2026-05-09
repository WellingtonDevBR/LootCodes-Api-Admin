import * as Sentry from '@sentry/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import type { IBuyerOfferSnapshotSyncService } from '../../core/ports/buyer-offer-snapshot-sync.port.js';
import type { ReconcileSellerListingsUseCase } from '../../core/use-cases/seller/reconcile-seller-listings.use-case.js';
import {
  RECONCILE_PHASES,
  type ReconcileSellerListingsDto,
} from '../../core/use-cases/seller/reconcile-seller-listings.types.js';
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
      logger.info('Recrypt product-keys cron invoked', { requestId, batch_size });

      try {
        const uc = container.resolve<RecryptProductKeysBatchUseCase>(
          UC_TOKENS.RecryptProductKeysBatch,
        );
        const result = await uc.execute({ batchSize: batch_size });
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Recrypt product-keys cron failed', err as Error, { requestId });
        return reply.code(500).send({ error: 'recrypt_failed', message });
      }
    },
  );

  app.post(
    '/reconcile-seller-listings',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-reconcile-seller-listings');

      const parsed = reconcileBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '<root>',
          message: i.message,
        }));
        logger.warn('Reconcile seller-listings cron rejected — invalid body', {
          requestId,
          issues,
        });
        return reply.code(400).send({ error: 'invalid_request_body', issues });
      }

      const dto: ReconcileSellerListingsDto = parsed.data;

      logger.info('Reconcile seller-listings cron invoked', {
        requestId,
        variantFilterCount: dto.variant_ids?.length ?? 0,
        batch_limit: dto.batch_limit,
        dry_run: dto.dry_run === true,
        phases: dto.phases,
      });

      try {
        const orchestrator = container.resolve<ReconcileSellerListingsUseCase>(
          UC_TOKENS.ReconcileSellerListings,
        );
        const result = await orchestrator.execute(requestId, dto);
        return reply.send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Reconcile seller-listings cron failed', err as Error, { requestId });
        return reply.code(500).send({ error: 'reconcile_failed', message });
      }
    },
  );

  app.post(
    '/expire-price-match-claims',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-expire-price-match-claims');
      logger.info('Expire price-match claims cron invoked', { requestId });

      try {
        const uc = container.resolve<ExpirePriceMatchClaimsUseCase>(
          UC_TOKENS.ExpirePriceMatchClaims,
        );
        const result = await uc.execute();
        logger.info('Expire price-match claims cron completed', { requestId, expiredCount: result.expiredCount });
        return reply.send(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'expire-price-match-claims');
          scope.setContext('cron', { requestId, job: 'expire-price-match-claims' });
          logger.error('Expire price-match claims cron failed', error, { requestId });
        });
        return reply.code(500).send({ error: 'expire_price_match_claims_failed', message: error.message });
      }
    },
  );

  app.post(
    '/process-price-drop-refunds',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId = resolveRequestId(request, 'cron-process-price-drop-refunds');
      logger.info('Process price-drop refunds cron invoked', { requestId });

      try {
        const uc = container.resolve<ProcessPriceDropRefundsUseCase>(
          UC_TOKENS.ProcessPriceDropRefunds,
        );
        const result = await uc.execute();
        logger.info('Process price-drop refunds cron completed', { requestId, grantedCount: result.grantedCount });
        return reply.send(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'process-price-drop-refunds');
          scope.setContext('cron', { requestId, job: 'process-price-drop-refunds' });
          logger.error('Process price-drop refunds cron failed', error, { requestId });
        });
        return reply.code(500).send({ error: 'process_price_drop_refunds_failed', message: error.message });
      }
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
      logger.info('Settle pending referrals cron invoked', { requestId, batchSize });

      try {
        const uc = container.resolve<SettlePendingReferralsUseCase>(
          UC_TOKENS.SettlePendingReferrals,
        );
        const result = await uc.execute({ batchSize });
        logger.info('Settle pending referrals cron completed', {
          requestId,
          attempted: result.attempted,
          settled: result.settled,
          stillPending: result.stillPending,
          errors: result.errors,
        });
        return reply.send(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'settle-pending-referrals');
          scope.setContext('cron', { requestId, job: 'settle-pending-referrals', batchSize });
          logger.error('Settle pending referrals cron failed', error, { requestId, batchSize });
        });
        return reply.code(500).send({ error: 'settle_pending_referrals_failed', message: error.message });
      }
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
      logger.info('Sync buyer catalog cron invoked', { requestId });

      try {
        const svc = container.resolve<IBuyerOfferSnapshotSyncService>(
          TOKENS.BuyerOfferSnapshotSyncService,
        );
        const result = await svc.syncAll(requestId);
        logger.info('Sync buyer catalog cron completed', { requestId, ...result });
        return reply.send(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        Sentry.withScope((scope) => {
          scope.setTag('cron.job', 'sync-buyer-catalog');
          scope.setContext('cron', { requestId });
          logger.error('Sync buyer catalog cron failed', error, { requestId });
        });
        return reply.code(500).send({ error: 'sync_buyer_catalog_failed', message: error.message });
      }
    },
  );
}
