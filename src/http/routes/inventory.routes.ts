import type { FastifyInstance } from 'fastify';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';

export async function adminInventoryRoutes(app: FastifyInstance) {
  // GET /api/admin/inventory/variants/:variantId/keys — list keys for variant
  app.get('/variants/:variantId/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const repo = container.resolve<{ listVariantKeys: (dto: unknown) => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const { variantId } = request.params as { variantId: string };
    const query = request.query as Record<string, string | undefined>;
    const result = await repo.listVariantKeys({
      variant_id: variantId,
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return reply.send(result);
  });

  // POST /api/admin/inventory/keys/upload — upload & encrypt keys
  app.post('/keys/upload', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet — requires Edge Function integration' });
  });

  app.post('/keys/replace', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/fix-states', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/decrypt', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/recrypt', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/sales-blocked', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/mark-faulty', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/link-replacement', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/variant/sales-blocked', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/manual-sell', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/emit-stock-changed', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/stock-notifications/send', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.patch('/keys/update-affected', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
