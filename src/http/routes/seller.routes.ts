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

export async function adminSellerRoutes(app: FastifyInstance) {
  // --- Provider Accounts ---

  app.get('/provider-accounts', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListProviderAccountsUseCase>(UC_TOKENS.ListProviderAccounts);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.post('/provider-accounts', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<CreateProviderAccountUseCase>(UC_TOKENS.CreateProviderAccount);
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({
      provider_code: body.provider_code as string,
      display_name: body.display_name as string,
      is_enabled: body.is_enabled as boolean | undefined,
      priority: body.priority as number | undefined,
      supports_catalog: body.supports_catalog as boolean | undefined,
      supports_quote: body.supports_quote as boolean | undefined,
      supports_purchase: body.supports_purchase as boolean | undefined,
      supports_callback: body.supports_callback as boolean | undefined,
      supports_seller: body.supports_seller as boolean | undefined,
      seller_config: body.seller_config as Record<string, unknown> | undefined,
      procurement_config: body.procurement_config as Record<string, unknown> | undefined,
    });
    return reply.status(201).send(result);
  });

  app.patch('/provider-accounts/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateProviderAccountUseCase>(UC_TOKENS.UpdateProviderAccount);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const result = await uc.execute({ id, ...body });
    return reply.send(result);
  });

  app.delete('/provider-accounts/:id', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<DeleteProviderAccountUseCase>(UC_TOKENS.DeleteProviderAccount);
    const { id } = request.params as { id: string };
    await uc.execute(id);
    return reply.status(204).send();
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
}
