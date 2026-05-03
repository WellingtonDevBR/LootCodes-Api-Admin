import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { employeeGuard } from '../middleware/auth.guard.js';
import type { ListProviderAccountsUseCase } from '../../core/use-cases/seller/list-provider-accounts.use-case.js';
import type { ListSellerListingsUseCase } from '../../core/use-cases/seller/list-seller-listings.use-case.js';
import type { GetVariantOffersUseCase } from '../../core/use-cases/seller/get-variant-offers.use-case.js';

export async function adminSellerRoutes(app: FastifyInstance) {
  app.get('/provider-accounts', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<ListProviderAccountsUseCase>(UC_TOKENS.ListProviderAccounts);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.get('/listings/:variantId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListSellerListingsUseCase>(UC_TOKENS.ListSellerListings);
    const { variantId } = request.params as { variantId: string };
    const result = await uc.execute({ variant_id: variantId });
    return reply.send(result);
  });

  app.get('/offers/:variantId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetVariantOffersUseCase>(UC_TOKENS.GetVariantOffers);
    const { variantId } = request.params as { variantId: string };
    const result = await uc.execute({ variant_id: variantId });
    return reply.send(result);
  });
}
