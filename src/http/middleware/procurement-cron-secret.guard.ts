import type { FastifyReply, FastifyRequest } from 'fastify';
import { getEnv, getOptionalEnvVar } from '../../config/env.js';
import { procurementCronSecretMatches } from './procurement-cron-secret-validation.js';

/**
 * Cron callers send `X-Internal-Secret` matching `PROCUREMENT_DECLARED_STOCK_CRON_SECRET`
 * when set; otherwise `INTERNAL_SERVICE_SECRET` (same header name as other internal routes).
 */
export async function procurementCronSecretGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secretRaw = request.headers['x-internal-secret'];
  const secret = typeof secretRaw === 'string' ? secretRaw : '';

  const cronSecret = getOptionalEnvVar('PROCUREMENT_DECLARED_STOCK_CRON_SECRET');
  const env = getEnv();
  const candidates = cronSecret?.trim()
    ? [cronSecret.trim()]
    : [env.INTERNAL_SERVICE_SECRET];

  if (!procurementCronSecretMatches(secret, candidates)) {
    const missing = !secret.trim();
    await reply.code(401).send({
      error: missing ? 'Missing internal secret' : 'Invalid internal secret',
      code: 'AUTHENTICATION_ERROR',
    });
    return;
  }

  (request as unknown as Record<string, unknown>).authUser = { id: 'cron-procurement-stock', role: 'service' };
}
