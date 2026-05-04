import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { employeeGuard } from '../middleware/auth.guard.js';
import type { ListOpportunitiesUseCase } from '../../core/use-cases/opportunities/list-opportunities.use-case.js';

export async function adminOpportunitiesRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const uc = container.resolve<ListOpportunitiesUseCase>(UC_TOKENS.ListOpportunities);
    const result = await uc.execute({
      status: query.status,
      min_margin_pct: query.min_margin_pct ? Number(query.min_margin_pct) : undefined,
      buy_provider: query.buy_provider,
      sell_provider: query.sell_provider,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    return reply.send(result);
  });
}
