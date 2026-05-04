import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { CalculatePayoutUseCase } from '../../core/use-cases/seller/calculate-payout.use-case.js';
import type { GetCompetitorsUseCase } from '../../core/use-cases/seller/get-competitors.use-case.js';
import type { SuggestPriceUseCase } from '../../core/use-cases/seller/suggest-price.use-case.js';
import type { DryRunPricingUseCase } from '../../core/use-cases/seller/dry-run-pricing.use-case.js';
import type { GetDecisionHistoryUseCase } from '../../core/use-cases/seller/get-decision-history.use-case.js';
import type { GetLatestDecisionUseCase } from '../../core/use-cases/seller/get-latest-decision.use-case.js';
import type { GetProviderDefaultsUseCase } from '../../core/use-cases/seller/get-provider-defaults.use-case.js';

export async function adminSellerPricingRoutes(app: FastifyInstance) {
  app.post('/payout', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<CalculatePayoutUseCase>(UC_TOKENS.CalculatePayout);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      listing_id: body.listing_id as string,
      price_cents: body.price_cents as number,
      mode: (body.mode as 'gross' | 'net') ?? 'gross',
    });
    return reply.send(result);
  });

  app.get('/competitors/:listingId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetCompetitorsUseCase>(UC_TOKENS.GetCompetitors);
    const { listingId } = request.params as { listingId: string };
    const result = await uc.execute({ listing_id: listingId });
    return reply.send(result);
  });

  app.post('/suggest', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<SuggestPriceUseCase>(UC_TOKENS.SuggestPrice);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      listing_id: body.listing_id as string,
      effective_cost_cents: body.effective_cost_cents as number,
      listing_type: body.listing_type as 'key_upload' | 'declared_stock',
    });
    return reply.send(result);
  });

  app.post('/dry-run', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<DryRunPricingUseCase>(UC_TOKENS.DryRunPricing);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      listing_id: body.listing_id as string,
    });
    return reply.send(result);
  });

  app.get('/decisions/:listingId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetDecisionHistoryUseCase>(UC_TOKENS.GetDecisionHistory);
    const { listingId } = request.params as { listingId: string };
    const query = request.query as Record<string, string>;
    const result = await uc.execute({
      listing_id: listingId,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return reply.send(result);
  });

  app.get('/decisions/:listingId/latest', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetLatestDecisionUseCase>(UC_TOKENS.GetLatestDecision);
    const { listingId } = request.params as { listingId: string };
    const result = await uc.execute({ listing_id: listingId });
    return reply.send(result);
  });

  app.get('/provider-defaults/:accountId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetProviderDefaultsUseCase>(UC_TOKENS.GetProviderDefaults);
    const { accountId } = request.params as { accountId: string };
    const result = await uc.execute({ provider_account_id: accountId });
    return reply.send(result);
  });
}
