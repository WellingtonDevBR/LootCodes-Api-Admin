import type { FastifyInstance } from 'fastify';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';

export async function adminPriceMatchRoutes(app: FastifyInstance) {
  app.post('/:id/approve', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/:id/reject', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/preview-discount', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
