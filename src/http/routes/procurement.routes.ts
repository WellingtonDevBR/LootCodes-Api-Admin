import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { TestProviderQuoteUseCase } from '../../core/use-cases/procurement/test-provider-quote.use-case.js';
import type { SearchProvidersUseCase } from '../../core/use-cases/procurement/search-providers.use-case.js';
import type { ManageProviderOfferUseCase } from '../../core/use-cases/procurement/manage-provider-offer.use-case.js';
import type { IngestProviderCatalogUseCase } from '../../core/use-cases/procurement/ingest-provider-catalog.use-case.js';
import type { IngestProviderCatalogStatusUseCase } from '../../core/use-cases/procurement/ingest-provider-catalog-status.use-case.js';
import type { RefreshProviderPricesUseCase } from '../../core/use-cases/procurement/refresh-provider-prices.use-case.js';
import type { ManualProviderPurchaseUseCase } from '../../core/use-cases/procurement/manual-provider-purchase.use-case.js';
import type { RecoverProviderOrderUseCase } from '../../core/use-cases/procurement/recover-provider-order.use-case.js';

export async function adminProcurementRoutes(app: FastifyInstance) {
  app.post('/quote', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<TestProviderQuoteUseCase>(UC_TOKENS.TestProviderQuote);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_code: body.provider_code as string | undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/offer', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ManageProviderOfferUseCase>(UC_TOKENS.ManageProviderOffer);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_code: body.provider_code as string,
      action: body.action as 'link' | 'unlink' | 'update',
      offer_data: body.offer_data as Record<string, unknown> | undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/catalog/ingest', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<IngestProviderCatalogUseCase>(UC_TOKENS.IngestProviderCatalog);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      provider_code: body.provider_code as string,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.get('/catalog/ingest-status', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<IngestProviderCatalogStatusUseCase>(UC_TOKENS.IngestProviderCatalogStatus);
    const query = request.query as Record<string, string>;
    const result = await uc.execute({ job_id: query.job_id });
    return reply.send(result);
  });

  app.post('/prices/refresh', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<RefreshProviderPricesUseCase>(UC_TOKENS.RefreshProviderPrices);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      provider_code: body.provider_code as string | undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/purchase', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ManualProviderPurchaseUseCase>(UC_TOKENS.ManualProviderPurchase);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_code: body.provider_code as string,
      quantity: body.quantity as number,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/recover', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<RecoverProviderOrderUseCase>(UC_TOKENS.RecoverProviderOrder);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      purchase_id: body.purchase_id as string,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/providers/search', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<SearchProvidersUseCase>(UC_TOKENS.SearchProviders);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      query: body.query as string,
      limit: body.limit as number | undefined,
    });
    return reply.send(result);
  });
}
