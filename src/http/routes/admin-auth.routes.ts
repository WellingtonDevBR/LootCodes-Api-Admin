import type { FastifyInstance } from 'fastify';
import { adminGuard, internalSecretGuard } from '../middleware/auth.guard.js';

export async function adminAuthRoutes(app: FastifyInstance) {
  app.post('/sms/send', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/sms/verify', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/sms/security-alert', { preHandler: [internalSecretGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
