import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetPricingSnapshotUseCase } from '../../core/use-cases/pricing/get-pricing-snapshot.use-case.js';

export async function adminPricingRoutes(app: FastifyInstance) {
  app.get('/snapshot', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string };
    const uc = container.resolve<GetPricingSnapshotUseCase>(UC_TOKENS.GetPricingSnapshot);
    const result = await uc.execute({
      limit: query.limit ? Number(query.limit) : 200,
      offset: query.offset ? Number(query.offset) : 0,
    });
    return reply.send(result);
  });

  app.put('/variants/:id/price', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
