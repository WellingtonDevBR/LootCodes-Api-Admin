import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { ListProductsUseCase } from '../../core/use-cases/products/list-products.use-case.js';
import type { GetProductUseCase } from '../../core/use-cases/products/get-product.use-case.js';
import type { CreateProductUseCase } from '../../core/use-cases/products/create-product.use-case.js';
import type { UpdateProductUseCase } from '../../core/use-cases/products/update-product.use-case.js';
import type { DeleteProductUseCase } from '../../core/use-cases/products/delete-product.use-case.js';
import type { CreateVariantUseCase } from '../../core/use-cases/products/create-variant.use-case.js';
import type { UpdateVariantUseCase } from '../../core/use-cases/products/update-variant.use-case.js';

export async function adminProductRoutes(app: FastifyInstance) {
  // GET /api/admin/products — list with search, filters, pagination
  app.get('/', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<ListProductsUseCase>(UC_TOKENS.ListProducts);
    const query = request.query as Record<string, string | undefined>;
    const result = await uc.execute({
      search: query.search,
      product_type: query.product_type,
      is_active: query.is_active === undefined ? undefined : query.is_active === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return reply.send(result);
  });

  // GET /api/admin/products/metadata — platforms, regions, genres
  app.get('/metadata', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const repo = container.resolve<{ listMetadata: () => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const result = await repo.listMetadata();
    return reply.send(result);
  });

  // GET /api/admin/products/featured — featured products
  app.get('/featured', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const repo = container.resolve<{ listFeatured: () => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const result = await repo.listFeatured();
    return reply.send(result);
  });

  // GET /api/admin/products/:productId — single product with variants
  app.get('/:productId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const uc = container.resolve<GetProductUseCase>(UC_TOKENS.GetProduct);
    const { productId } = request.params as { productId: string };
    const result = await uc.execute({ product_id: productId });
    return reply.send(result);
  });

  // POST /api/admin/products — create product
  app.post('/', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<CreateProductUseCase>(UC_TOKENS.CreateProduct);
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({ ...body, admin_id: adminId } as Parameters<CreateProductUseCase['execute']>[0]);
    return reply.status(201).send(result);
  });

  // PUT /api/admin/products/:productId — update product
  app.put('/:productId', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateProductUseCase>(UC_TOKENS.UpdateProduct);
    const { productId } = request.params as { productId: string };
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      product_id: productId,
      ...body,
      admin_id: adminId,
    } as Parameters<UpdateProductUseCase['execute']>[0]);
    return reply.send(result);
  });

  // DELETE /api/admin/products/:productId — delete product
  app.delete('/:productId', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<DeleteProductUseCase>(UC_TOKENS.DeleteProduct);
    const { productId } = request.params as { productId: string };
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({ product_id: productId, admin_id: adminId });
    return reply.send(result);
  });

  // POST /api/admin/products/:productId/toggle-active — activate/deactivate
  app.post('/:productId/toggle-active', { preHandler: [adminGuard] }, async (request, reply) => {
    const repo = container.resolve<{ toggleProductActive: (dto: unknown) => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const { productId } = request.params as { productId: string };
    const body = request.body as { is_active: boolean };
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await repo.toggleProductActive({
      product_id: productId,
      is_active: body.is_active,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  // POST /api/admin/products/:productId/featured-flags — update featured flags
  app.post('/:productId/featured-flags', { preHandler: [adminGuard] }, async (request, reply) => {
    const repo = container.resolve<{ updateFeaturedFlags: (dto: unknown) => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const { productId } = request.params as { productId: string };
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await repo.updateFeaturedFlags({
      product_id: productId,
      ...body,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  // POST /api/admin/products/:productId/variants — create variant
  app.post('/:productId/variants', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<CreateVariantUseCase>(UC_TOKENS.CreateVariant);
    const { productId } = request.params as { productId: string };
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      product_id: productId,
      ...body,
      admin_id: adminId,
    } as Parameters<CreateVariantUseCase['execute']>[0]);
    return reply.status(201).send(result);
  });

  // PUT /api/admin/products/variants/:variantId — update variant
  app.put('/variants/:variantId', { preHandler: [adminGuard] }, async (request, reply) => {
    const uc = container.resolve<UpdateVariantUseCase>(UC_TOKENS.UpdateVariant);
    const { variantId } = request.params as { variantId: string };
    const body = request.body as Record<string, unknown>;
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await uc.execute({
      variant_id: variantId,
      ...body,
      admin_id: adminId,
    } as Parameters<UpdateVariantUseCase['execute']>[0]);
    return reply.send(result);
  });

  // DELETE /api/admin/products/variants/:variantId — delete variant
  app.delete('/variants/:variantId', { preHandler: [adminGuard] }, async (request, reply) => {
    const repo = container.resolve<{ deleteVariant: (dto: unknown) => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const { variantId } = request.params as { variantId: string };
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await repo.deleteVariant({
      variant_id: variantId,
      admin_id: adminId,
    });
    return reply.send(result);
  });

  // POST /api/admin/products/variants/:variantId/toggle-active — activate/deactivate variant
  app.post('/variants/:variantId/toggle-active', { preHandler: [adminGuard] }, async (request, reply) => {
    const repo = container.resolve<{ toggleVariantActive: (dto: unknown) => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const { variantId } = request.params as { variantId: string };
    const body = request.body as { is_active: boolean };
    const adminId = (request as unknown as Record<string, string>).adminUserId ?? 'unknown';
    const result = await repo.toggleVariantActive({
      variant_id: variantId,
      is_active: body.is_active,
      admin_id: adminId,
    });
    return reply.send(result);
  });
}
