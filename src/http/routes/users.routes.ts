import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../middleware/auth.guard.js';

export async function adminUserRoutes(app: FastifyInstance) {
  app.post('/block', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/force-logout', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/generate-guest-access-link', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
