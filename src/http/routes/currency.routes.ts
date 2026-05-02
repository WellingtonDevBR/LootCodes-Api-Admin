import type { FastifyInstance } from 'fastify';
import { adminGuard, internalSecretGuard } from '../middleware/auth.guard.js';

export async function adminCurrencyRoutes(app: FastifyInstance) {
  app.post('/sync', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.put('/rates', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.get('/rates', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/sync-internal', { preHandler: [internalSecretGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
