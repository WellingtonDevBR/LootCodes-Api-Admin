import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard, getAuthenticatedUserId } from '../middleware/auth.guard.js';
import type { LinkVariantInventorySourceUseCase } from '../../core/use-cases/inventory-sources/link-variant-inventory-source.use-case.js';
import type { UnlinkVariantInventorySourceUseCase } from '../../core/use-cases/inventory-sources/unlink-variant-inventory-source.use-case.js';
import type { ListVariantInventorySourcesUseCase } from '../../core/use-cases/inventory-sources/list-variant-inventory-sources.use-case.js';
import type { ListLinkableInventorySourcesUseCase } from '../../core/use-cases/inventory-sources/list-linkable-inventory-sources.use-case.js';

export async function adminInventorySourceRoutes(app: FastifyInstance) {
  app.post('/link', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<LinkVariantInventorySourceUseCase>(UC_TOKENS.LinkVariantInventorySource);
    const body = request.body as Record<string, unknown>;
    const adminId = getAuthenticatedUserId(request);
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      source_id: body.source_id as string,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.post('/unlink', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UnlinkVariantInventorySourceUseCase>(UC_TOKENS.UnlinkVariantInventorySource);
    const body = request.body as Record<string, unknown>;
    const adminId = getAuthenticatedUserId(request);
    const result = await uc.execute({
      variant_id: body.variant_id as string,
      source_id: body.source_id as string,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  app.get('/', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListVariantInventorySourcesUseCase>(UC_TOKENS.ListVariantInventorySources);
    const query = request.query as Record<string, string>;
    const result = await uc.execute({ variant_id: query.variant_id });
    return reply.send(result);
  });

  app.get('/linkable', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListLinkableInventorySourcesUseCase>(UC_TOKENS.ListLinkableInventorySources);
    const query = request.query as Record<string, string>;
    const result = await uc.execute({ variant_id: query.variant_id });
    return reply.send(result);
  });
}
