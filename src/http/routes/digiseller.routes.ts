import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../middleware/auth.guard.js';

export async function adminDigisellerRoutes(app: FastifyInstance) {
  app.post('/reconcile-profit', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
