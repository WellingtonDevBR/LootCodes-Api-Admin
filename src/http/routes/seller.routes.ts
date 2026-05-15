import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard, getAuthenticatedUserId } from '../middleware/auth.guard.js';
import type { ListProviderAccountsUseCase } from '../../core/use-cases/seller/list-provider-accounts.use-case.js';
import type { CreateProviderAccountUseCase } from '../../core/use-cases/seller/create-provider-account.use-case.js';
import type { UpdateProviderAccountUseCase } from '../../core/use-cases/seller/update-provider-account.use-case.js';
import type { DeleteProviderAccountUseCase } from '../../core/use-cases/seller/delete-provider-account.use-case.js';
import type { ListSellerListingsUseCase } from '../../core/use-cases/seller/list-seller-listings.use-case.js';
import type { GetVariantOffersUseCase } from '../../core/use-cases/seller/get-variant-offers.use-case.js';
import type { CreateVariantOfferUseCase } from '../../core/use-cases/seller/create-variant-offer.use-case.js';
import type { UpdateVariantOfferUseCase } from '../../core/use-cases/seller/update-variant-offer.use-case.js';
import type { DeleteVariantOfferUseCase } from '../../core/use-cases/seller/delete-variant-offer.use-case.js';
import type { CreateSellerListingUseCase } from '../../core/use-cases/seller/create-seller-listing.use-case.js';
import type { UpdateSellerListingPriceUseCase } from '../../core/use-cases/seller/update-seller-listing-price.use-case.js';
import type { ToggleSellerListingSyncUseCase } from '../../core/use-cases/seller/toggle-seller-listing-sync.use-case.js';
import type { UpdateSellerListingMinPriceUseCase } from '../../core/use-cases/seller/update-seller-listing-min-price.use-case.js';
import type { UpdateSellerListingOverridesUseCase } from '../../core/use-cases/seller/update-seller-listing-overrides.use-case.js';
import type { SetSellerListingVisibilityUseCase } from '../../core/use-cases/seller/set-seller-listing-visibility.use-case.js';
import type { DeactivateSellerListingUseCase } from '../../core/use-cases/seller/deactivate-seller-listing.use-case.js';
import type { UnlinkSellerListingMarketplaceProductUseCase } from '../../core/use-cases/seller/unlink-seller-listing-marketplace-product.use-case.js';
import type { DeleteSellerListingUseCase } from '../../core/use-cases/seller/delete-seller-listing.use-case.js';
import type { RecoverSellerListingHealthUseCase } from '../../core/use-cases/seller/recover-seller-listing-health.use-case.js';
import type { SyncSellerStockUseCase } from '../../core/use-cases/seller/sync-seller-stock.use-case.js';
import type { SetSellerListingDeclaredStockUseCase } from '../../core/use-cases/seller/set-seller-listing-declared-stock.use-case.js';
import type { FetchRemoteStockUseCase } from '../../core/use-cases/seller/fetch-remote-stock.use-case.js';
import type { PublishSellerListingToMarketplaceUseCase } from '../../core/use-cases/seller/publish-seller-listing-to-marketplace.use-case.js';
import type { BindSellerListingExternalAuctionUseCase } from '../../core/use-cases/seller/bind-seller-listing-external-auction.use-case.js';
import type { PublishSellerListingToMarketplaceResult } from '../../core/use-cases/seller/seller-listing.types.js';
import type { GetProviderAccountDetailUseCase } from '../../core/use-cases/seller/get-provider-account-detail.use-case.js';
import type { RegisterWebhooksUseCase } from '../../core/use-cases/seller/register-webhooks.use-case.js';
import type { GetWebhookStatusUseCase } from '../../core/use-cases/seller/get-webhook-status.use-case.js';
import type { BatchUpdatePricesUseCase } from '../../core/use-cases/seller/batch-update-prices.use-case.js';
import type { BatchUpdateStockUseCase } from '../../core/use-cases/seller/batch-update-stock.use-case.js';
import type { UpdateGlobalStockStatusUseCase } from '../../core/use-cases/seller/update-global-stock-status.use-case.js';
import type { EnableDeclaredStockUseCase } from '../../core/use-cases/seller/enable-declared-stock.use-case.js';
import type { EnableKeyReplacementsUseCase } from '../../core/use-cases/seller/enable-key-replacements.use-case.js';
import type { RemoveCallbackUseCase } from '../../core/use-cases/seller/remove-callback.use-case.js';
import type { ExpireReservationsUseCase } from '../../core/use-cases/seller/expire-reservations.use-case.js';
import type { ClearSellerListingErrorUseCase } from '../../core/use-cases/seller/clear-seller-listing-error.use-case.js';
import type { IAdminSellerRepository } from '../../core/ports/admin-seller-repository.port.js';
import { TOKENS } from '../../di/tokens.js';
import { createLogger } from '../../shared/logger.js';
import { z } from 'zod';
import { parseBody, replyInvalidRequestBody } from '../utils/zod-validation.js';

const logger = createLogger('admin-seller-routes');

// ─── Body schemas (single source of truth) ──────────────────────────────────

const createSellerListingSchema = z.object({
  variant_id: z.string().uuid(),
  provider_account_id: z.string().uuid(),
  price_cents: z.number().int().positive(),
  currency: z.string().min(3).max(8),
  listing_type: z.enum(['key_upload', 'declared_stock']),
  external_product_id: z.string().min(1).optional(),
  auto_sync_stock: z.boolean().optional(),
  auto_sync_price: z.boolean().optional(),
  publish_to_marketplace: z.boolean().optional(),
}).strict();

const updatePriceSchema = z.object({
  price_cents: z.number().int().positive(),
}).strict();

const toggleSyncSchema = z.object({
  sync_stock: z.boolean().optional(),
  sync_price: z.boolean().optional(),
}).strict().refine(
  (b) => b.sync_stock !== undefined || b.sync_price !== undefined,
  { message: 'At least one of sync_stock or sync_price must be provided' },
);

const updateMinPriceSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  override_cents: z.number().int().nonnegative().optional(),
}).strict();

const updateOverridesSchema = z.object({
  overrides: z.record(z.string(), z.unknown()),
}).strict();

const setVisibilitySchema = z.object({
  visibility: z.enum(['all', 'retail', 'business']),
}).strict();

const deleteListingSchema = z.object({
  deactivate_first: z.boolean().optional(),
}).strict();

const bindMarketplaceAuctionSchema = z.object({
  external_listing_id: z.string().min(1),
}).strict();

const batchUpdatePricesSchema = z.object({
  provider_account_id: z.string().uuid(),
  updates: z.array(
    z.object({
      external_listing_id: z.string().min(1),
      price_cents: z.number().int().positive(),
    }),
  ).min(1),
}).strict();

export async function adminSellerRoutes(app: FastifyInstance) {
  // --- Provider Accounts ---

  app.get('/provider-accounts', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListProviderAccountsUseCase>(UC_TOKENS.ListProviderAccounts);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.get('/provider-accounts/:id', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetProviderAccountDetailUseCase>(UC_TOKENS.GetProviderAccountDetail);
    const { id } = request.params as { id: string };
    try {
      const result = await uc.execute(id);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Provider account not found';
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message });
      }
      throw err;
    }
  });

  app.post('/provider-accounts', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<CreateProviderAccountUseCase>(UC_TOKENS.CreateProviderAccount);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      provider_code: body.provider_code as string,
      display_name: body.display_name as string,
      is_enabled: body.is_enabled as boolean | undefined,
      priority: body.priority as number | undefined,
      api_profile: body.api_profile as Record<string, unknown> | undefined,
      supports_catalog: body.supports_catalog as boolean | undefined,
      supports_quote: body.supports_quote as boolean | undefined,
      supports_purchase: body.supports_purchase as boolean | undefined,
      supports_callback: body.supports_callback as boolean | undefined,
      supports_seller: body.supports_seller as boolean | undefined,
      seller_config: body.seller_config as Record<string, unknown> | undefined,
      procurement_config: body.procurement_config as Record<string, unknown> | undefined,
      prioritize_quote_sync: body.prioritize_quote_sync as boolean | undefined,
    });
    return reply.status(201).send(result);
  });

  app.patch('/provider-accounts/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateProviderAccountUseCase>(UC_TOKENS.UpdateProviderAccount);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const CORE_KEYS = [
      'display_name', 'is_enabled', 'priority', 'prioritize_quote_sync',
      'supports_catalog', 'supports_quote', 'supports_purchase', 'supports_callback',
      'supports_seller', 'health_status',
    ] as const;

    const core = body.core != null
      ? (body.core as Record<string, unknown>)
      : body;

    const sellerConfigPatch = body.seller_config as Record<string, unknown> | undefined;
    const procurementConfigPatch = body.procurement_config as Record<string, unknown> | undefined;
    const apiProfilePatch = body.api_profile as Record<string, unknown> | undefined;

    const dto: Record<string, unknown> = { id };

    for (const key of CORE_KEYS) {
      if (core[key] !== undefined) dto[key] = core[key];
    }

    if (sellerConfigPatch) dto.seller_config = sellerConfigPatch;
    if (procurementConfigPatch) dto.procurement_config = procurementConfigPatch;
    if (apiProfilePatch) dto.api_profile = apiProfilePatch;

    const result = await uc.execute(dto as unknown as import('../../core/use-cases/seller/seller.types.js').UpdateProviderAccountDto);
    return reply.send(result);
  });

  app.delete('/provider-accounts/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<DeleteProviderAccountUseCase>(UC_TOKENS.DeleteProviderAccount);
    const { id } = request.params as { id: string };
    await uc.execute(id);
    return reply.status(204).send();
  });

  // --- Provider Account Webhooks ---

  app.get('/provider-accounts/:id/webhooks', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetWebhookStatusUseCase>(UC_TOKENS.GetWebhookStatus);
    const { id } = request.params as { id: string };
    try {
      const result = await uc.execute(id);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Provider account not found';
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message });
      }
      logger.error('GetProviderAccountDetail failed', err as Error, { provider_account_id: id });
      throw err;
    }
  });

  app.post('/provider-accounts/:id/webhooks', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<RegisterWebhooksUseCase>(UC_TOKENS.RegisterWebhooks);
    const { id } = request.params as { id: string };
    try {
      const result = await uc.execute(id);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register webhooks';
      logger.error('RegisterWebhooks failed', err as Error, { provider_account_id: id });
      return reply.status(500).send({ error: message });
    }
  });

  // --- Seller Listings ---

  app.get('/listings/:variantId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListSellerListingsUseCase>(UC_TOKENS.ListSellerListings);
    const { variantId } = request.params as { variantId: string };
    const result = await uc.execute({ variant_id: variantId });
    return reply.send(result);
  });

  // --- Variant Offers ---

  app.get('/offers/:variantId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetVariantOffersUseCase>(UC_TOKENS.GetVariantOffers);
    const { variantId } = request.params as { variantId: string };
    const result = await uc.execute({ variant_id: variantId });
    return reply.send(result);
  });

  app.post('/offers', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<CreateVariantOfferUseCase>(UC_TOKENS.CreateVariantOffer);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_account_id: body.provider_account_id as string,
      external_sku: body.external_sku as string | undefined,
      external_offer_id: body.external_offer_id as string | undefined,
      external_platform_code: body.external_platform_code as string | undefined,
      external_region_code: body.external_region_code as string | undefined,
      currency: body.currency as string | undefined,
      is_active: body.is_active as boolean | undefined,
    });
    return reply.status(201).send(result);
  });

  app.patch('/offers/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateVariantOfferUseCase>(UC_TOKENS.UpdateVariantOffer);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({ id, ...body });
    return reply.send(result);
  });

  app.delete('/offers/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<DeleteVariantOfferUseCase>(UC_TOKENS.DeleteVariantOffer);
    const { id } = request.params as { id: string };
    await uc.execute(id);
    return reply.status(204).send();
  });

  // --- Seller Listing Mutations ---

  app.post('/listings', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(createSellerListingSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);
    const body = parsed.data;

    const createUc = container.resolve<CreateSellerListingUseCase>(UC_TOKENS.CreateSellerListing);
    const publishUc = container.resolve<PublishSellerListingToMarketplaceUseCase>(
      UC_TOKENS.PublishSellerListingToMarketplace,
    );
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const external_product_id = body.external_product_id?.trim() || undefined;
    const publishToMarketplace = Boolean(external_product_id) && body.publish_to_marketplace !== false;

    const result = await createUc.execute({
      variant_id: body.variant_id,
      provider_account_id: body.provider_account_id,
      price_cents: body.price_cents,
      currency: body.currency,
      listing_type: body.listing_type,
      ...(external_product_id ? { external_product_id } : {}),
      auto_sync_stock: body.auto_sync_stock,
      auto_sync_price: body.auto_sync_price,
      admin_id,
    });

    let marketplace_publish: PublishSellerListingToMarketplaceResult | null = null;
    let marketplace_publish_error: string | null = null;
    if (publishToMarketplace && result.listing_id) {
      try {
        marketplace_publish = await publishUc.execute({
          listing_id: result.listing_id,
          admin_id,
        });
      } catch (err) {
        marketplace_publish_error = err instanceof Error ? err.message : 'Marketplace publish failed';
        logger.error('Marketplace publish during listing creation failed', err as Error, {
          listing_id: result.listing_id,
          admin_id,
        });
      }
    }

    return reply.status(201).send({
      ...result,
      ...(marketplace_publish ? { marketplace_publish } : {}),
      ...(marketplace_publish_error ? { marketplace_publish_error } : {}),
    });
  });

  app.post('/listings/:id/publish-marketplace', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<PublishSellerListingToMarketplaceUseCase>(
      UC_TOKENS.PublishSellerListingToMarketplace,
    );
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    try {
      const result = await uc.execute({ listing_id: id, admin_id });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Marketplace publish failed';
      logger.error('PublishSellerListingToMarketplace failed', err as Error, { listing_id: id, admin_id });
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/listings/:id/bind-marketplace-auction', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(bindMarketplaceAuctionSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<BindSellerListingExternalAuctionUseCase>(
      UC_TOKENS.BindSellerListingExternalAuction,
    );
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    try {
      const result = await uc.execute({
        listing_id: id,
        external_listing_id: parsed.data.external_listing_id,
        admin_id,
      });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bind auction failed';
      logger.error('BindSellerListingExternalAuction failed', err as Error, {
        listing_id: id,
        admin_id,
      });
      return reply.status(400).send({ error: message });
    }
  });

  app.patch('/listings/:id/price', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(updatePriceSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<UpdateSellerListingPriceUseCase>(UC_TOKENS.UpdateSellerListingPrice);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      price_cents: parsed.data.price_cents,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/sync', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(toggleSyncSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<ToggleSellerListingSyncUseCase>(UC_TOKENS.ToggleSellerListingSync);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      sync_stock: parsed.data.sync_stock,
      sync_price: parsed.data.sync_price,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/min-price', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(updateMinPriceSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<UpdateSellerListingMinPriceUseCase>(UC_TOKENS.UpdateSellerListingMinPrice);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      mode: parsed.data.mode,
      override_cents: parsed.data.override_cents,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/overrides', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(updateOverridesSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<UpdateSellerListingOverridesUseCase>(UC_TOKENS.UpdateSellerListingOverrides);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      overrides: parsed.data.overrides,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/visibility', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(setVisibilitySchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<SetSellerListingVisibilityUseCase>(UC_TOKENS.SetSellerListingVisibility);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      visibility: parsed.data.visibility,
      admin_id,
    });
    return reply.send(result);
  });

  app.post('/listings/:id/deactivate', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<DeactivateSellerListingUseCase>(UC_TOKENS.DeactivateSellerListing);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({ listing_id: id, admin_id });
    return reply.send(result);
  });

  app.post('/listings/:id/unlink-marketplace-product', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UnlinkSellerListingMarketplaceProductUseCase>(
      UC_TOKENS.UnlinkSellerListingMarketplaceProduct,
    );
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({ listing_id: id, admin_id });
    return reply.send(result);
  });

  app.delete('/listings/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(deleteListingSchema, request.body ?? {});
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<DeleteSellerListingUseCase>(UC_TOKENS.DeleteSellerListing);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    await uc.execute({
      listing_id: id,
      deactivate_first: parsed.data.deactivate_first,
      admin_id,
    });
    return reply.status(204).send();
  });

  app.post('/listings/:id/recover-health', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<RecoverSellerListingHealthUseCase>(UC_TOKENS.RecoverSellerListingHealth);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      reset_metrics: body.reset_metrics as boolean | undefined,
      clear_pause_message: body.clear_pause_message as boolean | undefined,
      resume_active: body.resume_active as boolean | undefined,
      admin_id,
    });
    return reply.send(result);
  });

  app.post('/listings/:id/sync-stock', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<SyncSellerStockUseCase>(UC_TOKENS.SyncSellerStock);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({ listing_id: id, admin_id });
    return reply.send(result);
  });

  // Operator-driven manual declared-stock update for a single listing.
  // Pushes through the marketplace adapter (vendor quirks like Eneba 0→null
  // are handled inside each adapter) and persists `manual_declared_stock` +
  // `declared_stock` on success.
  app.patch('/listings/:id/declared-stock', { preHandler: [adminGuard] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const quantityRaw = body.quantity;
    if (typeof quantityRaw !== 'number' || !Number.isFinite(quantityRaw) || !Number.isInteger(quantityRaw) || quantityRaw < 0) {
      return reply.status(400).send({ error: 'quantity must be a non-negative integer' });
    }

    const uc = container.resolve<SetSellerListingDeclaredStockUseCase>(
      UC_TOKENS.SetSellerListingDeclaredStock,
    );
    const admin_id = getAuthenticatedUserId(request);
    try {
      const result = await uc.execute({ listing_id: id, quantity: quantityRaw, admin_id });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Manual declared-stock update failed';
      logger.error('SetSellerListingDeclaredStock failed', err as Error, {
        listing_id: id,
        quantity: quantityRaw,
        admin_id,
      });
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/listings/:id/remote-stock', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<FetchRemoteStockUseCase>(UC_TOKENS.FetchRemoteStock);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({ listing_id: id, admin_id });
    return reply.send(result);
  });

  app.post('/listings/:id/clear-error', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ClearSellerListingErrorUseCase>(UC_TOKENS.ClearSellerListingError);
    const { id } = request.params as { id: string };
    await uc.execute(id);
    return reply.send({ ok: true });
  });

  // ─── Monitoring Endpoints ────────────────────────────────────────────

  app.get('/webhook-events', { preHandler: [employeeGuard] }, async (request, reply) => {
    const repo = container.resolve<IAdminSellerRepository>(TOKENS.AdminSellerRepository);
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);
    const { events } = await repo.listSellerWebhookEvents({
      limit,
      offset,
      provider_code: query.provider_code,
    });
    return reply.send({ events, limit, offset });
  });

  app.get('/active-reservations', { preHandler: [employeeGuard] }, async (request, reply) => {
    const repo = container.resolve<IAdminSellerRepository>(TOKENS.AdminSellerRepository);
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const { reservations } = await repo.listActiveSellerReservations({ limit });
    return reply.send({ reservations });
  });

  app.get('/provision-history', { preHandler: [employeeGuard] }, async (request, reply) => {
    const repo = container.resolve<IAdminSellerRepository>(TOKENS.AdminSellerRepository);
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);
    const { provisions } = await repo.listSellerProvisionHistory({ limit, offset });
    return reply.send({ provisions, limit, offset });
  });

  app.get('/marketplace-health', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const repo = container.resolve<IAdminSellerRepository>(TOKENS.AdminSellerRepository);
    const [{ listings }, { reservations }] = await Promise.all([
      repo.listSellerMarketplaceHealth(),
      repo.listActiveSellerReservations({ limit: 1000 }),
    ]);
    return reply.send({
      activeListings: listings.length,
      pendingReservations: reservations.length,
      listings,
    });
  });

  // ─── Batch Operations ──────────────────────────────────────────────

  app.post('/listings/batch-prices', { preHandler: [adminGuard] }, async (request, reply) => {
    const parsed = parseBody(batchUpdatePricesSchema, request.body);
    if (parsed.kind === 'error') return replyInvalidRequestBody(reply, parsed.issues);

    const uc = container.resolve<BatchUpdatePricesUseCase>(UC_TOKENS.BatchUpdatePrices);
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      provider_account_id: parsed.data.provider_account_id,
      updates: [...parsed.data.updates],
      admin_id,
    });
    return reply.send(result);
  });

  app.post('/listings/batch-stock', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<BatchUpdateStockUseCase>(UC_TOKENS.BatchUpdateStock);
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      provider_account_id: body.provider_account_id as string,
      updates: body.updates as Array<{ external_listing_id: string; quantity: number }>,
      admin_id,
    });
    return reply.send(result);
  });

  app.post('/listings/global-stock-status', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateGlobalStockStatusUseCase>(UC_TOKENS.UpdateGlobalStockStatus);
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      provider_account_id: body.provider_account_id as string,
      enabled: body.enabled as boolean,
      admin_id,
    });
    return reply.send(result);
  });

  // ─── Account-Level Toggles ─────────────────────────────────────────

  app.post('/provider-accounts/:id/enable-declared-stock', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<EnableDeclaredStockUseCase>(UC_TOKENS.EnableDeclaredStock);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    try {
      const result = await uc.execute({ provider_account_id: id, admin_id });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enable declared stock';
      logger.error('EnableDeclaredStock failed', err as Error, { provider_account_id: id, admin_id });
      return reply.status(400).send({ error: message });
    }
  });

  app.post('/provider-accounts/:id/enable-key-replacements', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<EnableKeyReplacementsUseCase>(UC_TOKENS.EnableKeyReplacements);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    try {
      const result = await uc.execute({ provider_account_id: id, admin_id });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to enable key replacements';
      logger.error('EnableKeyReplacements failed', err as Error, { provider_account_id: id, admin_id });
      return reply.status(400).send({ error: message });
    }
  });

  // ─── Callback Management ───────────────────────────────────────────

  app.delete('/provider-accounts/:id/webhooks/:callbackId', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<RemoveCallbackUseCase>(UC_TOKENS.RemoveCallback);
    const { id, callbackId } = request.params as { id: string; callbackId: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    try {
      const result = await uc.execute({ provider_account_id: id, callback_id: callbackId, admin_id });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove callback';
      logger.error('RemoveCallback failed', err as Error, {
        provider_account_id: id,
        callback_id: callbackId,
        admin_id,
      });
      return reply.status(400).send({ error: message });
    }
  });

  // ─── Reservation Expiry ────────────────────────────────────────────

  app.post('/expire-reservations', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ExpireReservationsUseCase>(UC_TOKENS.ExpireReservations);
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({ admin_id });
    return reply.send(result);
  });
}
