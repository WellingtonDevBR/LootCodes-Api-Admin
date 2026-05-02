import type { FastifyInstance } from 'fastify';
import { adminGuard, internalSecretGuard } from '../middleware/auth.guard.js';

export async function adminOrderRoutes(app: FastifyInstance) {
  app.post('/fulfill-verified', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/manual-fulfill', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/recover', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/confirm-payment', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/refund', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/refund-initiate', { preHandler: [internalSecretGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
