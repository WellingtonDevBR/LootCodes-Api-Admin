import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../middleware/auth.guard.js';

export async function adminAuditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
