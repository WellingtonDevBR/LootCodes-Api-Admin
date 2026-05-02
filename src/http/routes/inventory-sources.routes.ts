import type { FastifyInstance } from 'fastify';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';

export async function adminInventorySourceRoutes(app: FastifyInstance) {
  app.post('/link', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/unlink', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.get('/', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.get('/linkable', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
