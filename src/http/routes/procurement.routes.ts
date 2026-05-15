import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard, getAuthenticatedUserId } from '../middleware/auth.guard.js';
import type { TestProviderQuoteUseCase } from '../../core/use-cases/procurement/test-provider-quote.use-case.js';
import type { SearchProvidersUseCase } from '../../core/use-cases/procurement/search-providers.use-case.js';
import type { ManageProviderOfferUseCase } from '../../core/use-cases/procurement/manage-provider-offer.use-case.js';
import type { IngestProviderCatalogUseCase } from '../../core/use-cases/procurement/ingest-provider-catalog.use-case.js';
import type { IngestProviderCatalogStatusUseCase } from '../../core/use-cases/procurement/ingest-provider-catalog-status.use-case.js';
import type { RefreshProviderPricesUseCase } from '../../core/use-cases/procurement/refresh-provider-prices.use-case.js';
import type { ManualProviderPurchaseUseCase } from '../../core/use-cases/procurement/manual-provider-purchase.use-case.js';
import type { BuyerManualPurchaseService } from '../../infra/procurement/buyer-manual-purchase.service.js';
import type { RecoverProviderOrderUseCase } from '../../core/use-cases/procurement/recover-provider-order.use-case.js';
import type { SearchCatalogUseCase } from '../../core/use-cases/procurement/search-catalog.use-case.js';
import type { LinkCatalogProductUseCase } from '../../core/use-cases/procurement/link-catalog-product.use-case.js';
import type { LiveSearchProvidersUseCase } from '../../core/use-cases/procurement/live-search-providers.use-case.js';
import type { PublishSellerListingToMarketplaceUseCase } from '../../core/use-cases/seller/publish-seller-listing-to-marketplace.use-case.js';
import type { GetProcurementConfigUseCase } from '../../core/use-cases/procurement/get-procurement-config.use-case.js';
import type { UpdateProcurementConfigUseCase } from '../../core/use-cases/procurement/update-procurement-config.use-case.js';
import type { ListPurchaseQueueUseCase } from '../../core/use-cases/procurement/list-purchase-queue.use-case.js';
import type { CancelQueueItemUseCase } from '../../core/use-cases/procurement/cancel-queue-item.use-case.js';
import type { ListPurchaseAttemptsUseCase } from '../../core/use-cases/procurement/list-purchase-attempts.use-case.js';
import type { LinkCatalogProductMarketplacePublishSnap } from '../../core/use-cases/procurement/procurement.types.js';
import type { SyncAppRouteCatalogUseCase } from '../../core/use-cases/procurement/sync-approute-catalog.use-case.js';
import { createLogger } from '../../shared/logger.js';
import { PublishBlockedError } from '../../core/errors/domain-errors.js';
import { z } from 'zod';
import { parseBody, replyInvalidRequestBody } from '../utils/zod-validation.js';

const logger = createLogger('admin-procurement-routes');

// ─── Body schemas (single source of truth) ──────────────────────────────────

const linkCatalogSchema = z.object({
  variant_id: z.string().uuid(),
  provider_code: z.string().min(1),
  external_product_id: z.string().min(1),
  external_parent_product_id: z.string().min(1).optional(),
  currency: z.string().min(3).max(8),
  price_cents: z.number().int().positive(),
  platform_code: z.string().min(1).optional(),
  region_code: z.string().min(1).optional(),
  publish_now: z.boolean().optional(),
  create_procurement_offer: z.boolean().optional(),
}).strict();

const manageOfferSchema = z.object({
  variant_id: z.string().uuid(),
  provider_code: z.string().min(1),
  action: z.enum(['link', 'unlink', 'update']),
  offer_data: z.record(z.string(), z.unknown()).optional(),
}).strict();

const manualPurchaseSchema = z.object({
  variant_id: z.string().uuid(),
  provider_code: z.string().min(1),
  offer_id: z.string().min(1),
  quantity: z.number().int().positive(),
  wallet_currency: z.string().min(3).max(8).optional(),
}).strict();

export async function adminProcurementRoutes(app: FastifyInstance) {
  app.post('/quote', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<TestProviderQuoteUseCase>(UC_TOKENS.TestProviderQuote);
    const body = request.body as Record<string, unknown>;
    const adminId = getAuthenticatedUserId(request);
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_code: body.provider_code as string | undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/offer', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(manageOfferSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<ManageProviderOfferUseCase>(UC_TOKENS.ManageProviderOffer);
    const adminId = getAuthenticatedUserId(request);
    const result = await uc.execute({
      variant_id: parsed.data.variant_id,
      provider_code: parsed.data.provider_code,
      action: parsed.data.action,
      offer_data: parsed.data.offer_data,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/catalog/ingest', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<IngestProviderCatalogUseCase>(UC_TOKENS.IngestProviderCatalog);
    const body = request.body as Record<string, unknown>;
    const adminId = getAuthenticatedUserId(request);
    const result = await uc.execute({
      provider_code: body.provider_code as string,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/approute/catalog/sync', { preHandler: [adminGuard] }, async (request, reply) => {
    const body = request.body as { provider_account_id?: string };
    const uc = container.resolve<SyncAppRouteCatalogUseCase>(UC_TOKENS.SyncAppRouteCatalog);
    const outcome = await uc.execute({ provider_account_id: body.provider_account_id });
    return reply.status(outcome.status).send(outcome.body);
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
    const adminId = getAuthenticatedUserId(request);
    const result = await uc.execute({
      provider_code: body.provider_code as string | undefined,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/purchase', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(manualPurchaseSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<ManualProviderPurchaseUseCase>(UC_TOKENS.ManualProviderPurchase);
    const adminId = getAuthenticatedUserId(request);
    const walletCurrency = parsed.data.wallet_currency?.trim();
    const result = await uc.execute({
      variant_id: parsed.data.variant_id,
      provider_code: parsed.data.provider_code,
      offer_id: parsed.data.offer_id,
      quantity: parsed.data.quantity,
      admin_id: adminId,
      ...(walletCurrency ? { wallet_currency: walletCurrency } : {}),
    });
    return reply.send(result);
  });

  app.get('/bamboo/live-wallets', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const svc = container.resolve<BuyerManualPurchaseService>(TOKENS.BuyerManualPurchaseService);
    const result = await svc.listBambooLiveWallets();
    return reply.send(result);
  });

  app.get('/approute/live-wallets', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const svc = container.resolve<BuyerManualPurchaseService>(TOKENS.BuyerManualPurchaseService);
    const result = await svc.listAppRouteLiveWallets();
    return reply.send(result);
  });

  app.get('/wgcards/live-wallets', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const svc = container.resolve<BuyerManualPurchaseService>(TOKENS.BuyerManualPurchaseService);
    const result = await svc.listWgcardsLiveWallets();
    return reply.send(result);
  });

  app.post('/recover', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<RecoverProviderOrderUseCase>(UC_TOKENS.RecoverProviderOrder);
    const body = request.body as Record<string, unknown>;
    const adminId = getAuthenticatedUserId(request);
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

  app.post('/catalog/link', { preHandler: [employeeGuard] }, async (request, reply) => {
    const parsed = parseBody(linkCatalogSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);
    const body = parsed.data;

    const uc = container.resolve<LinkCatalogProductUseCase>(UC_TOKENS.LinkCatalogProduct);
    const publishUc = container.resolve<PublishSellerListingToMarketplaceUseCase>(
      UC_TOKENS.PublishSellerListingToMarketplace,
    );
    const adminId = getAuthenticatedUserId(request);
    const publishNow = body.publish_now !== false;

    const baseResult = await uc.execute({
      variant_id: body.variant_id,
      provider_code: body.provider_code,
      external_product_id: body.external_product_id,
      ...(body.external_parent_product_id?.trim()
        ? { external_parent_product_id: body.external_parent_product_id.trim() }
        : {}),
      currency: body.currency,
      price_cents: body.price_cents,
      platform_code: body.platform_code,
      region_code: body.region_code,
      admin_id: adminId,
      ...(typeof body.create_procurement_offer === 'boolean'
        ? { create_procurement_offer: body.create_procurement_offer }
        : {}),
    });

    let marketplace_publish: LinkCatalogProductMarketplacePublishSnap | null = null;
    let marketplace_publish_error: string | null = null;

    if (
      publishNow &&
      baseResult.seller_listing_id &&
      typeof baseResult.seller_listing_id === 'string'
    ) {
      try {
        const pub = await publishUc.execute({
          listing_id: baseResult.seller_listing_id,
          admin_id: adminId,
        });
        marketplace_publish = {
          listing_id: pub.listing_id,
          external_listing_id: pub.external_listing_id,
          status: pub.status,
          skipped_already_published: pub.skipped_already_published,
        };
      } catch (err) {
        marketplace_publish_error = err instanceof Error ? err.message : 'Marketplace publish failed';
        if (err instanceof PublishBlockedError) {
          logger.info('Marketplace publish blocked (expected business condition)', {
            listing_id: baseResult.seller_listing_id,
            admin_id: adminId,
            reason: err.message,
          });
        } else {
          logger.error('Marketplace publish during catalog link failed', err as Error, {
            listing_id: baseResult.seller_listing_id,
            admin_id: adminId,
          });
        }
      }
    }

    return reply.send({
      ...baseResult,
      ...(marketplace_publish ? { marketplace_publish } : {}),
      ...(marketplace_publish_error ? { marketplace_publish_error } : {}),
    });
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
    const adminId = getAuthenticatedUserId(request);
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
    const adminId = getAuthenticatedUserId(request);
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
