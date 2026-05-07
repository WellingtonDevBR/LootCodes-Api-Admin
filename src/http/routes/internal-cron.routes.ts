import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { TOKENS } from '../../di/tokens.js';
import type { IProcurementDeclaredStockReconcileService } from '../../core/ports/procurement-declared-stock-reconcile.port.js';
import { procurementCronSecretGuard } from '../middleware/procurement-cron-secret.guard.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('internal-cron-routes');

function parseUuidList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x.trim())) {
      out.push(x.trim());
    }
  }
  return out.length > 0 ? out : undefined;
}

export async function internalCronRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/reconcile-procurement-declared-stock',
    { preHandler: [procurementCronSecretGuard] },
    async (request, reply) => {
      const requestId =
        (typeof request.headers['x-request-id'] === 'string' && request.headers['x-request-id'].trim()) ||
        (request as unknown as { requestId?: string }).requestId ||
        'cron-procurement-stock';

      const body = (request.body ?? {}) as Record<string, unknown>;
      const variant_ids = parseUuidList(body.variant_ids);
      const dry_run = body.dry_run === true;
      const batch_limit =
        typeof body.batch_limit === 'number' && Number.isFinite(body.batch_limit)
          ? Math.floor(body.batch_limit)
          : undefined;

      logger.info('Procurement declared stock cron invoked', {
        requestId,
        dry_run,
        variantFilterCount: variant_ids?.length ?? 0,
        batch_limit,
      });

      try {
        const service = container.resolve<IProcurementDeclaredStockReconcileService>(
          TOKENS.ProcurementDeclaredStockReconcileService,
        );
        const result = await service.execute(requestId, {
          variant_ids,
          dry_run,
          batch_limit,
        });
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('Procurement declared stock cron failed', { requestId, error: msg });
        return reply.code(500).send({ error: 'reconcile_failed', message: msg });
      }
    },
  );
}
