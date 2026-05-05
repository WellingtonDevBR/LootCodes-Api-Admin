import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
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
import type { DeleteSellerListingUseCase } from '../../core/use-cases/seller/delete-seller-listing.use-case.js';
import type { RecoverSellerListingHealthUseCase } from '../../core/use-cases/seller/recover-seller-listing-health.use-case.js';
import type { SyncSellerStockUseCase } from '../../core/use-cases/seller/sync-seller-stock.use-case.js';
import type { FetchRemoteStockUseCase } from '../../core/use-cases/seller/fetch-remote-stock.use-case.js';
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
import type { IDatabase } from '../../core/ports/database.port.js';
import { TOKENS } from '../../di/tokens.js';

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

    const dto: Record<string, unknown> = { id };

    for (const key of CORE_KEYS) {
      if (core[key] !== undefined) dto[key] = core[key];
    }

    if (sellerConfigPatch) dto.seller_config = sellerConfigPatch;
    if (procurementConfigPatch) dto.procurement_config = procurementConfigPatch;

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
    const uc = container.resolve<CreateSellerListingUseCase>(UC_TOKENS.CreateSellerListing);
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      provider_account_id: body.provider_account_id as string,
      price_cents: body.price_cents as number,
      currency: body.currency as string,
      listing_type: body.listing_type as 'key_upload' | 'declared_stock',
      external_product_id: body.external_product_id as string | undefined,
      auto_sync_stock: body.auto_sync_stock as boolean | undefined,
      auto_sync_price: body.auto_sync_price as boolean | undefined,
      admin_id,
    });
    return reply.status(201).send(result);
  });

  app.patch('/listings/:id/price', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateSellerListingPriceUseCase>(UC_TOKENS.UpdateSellerListingPrice);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      price_cents: body.price_cents as number,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/sync', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ToggleSellerListingSyncUseCase>(UC_TOKENS.ToggleSellerListingSync);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      sync_stock: body.sync_stock as boolean | undefined,
      sync_price: body.sync_price as boolean | undefined,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/min-price', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateSellerListingMinPriceUseCase>(UC_TOKENS.UpdateSellerListingMinPrice);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      mode: body.mode as 'auto' | 'manual',
      override_cents: body.override_cents as number | undefined,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/overrides', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateSellerListingOverridesUseCase>(UC_TOKENS.UpdateSellerListingOverrides);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      overrides: body.overrides as Record<string, unknown>,
      admin_id,
    });
    return reply.send(result);
  });

  app.patch('/listings/:id/visibility', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<SetSellerListingVisibilityUseCase>(UC_TOKENS.SetSellerListingVisibility);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      listing_id: id,
      visibility: body.visibility as 'all' | 'retail' | 'business',
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

  app.delete('/listings/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<DeleteSellerListingUseCase>(UC_TOKENS.DeleteSellerListing);
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    await uc.execute({
      listing_id: id,
      deactivate_first: body.deactivate_first as boolean | undefined,
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

  app.post('/listings/:id/remote-stock', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<FetchRemoteStockUseCase>(UC_TOKENS.FetchRemoteStock);
    const { id } = request.params as { id: string };
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({ listing_id: id, admin_id });
    return reply.send(result);
  });

  // ─── Monitoring Endpoints ────────────────────────────────────────────

  app.get('/webhook-events', { preHandler: [employeeGuard] }, async (request, reply) => {
    const db = container.resolve<IDatabase>(TOKENS.Database);
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);
    const providerCode = query.provider_code;

    const options: import('../../core/ports/database.port.js').QueryOptions = {
      select: 'id, event_type, aggregate_id, payload, created_at',
      order: { column: 'created_at', ascending: false },
      limit,
      range: [offset, offset + limit - 1],
    };

    if (providerCode) {
      options.ilike = [['event_type', `seller.%`]];
    } else {
      options.ilike = [['event_type', `seller.%`]];
    }

    const events = await db.query('domain_events', options);
    return reply.send({ events, limit, offset });
  });

  app.get('/active-reservations', { preHandler: [employeeGuard] }, async (request, reply) => {
    const db = container.resolve<IDatabase>(TOKENS.Database);
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);

    const reservations = await db.query('seller_stock_reservations', {
      select: 'id, seller_listing_id, status, quantity, external_order_id, expires_at, created_at, provider_metadata',
      eq: [['status', 'pending']],
      order: { column: 'created_at', ascending: false },
      limit,
    });

    return reply.send({ reservations });
  });

  app.get('/provision-history', { preHandler: [employeeGuard] }, async (request, reply) => {
    const db = container.resolve<IDatabase>(TOKENS.Database);
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);

    const provisions = await db.query('seller_key_provisions', {
      select: 'id, reservation_id, product_key_id, status, created_at',
      order: { column: 'created_at', ascending: false },
      limit,
      range: [offset, offset + limit - 1],
    });

    return reply.send({ provisions, limit, offset });
  });

  app.get('/marketplace-health', { preHandler: [employeeGuard] }, async (request, reply) => {
    const db = container.resolve<IDatabase>(TOKENS.Database);

    const listings = await db.query<{
      id: string;
      external_listing_id: string;
      status: string;
      provider_account_id: string;
      listing_type: string;
      last_synced_at: string | null;
      error_message: string | null;
      reservation_success_count: number;
      reservation_failure_count: number;
      provision_success_count: number;
      provision_failure_count: number;
    }>('seller_listings', {
      select: 'id, external_listing_id, status, provider_account_id, listing_type, last_synced_at, error_message, reservation_success_count, reservation_failure_count, provision_success_count, provision_failure_count',
      eq: [['status', 'active']],
      order: { column: 'updated_at', ascending: false },
      limit: 100,
    });

    const pendingReservations = await db.query<{ id: string }>('seller_stock_reservations', {
      select: 'id',
      eq: [['status', 'pending']],
    });

    return reply.send({
      activeListings: listings.length,
      pendingReservations: pendingReservations.length,
      listings,
    });
  });

  // ─── Batch Operations ──────────────────────────────────────────────

  app.post('/listings/batch-prices', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<BatchUpdatePricesUseCase>(UC_TOKENS.BatchUpdatePrices);
    const body = request.body as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      provider_account_id: body.provider_account_id as string,
      updates: body.updates as Array<{ external_listing_id: string; price_cents: number }>,
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
      return reply.status(400).send({ error: message });
    }
  });

  // ─── Reservation Expiry ────────────────────────────────────────────

  app.post('/expire-reservations', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<ExpireReservationsUseCase>(UC_TOKENS.ExpireReservations);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const admin_id = (request as unknown as Record<string, unknown>).adminId as string;
    const result = await uc.execute({
      admin_id,
      max_age_minutes: body.max_age_minutes as number | undefined,
    });
    return reply.send(result);
  });
}
