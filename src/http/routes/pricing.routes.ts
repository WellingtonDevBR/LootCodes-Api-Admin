import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetPricingSnapshotUseCase } from '../../core/use-cases/pricing/get-pricing-snapshot.use-case.js';
import type { GetVariantPriceTimelineUseCase } from '../../core/use-cases/pricing/get-variant-price-timeline.use-case.js';
import type { UpdateVariantPriceUseCase } from '../../core/use-cases/inventory/update-variant-price.use-case.js';

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

  app.get('/timeline/:variantId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetVariantPriceTimelineUseCase>(UC_TOKENS.GetVariantPriceTimeline);
    const { variantId } = request.params as { variantId: string };
    const query = request.query as { period?: string };
    const result = await uc.execute({
      variant_id: variantId,
      period: query.period,
    });
    return reply.send(result);
  });

  app.put('/variants/:id/price', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateVariantPriceUseCase>(UC_TOKENS.UpdateVariantPrice);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = request.authUser?.id ?? 'unknown';
    const result = await uc.execute({
      variant_id: id,
      price_cents: body.price_cents as number,
      admin_id,
    });
    return reply.send(result);
  });
}
