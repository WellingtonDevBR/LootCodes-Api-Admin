import type { FastifyInstance, FastifyRequest } from 'fastify';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { getEnv } from '../../config/env.js';
import type { GetInventoryCatalogUseCase } from '../../core/use-cases/inventory/get-inventory-catalog.use-case.js';
import type { UploadKeysUseCase } from '../../core/use-cases/inventory/upload-keys.use-case.js';
import type { MarkKeysFaultyUseCase } from '../../core/use-cases/inventory/mark-keys-faulty.use-case.js';
import type { GetVariantContextUseCase } from '../../core/use-cases/inventory/get-variant-context.use-case.js';
import type { GetInventoryKpisUseCase } from '../../core/use-cases/inventory/get-inventory-kpis.use-case.js';
import type { ListKeysUseCase } from '../../core/use-cases/inventory/list-keys.use-case.js';
import type { ListVariantKeysUseCase } from '../../core/use-cases/inventory/list-variant-keys.use-case.js';
import type { LookupKeysByValueUseCase } from '../../core/use-cases/inventory/lookup-keys-by-value.use-case.js';
import type { BulkBurnKeysUseCase } from '../../core/use-cases/inventory/bulk-burn-keys.use-case.js';
import type { ManualSellKeysUseCase } from '../../core/use-cases/inventory/manual-sell-keys.use-case.js';
import type { DecryptKeysWithAuditUseCase } from '../../core/use-cases/inventory/decrypt-keys-with-audit.use-case.js';
import type { ExportKeysUseCase } from '../../core/use-cases/inventory/export-keys.use-case.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('admin-inventory-routes');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECRYPT_MAX_BATCH = 50;
const BULK_STATE_MAX_BATCH = 100;
const EXPORT_MAX_BATCH = 500;

const ALLOWED_BULK_STATES = ['faulty', 'burnt'] as const;
type AllowedBulkState = typeof ALLOWED_BULK_STATES[number];

interface AuthUser { id: string; email?: string }

function getAuthUser(request: FastifyRequest): AuthUser | undefined {
  return (request as unknown as { authUser?: AuthUser }).authUser;
}

export async function adminInventoryRoutes(app: FastifyInstance) {
  app.get('/kpis', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetInventoryKpisUseCase>(UC_TOKENS.GetInventoryKpis);
    const result = await uc.execute();
    reply.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return reply.send(result);
  });

  app.get('/catalog', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string; search?: string };
    const uc = container.resolve<GetInventoryCatalogUseCase>(UC_TOKENS.GetInventoryCatalog);
    const result = await uc.execute({
      limit: query.limit ? Number(query.limit) : 5000,
      offset: query.offset ? Number(query.offset) : 0,
      search: query.search,
    });
    reply.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return reply.send(result);
  });

  app.get('/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as {
      productId?: string;
      variantId?: string;
      state?: string;
      page?: string;
      pageSize?: string;
      search?: string;
    };
    const uc = container.resolve<ListKeysUseCase>(UC_TOKENS.ListKeys);
    const result = await uc.execute({
      productId: query.productId,
      variantId: query.variantId,
      state: query.state,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
      search: query.search,
    });
    return reply.send(result);
  });

  app.get('/variants/:variantId/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { variantId } = request.params as { variantId: string };
    const query = request.query as Record<string, string | undefined>;

    const uc = container.resolve<ListVariantKeysUseCase>(UC_TOKENS.ListVariantKeys);
    const result = await uc.execute({
      variant_id: variantId,
      key_state: query.key_state,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    return reply.send(result);
  });

  app.post('/keys/upload', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as {
      variant_id?: string;
      keys?: unknown;
      purchase_cost?: number;
      purchase_currency?: string;
      price_mode?: 'total' | 'per_key';
      supplier_reference?: string;
      marketplace_eligible?: boolean;
      allowed_seller_provider_account_ids?: string[];
      allow_duplicates?: boolean;
    };

    if (!body.variant_id || !UUID_RE.test(body.variant_id)) {
      return reply.code(400).send({ error: 'Valid variant_id is required' });
    }
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return reply.code(400).send({ error: 'keys array is required and must not be empty' });
    }

    if (!getEnv().ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'ENCRYPTION_FAILED',
        message: 'Server encryption configuration is unavailable.',
      });
    }

    const authUser = getAuthUser(request);
    const uc = container.resolve<UploadKeysUseCase>(UC_TOKENS.UploadKeys);

    try {
      const result = await uc.execute({
        variant_id: body.variant_id,
        keys: body.keys as string[],
        purchase_cost: body.purchase_cost,
        purchase_currency: body.purchase_currency,
        price_mode: body.price_mode,
        supplier_reference: body.supplier_reference ?? null,
        marketplace_eligible: body.marketplace_eligible,
        allowed_seller_provider_account_ids: body.allowed_seller_provider_account_ids ?? null,
        allow_duplicates: body.allow_duplicates,
        admin_user_id: authUser?.id ?? 'unknown',
        admin_email: authUser?.email ?? null,
        client_ip: request.ip,
        user_agent: (request.headers['user-agent'] as string) ?? null,
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Maximum ')) {
        return reply.code(400).send({ error: err.message });
      }
      logger.error('Key upload failed', err as Error, { variant_id: body.variant_id });
      return reply.code(500).send({ error: 'Key upload failed' });
    }
  });

  app.post('/keys/replace', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/fix-states', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/decrypt', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as { key_ids?: unknown; context?: { variant_id?: string } };

    if (!Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }
    if (body.key_ids.length > DECRYPT_MAX_BATCH) {
      return reply.code(400).send({ error: `Maximum ${DECRYPT_MAX_BATCH} keys per request` });
    }
    const keyIds = body.key_ids as string[];
    for (const id of keyIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return reply.code(400).send({ error: `Invalid key_id format: ${String(id).slice(0, 40)}` });
      }
    }

    if (!getEnv().ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: 'Server encryption configuration is unavailable.',
      });
    }

    const authUser = getAuthUser(request);
    const uc = container.resolve<DecryptKeysWithAuditUseCase>(UC_TOKENS.DecryptKeysWithAudit);

    const result = await uc.execute({
      key_ids: keyIds,
      variant_id_context: body.context?.variant_id ?? null,
      admin_user_id: authUser?.id ?? 'unknown',
      admin_email: authUser?.email ?? null,
      client_ip: request.ip,
      user_agent: (request.headers['user-agent'] as string) ?? null,
    });

    if (result.failures.length > 0 && result.keys.length === 0) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: `All ${result.failures.length} key(s) failed to decrypt.`,
        failures: result.failures,
      });
    }
    return reply.send({
      keys: result.keys,
      failures: result.failures.length > 0 ? result.failures : undefined,
    });
  });

  app.post('/keys/export', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as { key_ids?: unknown; remove_from_inventory?: boolean };

    if (!Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }
    if (body.key_ids.length > EXPORT_MAX_BATCH) {
      return reply.code(400).send({ error: `Maximum ${EXPORT_MAX_BATCH} keys per request` });
    }
    const keyIds = body.key_ids as string[];
    for (const id of keyIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return reply.code(400).send({ error: `Invalid key_id format: ${String(id).slice(0, 40)}` });
      }
    }

    if (!getEnv().ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: 'Server encryption configuration is unavailable.',
      });
    }

    const authUser = getAuthUser(request);
    const uc = container.resolve<ExportKeysUseCase>(UC_TOKENS.ExportKeys);
    const result = await uc.execute({
      key_ids: keyIds,
      remove_from_inventory: body.remove_from_inventory === true,
      admin_user_id: authUser?.id ?? 'unknown',
      admin_email: authUser?.email ?? null,
      client_ip: request.ip,
      user_agent: (request.headers['user-agent'] as string) ?? null,
    });
    return reply.send(result);
  });

  app.post('/keys/recrypt', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/sales-blocked', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/lookup-by-value', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as { key_values?: unknown };

    if (!Array.isArray(body.key_values) || body.key_values.length === 0) {
      return reply.code(400).send({ error: 'key_values array is required' });
    }
    if (body.key_values.length > 1000) {
      return reply.code(400).send({ error: 'Maximum 1000 key values per lookup' });
    }
    for (const v of body.key_values) {
      if (typeof v !== 'string' || v.trim().length === 0) {
        return reply.code(400).send({ error: 'Each key_value must be a non-empty string' });
      }
    }

    const uc = container.resolve<LookupKeysByValueUseCase>(UC_TOKENS.LookupKeysByValue);
    const result = await uc.execute({ key_values: body.key_values as string[] });
    return reply.send(result);
  });

  app.post('/keys/bulk-set-state', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as {
      key_ids?: unknown;
      target_state?: unknown;
      reason?: unknown;
    };

    if (!Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }
    if (body.key_ids.length > BULK_STATE_MAX_BATCH) {
      return reply.code(400).send({ error: `Maximum ${BULK_STATE_MAX_BATCH} keys per operation` });
    }
    const keyIds = body.key_ids as unknown[];
    for (const id of keyIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return reply.code(400).send({ error: `Invalid key_id format: ${String(id).slice(0, 40)}` });
      }
    }

    if (!ALLOWED_BULK_STATES.includes(body.target_state as AllowedBulkState)) {
      return reply.code(400).send({
        error: `target_state must be one of: ${ALLOWED_BULK_STATES.join(', ')}`,
      });
    }
    const targetState = body.target_state as AllowedBulkState;

    if (targetState === 'faulty') {
      if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
        return reply.code(400).send({ error: 'reason is required when target_state is faulty' });
      }
      if (body.reason.trim().length > 500) {
        return reply.code(400).send({ error: 'reason must be 500 characters or fewer' });
      }
    }

    const adminId = getAuthUser(request)?.id ?? 'unknown';
    try {
      if (targetState === 'faulty') {
        const uc = container.resolve<MarkKeysFaultyUseCase>(UC_TOKENS.MarkKeysFaulty);
        const result = await uc.execute({
          key_ids: keyIds as string[],
          reason: (body.reason as string).trim(),
          admin_id: adminId,
        });
        return reply.send(result);
      }
      const uc = container.resolve<BulkBurnKeysUseCase>(UC_TOKENS.BulkBurnKeys);
      const result = await uc.execute({ key_ids: keyIds as string[] });
      return reply.send(result);
    } catch (err) {
      logger.error('bulk-set-state failed', err as Error, {
        target_state: targetState,
        key_count: keyIds.length,
      });
      return reply.code(500).send({ error: 'Failed to update key states' });
    }
  });

  app.post('/keys/mark-faulty', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as { key_ids?: unknown; reason?: unknown };

    if (!Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }
    if (body.key_ids.length > BULK_STATE_MAX_BATCH) {
      return reply.code(400).send({ error: `Maximum ${BULK_STATE_MAX_BATCH} keys per operation` });
    }
    const keyIds = body.key_ids as unknown[];
    for (const id of keyIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return reply.code(400).send({ error: `Invalid key_id format: ${String(id).slice(0, 40)}` });
      }
    }
    if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
      return reply.code(400).send({ error: 'reason is required' });
    }
    if (body.reason.trim().length > 500) {
      return reply.code(400).send({ error: 'reason must be 500 characters or fewer' });
    }

    const adminId = getAuthUser(request)?.id ?? 'unknown';
    try {
      const uc = container.resolve<MarkKeysFaultyUseCase>(UC_TOKENS.MarkKeysFaulty);
      const result = await uc.execute({
        key_ids: keyIds as string[],
        reason: body.reason.trim(),
        admin_id: adminId,
      });
      return reply.send(result);
    } catch (err) {
      logger.error('mark-keys-faulty failed', err as Error, { key_count: keyIds.length });
      return reply.code(500).send({ error: 'Failed to mark keys as faulty' });
    }
  });

  app.post('/keys/link-replacement', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/variant/sales-blocked', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/manual-sell', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as {
      key_ids?: unknown;
      buyer_email?: unknown;
      buyer_name?: unknown;
      notes?: unknown;
      price_cents?: unknown;
      currency?: unknown;
    };

    if (!Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }
    if (body.key_ids.length > DECRYPT_MAX_BATCH) {
      return reply.code(400).send({ error: `Maximum ${DECRYPT_MAX_BATCH} keys per request` });
    }
    const keyIds = body.key_ids as string[];
    for (const id of keyIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return reply.code(400).send({ error: `Invalid key_id format: ${String(id).slice(0, 40)}` });
      }
    }
    if (typeof body.buyer_email !== 'string' || body.buyer_email.trim().length === 0) {
      return reply.code(400).send({ error: 'buyer_email is required' });
    }

    const authUser = getAuthUser(request);
    const uc = container.resolve<ManualSellKeysUseCase>(UC_TOKENS.ManualSellKeys);
    try {
      const result = await uc.execute({
        key_ids: keyIds,
        buyer_email: body.buyer_email.trim(),
        buyer_name: typeof body.buyer_name === 'string' ? body.buyer_name.trim() || null : null,
        notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
        price_cents: typeof body.price_cents === 'number' ? body.price_cents : 0,
        currency: typeof body.currency === 'string' ? body.currency.toUpperCase() : 'USD',
        admin_user_id: authUser?.id ?? 'unknown',
        admin_email: authUser?.email ?? null,
        client_ip: request.ip,
        user_agent: (request.headers['user-agent'] as string) ?? null,
      });
      return reply.send(result);
    } catch (err) {
      const e = err as Error & {
        code?: string;
        missing?: string[];
        unavailable?: Array<{ id: string; current_state: string }>;
      };
      if (e.code === 'KEYS_NOT_FOUND') {
        return reply.code(404).send({ error: 'Some keys not found', missing_key_ids: e.missing });
      }
      if (e.code === 'KEYS_UNAVAILABLE') {
        return reply.code(409).send({
          error: 'Some keys are not available for sale',
          unavailable: e.unavailable,
        });
      }
      logger.error('manual-sell failed', err as Error, { key_count: keyIds.length });
      return reply.code(500).send({ error: 'Manual sell failed' });
    }
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

  app.get('/variant-context/:variantId', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { variantId } = request.params as { variantId: string };
    const uc = container.resolve<GetVariantContextUseCase>(UC_TOKENS.GetVariantContext);
    try {
      const result = await uc.execute({ variant_id: variantId });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Variant not found';
      if (message.includes('not found')) {
        return reply.status(404).send({ error: message });
      }
      throw err;
    }
  });
}
