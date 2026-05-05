/**
 * Fastify-native cron scheduler using node-cron.
 *
 * Registers named cron jobs at app startup. Each job resolves its
 * service from the DI container and executes.
 */
import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
import crypto from 'node:crypto';
import { container } from '../../di/container.js';
import { TOKENS } from '../../di/tokens.js';
import type { ISellerAutoPricingService, ISellerStockSyncService } from '../../core/ports/seller-pricing.port.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('cron-scheduler');

interface CronJob {
  name: string;
  schedule: string;
  task: ReturnType<typeof cron.schedule>;
}

const registeredJobs: CronJob[] = [];

/**
 * Register all cron jobs as a Fastify plugin.
 * Jobs only run in production or when ENABLE_CRON=true.
 */
export async function registerCronJobs(app: FastifyInstance): Promise<void> {
  const enableCron = process.env.ENABLE_CRON === 'true' || process.env.NODE_ENV === 'production';
  if (!enableCron) {
    logger.info('Cron jobs disabled (set ENABLE_CRON=true to enable)');
    return;
  }

  registerJob('refresh-seller-prices', '*/5 * * * *', async () => {
    const requestId = `cron-prices-${crypto.randomUUID().slice(0, 8)}`;
    logger.info('Starting auto-pricing refresh', { requestId });
    try {
      const service = container.resolve<ISellerAutoPricingService>(TOKENS.SellerAutoPricingService);
      const result = await service.refreshAllPrices(requestId);
      logger.info('Auto-pricing refresh complete', { requestId, ...result });
    } catch (err) {
      logger.error('Auto-pricing refresh failed', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  registerJob('refresh-seller-cost-bases', '2 */5 * * * *', async () => {
    const requestId = `cron-costs-${crypto.randomUUID().slice(0, 8)}`;
    logger.info('Starting cost basis refresh', { requestId });
    try {
      const service = container.resolve<ISellerAutoPricingService>(TOKENS.SellerAutoPricingService);
      const result = await service.refreshAllCostBases(requestId);
      logger.info('Cost basis refresh complete', { requestId, ...result });
    } catch (err) {
      logger.error('Cost basis refresh failed', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  registerJob('refresh-seller-stock', '2 */5 * * * *', async () => {
    const requestId = `cron-stock-${crypto.randomUUID().slice(0, 8)}`;
    logger.info('Starting stock sync refresh', { requestId });
    try {
      const service = container.resolve<ISellerStockSyncService>(TOKENS.SellerStockSyncService);
      const result = await service.refreshAllStock(requestId);
      logger.info('Stock sync refresh complete', { requestId, ...result });
    } catch (err) {
      logger.error('Stock sync refresh failed', {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info(`Registered ${registeredJobs.length} cron jobs`, {
    jobs: registeredJobs.map((j) => ({ name: j.name, schedule: j.schedule })),
  });

  app.addHook('onClose', () => {
    for (const job of registeredJobs) {
      job.task.stop();
      logger.info(`Stopped cron job: ${job.name}`);
    }
    registeredJobs.length = 0;
  });
}

function registerJob(name: string, schedule: string, handler: () => Promise<void>): void {
  if (!cron.validate(schedule)) {
    logger.error(`Invalid cron schedule for ${name}: ${schedule}`);
    return;
  }

  const task = cron.schedule(schedule, () => {
    handler().catch((err) => {
      logger.error(`Unhandled error in cron job ${name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  registeredJobs.push({ name, schedule, task });
}

export function getRegisteredJobs(): ReadonlyArray<{ name: string; schedule: string }> {
  return registeredJobs.map((j) => ({ name: j.name, schedule: j.schedule }));
}
