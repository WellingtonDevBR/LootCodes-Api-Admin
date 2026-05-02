import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../middleware/auth.guard.js';

export async function adminVerificationRoutes(app: FastifyInstance) {
  app.post('/:id/approve', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/:id/deny', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
