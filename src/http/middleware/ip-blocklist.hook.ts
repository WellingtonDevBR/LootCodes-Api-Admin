import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IIpBlocklist } from '../../core/ports/ip-blocklist.port.js';
import { extractClientIP } from '../../shared/client-ip.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('ip-blocklist-hook');

const EXEMPT_PREFIXES = ['/health'];

export function registerIpBlocklistHook(app: FastifyInstance) {
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url;
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return;
    }

    try {
      const blocklist = container.resolve<IIpBlocklist>(TOKENS.IpBlocklist);
      const headers = request.headers as Record<string, string | string[] | undefined>;
      const ip = extractClientIP(headers);
      const blocked = await blocklist.isBlocked(ip);
      if (blocked) {
        logger.warn('Blocked IP attempted admin access', { ip, path });
        return reply.code(403).send({ error: 'Forbidden' });
      }
    } catch (err) {
      logger.warn('IP blocklist check failed, allowing request', err as Error);
    }
  });
}
