import type { FastifyInstance } from 'fastify';
import { employeeGuard } from '../middleware/auth.guard.js';

export async function adminAlgoliaRoutes(app: FastifyInstance) {
  app.get('/index-stats', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
