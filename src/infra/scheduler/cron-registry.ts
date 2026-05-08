/**
 * Fastify-native cron scheduler shell.
 *
 * Intentionally empty: seller-side maintenance (cost-basis, pricing,
 * declared-stock, remote-stock, reservation expiry) is now triggered
 * by the unified HTTP route `POST /internal/cron/reconcile-seller-listings`.
 * An external scheduler (Supabase pg_cron via `net.http_post`, GCP Cloud
 * Scheduler, etc.) is the single trigger surface.
 *
 * The skeleton remains so future genuinely in-process work (e.g. very
 * cheap, framework-only ticks) can be added with the same pattern.
 */
import type { FastifyInstance } from 'fastify';
import cron from 'node-cron';
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

  if (registeredJobs.length === 0) {
    logger.info(
      'In-process cron registry is intentionally empty; seller maintenance runs via POST /internal/cron/reconcile-seller-listings',
    );
  }

  app.addHook('onClose', () => {
    for (const job of registeredJobs) {
      job.task.stop();
      logger.info(`Stopped cron job: ${job.name}`);
    }
    registeredJobs.length = 0;
  });
}

export function getRegisteredJobs(): ReadonlyArray<{ name: string; schedule: string }> {
  return registeredJobs.map((j) => ({ name: j.name, schedule: j.schedule }));
}
