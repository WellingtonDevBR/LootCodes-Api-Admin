import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import type { ReconcileSellerListingsUseCase } from '../../core/use-cases/seller/reconcile-seller-listings.use-case.js';
import {
  RECONCILE_PHASES,
  type ReconcileSellerListingsDto,
} from '../../core/use-cases/seller/reconcile-seller-listings.types.js';
import type { RecryptProductKeysBatchUseCase } from '../../core/use-cases/inventory/recrypt-product-keys-batch.use-case.js';
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
}
