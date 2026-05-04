import type { FastifyInstance } from 'fastify';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import { SecureKeyManager } from '../../infra/crypto/secure-key-manager.js';
import type { GetInventoryCatalogUseCase } from '../../core/use-cases/inventory/get-inventory-catalog.use-case.js';

function mapKeyState(keyState: string | null, isUsed: boolean): 'available' | 'reserved' | 'sold' {
  if (isUsed || keyState === 'used' || keyState === 'seller_provisioned') return 'sold';
  if (keyState === 'assigned' || keyState === 'seller_reserved') return 'reserved';
  return 'available';
}

export async function adminInventoryRoutes(app: FastifyInstance) {
  app.get('/catalog', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string; search?: string };
    const uc = container.resolve<GetInventoryCatalogUseCase>(UC_TOKENS.GetInventoryCatalog);
    const result = await uc.execute({
      limit: query.limit ? Number(query.limit) : 5000,
      offset: query.offset ? Number(query.offset) : 0,
      search: query.search,
    });
    return reply.send(result);
  });

  // GET /api/admin/inventory/keys?productId=... — list keys for product (or all)
  app.get('/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { productId?: string };
    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    let keys: Record<string, unknown>[];
    const productMap = new Map<string, string>();
    const variantProductMap = new Map<string, string>();

    if (query.productId) {
      const variants = await db.query<Record<string, unknown>>('product_variants', {
        select: 'id',
        eq: [['product_id', query.productId]],
      });
      const variantIds = variants.map(v => v.id as string);

      if (variantIds.length === 0) {
        return reply.send({ keys: [] });
      }

      const product = await db.queryOne<Record<string, unknown>>('products', {
        select: 'id, name',
        eq: [['id', query.productId]],
      });
      if (product) {
        productMap.set(product.id as string, product.name as string);
      }
      for (const v of variants) {
        variantProductMap.set(v.id as string, query.productId);
      }

      keys = await db.query<Record<string, unknown>>('product_keys', {
        select: 'id, variant_id, key_state, is_used, created_at, supplier_reference',
        in: [['variant_id', variantIds]],
      });
    } else {
      keys = await db.query<Record<string, unknown>>('product_keys', {
        select: 'id, variant_id, key_state, is_used, created_at, supplier_reference',
      });

      const allVariants = await db.query<Record<string, unknown>>('product_variants', {
        select: 'id, product_id',
      });
      const productIds = [...new Set(allVariants.map(v => v.product_id as string))];
      for (const v of allVariants) {
        variantProductMap.set(v.id as string, v.product_id as string);
      }

      if (productIds.length > 0) {
        const products = await db.query<Record<string, unknown>>('products', {
          select: 'id, name',
          in: [['id', productIds]],
        });
        for (const p of products) {
          productMap.set(p.id as string, p.name as string);
        }
      }
    }

    const mapped = keys.map(k => {
      const productId = variantProductMap.get(k.variant_id as string) ?? '';
      const productName = productMap.get(productId) ?? '';
      return {
        id: k.id as string,
        productId,
        productName,
        variantId: k.variant_id as string,
        key: '••••••••',
        status: mapKeyState(k.key_state as string | null, k.is_used as boolean),
        supplierId: '',
        supplierName: (k.supplier_reference as string) || '—',
        addedAt: (k.created_at as string) ?? '',
        locked: true,
      };
    });

    return reply.send({ keys: mapped });
  });

  // GET /api/admin/inventory/variants/:variantId/keys — list keys for variant
  app.get('/variants/:variantId/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const repo = container.resolve<{ listVariantKeys: (dto: unknown) => Promise<unknown> }>(
      Symbol.for('IAdminProductRepository'),
    );
    const { variantId } = request.params as { variantId: string };
    const query = request.query as Record<string, string | undefined>;
    const result = await repo.listVariantKeys({
      variant_id: variantId,
      status: query.status,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return reply.send(result);
  });

  // POST /api/admin/inventory/keys/upload — upload & encrypt keys
  app.post('/keys/upload', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet — requires Edge Function integration' });
  });

  app.post('/keys/replace', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/fix-states', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/decrypt', { preHandler: [adminGuard] }, async (request, reply) => {
    const body = request.body as { key_ids?: string[] };
    if (!body.key_ids || !Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }

    if (!process.env.ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: 'ENCRYPTION_MASTER_KEY is not configured on the backend-admin server.',
      });
    }

    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const rows = await db.query<{
      id: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
    }>('product_keys', {
      select: 'id, encrypted_key, encryption_iv, encryption_salt, encryption_key_id',
      in: [['id', body.key_ids]],
    });

    const decrypted: Array<{ id: string; decrypted_value: string }> = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      if (!row.encrypted_key || !row.encryption_iv || !row.encryption_salt) {
        failures.push({ id: row.id, error: 'Missing encryption data (iv/salt)' });
        continue;
      }
      try {
        const value = await SecureKeyManager.decrypt(
          row.encrypted_key,
          row.encryption_iv,
          row.encryption_salt,
          row.encryption_key_id ?? null,
        );
        decrypted.push({ id: row.id, decrypted_value: value });
      } catch (err) {
        failures.push({ id: row.id, error: (err as Error).message });
      }
    }

    if (failures.length > 0 && decrypted.length === 0) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: `All ${failures.length} key(s) failed to decrypt.`,
        failures,
      });
    }

    return reply.send({ keys: decrypted, failures: failures.length > 0 ? failures : undefined });
  });

  app.post('/keys/recrypt', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/sales-blocked', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/mark-faulty', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/link-replacement', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/variant/sales-blocked', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/manual-sell', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/emit-stock-changed', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/stock-notifications/send', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.patch('/keys/update-affected', { preHandler: [employeeGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
