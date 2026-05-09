/**
 * All scheduled work is triggered externally by AWS EventBridge Scheduler
 * via POST /internal/cron/* with X-Internal-Secret authentication.
 *
 * Registered endpoints:
 *   POST /internal/cron/expire-price-match-claims    — every 1 min
 *   POST /internal/cron/process-price-drop-refunds   — hourly at :05
 *   POST /internal/cron/settle-pending-referrals     — every 15 min
 *   POST /internal/cron/recrypt-product-keys         — external schedule
 *   POST /internal/cron/reconcile-seller-listings    — external schedule
 *
 * No in-process node-cron jobs are registered. This file is kept as
 * a Fastify plugin hook so the onClose teardown pattern remains
 * available if in-process work is ever added.
 */
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('cron-scheduler');

export async function registerCronJobs(_app: FastifyInstance): Promise<void> {
  logger.info(
    'In-process cron registry is empty — all jobs are triggered by AWS EventBridge Scheduler via POST /internal/cron/*',
  );
}

export function getRegisteredJobs(): ReadonlyArray<{ name: string; schedule: string }> {
  return [];
}
