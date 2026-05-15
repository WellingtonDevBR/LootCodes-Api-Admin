import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { CalculatePayoutUseCase } from '../../core/use-cases/seller/calculate-payout.use-case.js';
import type { GetCompetitorsUseCase } from '../../core/use-cases/seller/get-competitors.use-case.js';
import type { SuggestPriceUseCase } from '../../core/use-cases/seller/suggest-price.use-case.js';
import type { DryRunPricingUseCase } from '../../core/use-cases/seller/dry-run-pricing.use-case.js';
import type { GetDecisionHistoryUseCase } from '../../core/use-cases/seller/get-decision-history.use-case.js';
import type { GetLatestDecisionUseCase } from '../../core/use-cases/seller/get-latest-decision.use-case.js';
import type { GetProviderDefaultsUseCase } from '../../core/use-cases/seller/get-provider-defaults.use-case.js';
import type { ISellerAutoPricingService, ISellerStockSyncService } from '../../core/ports/seller-pricing.port.js';
import { getRegisteredJobs } from '../../infra/scheduler/cron-registry.js';
import { z } from 'zod';
import { parseBody, replyInvalidRequestBody } from '../utils/zod-validation.js';

// ─── Body schemas (single source of truth) ──────────────────────────────────

const payoutSchema = z.object({
  listing_id: z.string().uuid(),
  price_cents: z.number().int().positive(),
}).strict();

const suggestSchema = z.object({
  listing_id: z.string().uuid(),
  effective_cost_cents: z.number().int().nonnegative(),
  listing_type: z.enum(['key_upload', 'declared_stock']),
}).strict();

const dryRunSchema = z.object({
  listing_id: z.string().uuid(),
}).strict();

export async function adminSellerPricingRoutes(app: FastifyInstance) {
  app.post('/payout', { preHandler: [employeeGuard] }, async (request, reply) => {
    const parsed = parseBody(payoutSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<CalculatePayoutUseCase>(UC_TOKENS.CalculatePayout);
    const result = await uc.execute({
      listing_id: parsed.data.listing_id,
      price_cents: parsed.data.price_cents,
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
    const parsed = parseBody(suggestSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<SuggestPriceUseCase>(UC_TOKENS.SuggestPrice);
    const result = await uc.execute({
      listing_id: parsed.data.listing_id,
      effective_cost_cents: parsed.data.effective_cost_cents,
      listing_type: parsed.data.listing_type,
    });
    return reply.send(result);
  });

  app.post('/dry-run', { preHandler: [employeeGuard] }, async (request, reply) => {
    const parsed = parseBody(dryRunSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<DryRunPricingUseCase>(UC_TOKENS.DryRunPricing);
    const result = await uc.execute({
      listing_id: parsed.data.listing_id,
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

  // ─── Manual Trigger Endpoints ─────────────────────────────────────

  app.post('/refresh-prices', { preHandler: [adminGuard] }, async (request, reply) => {
    const requestId = `manual-prices-${crypto.randomUUID().slice(0, 8)}`;
    const service = container.resolve<ISellerAutoPricingService>(TOKENS.SellerAutoPricingService);
    const result = await service.refreshAllPrices(requestId);
    return reply.send({ requestId, ...result });
  });

  app.post('/refresh-cost-bases', { preHandler: [adminGuard] }, async (request, reply) => {
    const requestId = `manual-costs-${crypto.randomUUID().slice(0, 8)}`;
    const service = container.resolve<ISellerAutoPricingService>(TOKENS.SellerAutoPricingService);
    const result = await service.refreshAllCostBases(requestId);
    return reply.send({ requestId, ...result });
  });

  app.post('/refresh-stock', { preHandler: [adminGuard] }, async (request, reply) => {
    const requestId = `manual-stock-${crypto.randomUUID().slice(0, 8)}`;
    const service = container.resolve<ISellerStockSyncService>(TOKENS.SellerStockSyncService);
    const result = await service.refreshAllStock(requestId);
    return reply.send({ requestId, ...result });
  });

  app.get('/cron-status', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const jobs = getRegisteredJobs();
    return reply.send({ jobs, count: jobs.length });
  });
}
