import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IHealthRepository } from '../../core/ports/health-repository.port.js';

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
      const health = container.resolve<IHealthRepository>(TOKENS.HealthRepository);
      await health.pingReadiness();
      return reply.send({ status: 'ready', timestamp: new Date().toISOString() });
    } catch {
      return reply.code(503).send({ status: 'not_ready', timestamp: new Date().toISOString() });
    }
  });
}
