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
import type { SearchCatalogUseCase } from '../../core/use-cases/procurement/search-catalog.use-case.js';
import type { LinkCatalogProductUseCase } from '../../core/use-cases/procurement/link-catalog-product.use-case.js';
import type { LiveSearchProvidersUseCase } from '../../core/use-cases/procurement/live-search-providers.use-case.js';
import type { GetProcurementConfigUseCase } from '../../core/use-cases/procurement/get-procurement-config.use-case.js';
import type { UpdateProcurementConfigUseCase } from '../../core/use-cases/procurement/update-procurement-config.use-case.js';
import type { ListPurchaseQueueUseCase } from '../../core/use-cases/procurement/list-purchase-queue.use-case.js';
import type { CancelQueueItemUseCase } from '../../core/use-cases/procurement/cancel-queue-item.use-case.js';
import type { ListPurchaseAttemptsUseCase } from '../../core/use-cases/procurement/list-purchase-attempts.use-case.js';

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

  app.get('/catalog', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<SearchCatalogUseCase>(UC_TOKENS.SearchCatalog);
    const query = request.query as Record<string, string>;
    const result = await uc.execute({
      search: query.search || undefined,
      provider_code: query.provider_code || undefined,
      page: query.page ? parseInt(query.page, 10) : undefined,
      page_size: query.page_size ? parseInt(query.page_size, 10) : undefined,
    });
    return reply.send(result);
  });

  app.post('/catalog/link', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<LinkCatalogProductUseCase>(UC_TOKENS.LinkCatalogProduct);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_code: body.provider_code as string,
      external_product_id: body.external_product_id as string,
      currency: body.currency as string,
      price_cents: body.price_cents as number,
      platform_code: body.platform_code as string | undefined,
      region_code: body.region_code as string | undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/providers/live-search', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<LiveSearchProvidersUseCase>(UC_TOKENS.LiveSearchProviders);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      query: body.query as string,
      max_results: body.max_results as number | undefined,
      exclude_provider_codes: body.exclude_provider_codes as string[] | undefined,
    });
    return reply.send(result);
  });

  // --- Procurement Config ---

  app.get('/config', { preHandler: [adminGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetProcurementConfigUseCase>(UC_TOKENS.GetProcurementConfig);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.put('/config', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateProcurementConfigUseCase>(UC_TOKENS.UpdateProcurementConfig);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      auto_buy_enabled: typeof body.auto_buy_enabled === 'boolean' ? body.auto_buy_enabled : undefined,
      daily_spend_limit_cents: body.daily_spend_limit_cents !== undefined
        ? (body.daily_spend_limit_cents as number | null)
        : undefined,
      max_cost_per_item_cents: body.max_cost_per_item_cents !== undefined
        ? (body.max_cost_per_item_cents as number | null)
        : undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  // --- Purchase Queue ---

  app.get('/queue', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListPurchaseQueueUseCase>(UC_TOKENS.ListPurchaseQueue);
    const query = request.query as Record<string, string>;
    const result = await uc.execute({
      status: query.status || undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return reply.send(result);
  });

  app.post('/queue/:id/cancel', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<CancelQueueItemUseCase>(UC_TOKENS.CancelQueueItem);
    const params = request.params as Record<string, string>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      queue_id: params.id,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.get('/queue/:id/attempts', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListPurchaseAttemptsUseCase>(UC_TOKENS.ListPurchaseAttempts);
    const params = request.params as Record<string, string>;
    const result = await uc.execute({ queue_id: params.id });
    return reply.send(result);
  });
}
