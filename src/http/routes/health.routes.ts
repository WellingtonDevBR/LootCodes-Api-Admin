import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      service: 'lootcodes-admin-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get('/ready', async (_request, reply) => {
    try {
      const db = container.resolve<IDatabase>(TOKENS.Database);
      await db.queryOne('platform_settings', {
        select: 'key',
        limit: 1,
      });
      return reply.send({ status: 'ready', timestamp: new Date().toISOString() });
    } catch {
      return reply.code(503).send({ status: 'not_ready', timestamp: new Date().toISOString() });
    }
  });
}
