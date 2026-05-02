import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../middleware/auth.guard.js';

export async function adminAnalyticsRoutes(app: FastifyInstance) {
  app.post('/process-preorder', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
