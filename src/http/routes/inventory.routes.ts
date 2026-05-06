import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import { SecureKeyManager } from '../../infra/crypto/secure-key-manager.js';
import type { GetInventoryCatalogUseCase } from '../../core/use-cases/inventory/get-inventory-catalog.use-case.js';
import type { INotificationDispatcher } from '../../core/ports/notification-channel.port.js';
import { loadCurrencyRates, convertCentsToUsd } from './_currency-helpers.js';

function mapKeyState(keyState: string | null, isUsed: boolean): 'available' | 'reserved' | 'sold' {
  if (isUsed || keyState === 'used' || keyState === 'seller_provisioned') return 'sold';
  if (keyState === 'assigned' || keyState === 'seller_reserved') return 'reserved';
  return 'available';
}

export async function adminInventoryRoutes(app: FastifyInstance) {
  app.get('/kpis', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const countResult = await db.queryPaginated<Record<string, unknown>>('product_keys', {
      select: 'id',
      eq: [['key_state', 'available']],
      limit: 1,
    });
    const availableKeyCount = countResult.total;

    const costRows = await db.query<{
      purchase_cost: string | number | null;
      purchase_currency: string | null;
    }>('product_keys', {
      select: 'purchase_cost, purchase_currency',
      eq: [['key_state', 'available']],
      limit: 10000,
    });

    const rates = await loadCurrencyRates(db);

    let totalCostUsdCents = 0;
    for (const row of costRows) {
      const cost = typeof row.purchase_cost === 'number' ? row.purchase_cost
        : typeof row.purchase_cost === 'string' ? Number(row.purchase_cost) : 0;
      if (cost <= 0) continue;
      const currency = (row.purchase_currency ?? 'USD').toUpperCase();
      totalCostUsdCents += convertCentsToUsd(cost, currency, rates);
    }

    return reply.send({
      availableKeyCount,
      purchaseCostUsdTotal: totalCostUsdCents / 100,
    });
  });

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

  const VALID_KEY_STATES = new Set([
    'available', 'assigned', 'revealed', 'used', 'burnt', 'faulty',
    'seller_uploaded', 'seller_provisioned', 'seller_reserved',
  ]);

  app.get('/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as {
      productId?: string;
      variantId?: string;
      state?: string;
      page?: string;
      pageSize?: string;
      search?: string;
    };

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const selectCols = 'id, variant_id, key_state, is_used, created_at, used_at, supplier_reference, order_id, orders(order_number, order_channel, delivery_email, guest_email, contact_email, customer_full_name)';

    const eqFilters: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    const ilikeFilters: Array<[string, string]> = [];

    if (query.variantId) {
      eqFilters.push(['variant_id', query.variantId]);
    } else if (query.productId) {
      const variants = await db.query<{ id: string }>('product_variants', {
        select: 'id',
        eq: [['product_id', query.productId]],
      });
      const variantIds = variants.map(v => v.id);
      if (variantIds.length === 0) {
        return reply.send({ keys: [], total: 0, page, pageSize });
      }
      inFilters.push(['variant_id', variantIds]);
    }

    if (query.state) {
      const states = query.state.split(',').filter(s => VALID_KEY_STATES.has(s.trim()));
      if (states.length > 0) {
        inFilters.push(['key_state', states]);
      }
    }

    if (query.search) {
      ilikeFilters.push(['id', `${query.search}%`]);
    }

    const { data: keys, total } = await db.queryPaginated<Record<string, unknown>>('product_keys', {
      select: selectCols,
      eq: eqFilters.length > 0 ? eqFilters : undefined,
      in: inFilters.length > 0 ? inFilters : undefined,
      ilike: ilikeFilters.length > 0 ? ilikeFilters : undefined,
      order: { column: 'created_at', ascending: false },
      range: [from, to],
    });

    const variantIds = [...new Set(keys.map(k => k.variant_id as string))];
    const variantProductMap = new Map<string, string>();
    const productMap = new Map<string, string>();

    if (variantIds.length > 0) {
      const variants = await db.query<{ id: string; product_id: string }>('product_variants', {
        select: 'id, product_id',
        in: [['id', variantIds]],
      });
      for (const v of variants) variantProductMap.set(v.id, v.product_id);

      const productIds = [...new Set(variants.map(v => v.product_id))];
      if (productIds.length > 0) {
        const products = await db.query<{ id: string; name: string }>('products', {
          select: 'id, name',
          in: [['id', productIds]],
        });
        for (const p of products) productMap.set(p.id, p.name);
      }
    }

    const mapped = keys.map(k => {
      const productId = variantProductMap.get(k.variant_id as string) ?? '';
      const productName = productMap.get(productId) ?? '';
      const order = k.orders as { order_number?: string; order_channel?: string; delivery_email?: string; guest_email?: string; contact_email?: string; customer_full_name?: string } | null;

      let soldTo: string | null = null;
      if (order) {
        soldTo = order.customer_full_name
          || order.delivery_email
          || order.contact_email
          || order.guest_email
          || null;
      }

      return {
        id: k.id as string,
        productId,
        productName,
        variantId: k.variant_id as string,
        key: '••••••••',
        status: mapKeyState(k.key_state as string | null, k.is_used as boolean),
        keyState: k.key_state as string,
        supplierId: '',
        supplierName: (k.supplier_reference as string) || '—',
        addedAt: (k.created_at as string) ?? '',
        usedAt: (k.used_at as string) || null,
        orderId: (k.order_id as string) || null,
        orderNumber: order?.order_number || null,
        orderChannel: order?.order_channel || null,
        soldTo,
        locked: true,
      };
    });

    return reply.send({ keys: mapped, total, page, pageSize });
  });

  // GET /api/admin/inventory/variants/:variantId/keys — list keys for variant
  // Returns MaskedKey shape expected by CRM's VariantKeysResult.
  app.get('/variants/:variantId/keys', { preHandler: [employeeGuard] }, async (request, reply) => {
    const { variantId } = request.params as { variantId: string };
    const query = request.query as Record<string, string | undefined>;

    const limit = Math.min(500, Math.max(1, Number(query.limit) || 50));
    const offset = Math.max(0, Number(query.offset) || 0);
    const from = offset;
    const to = offset + limit - 1;

    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const eqFilters: Array<[string, unknown]> = [['variant_id', variantId]];
    const inFilters: Array<[string, unknown[]]> = [];

    if (query.status) {
      const states = query.status.split(',').filter(s => VALID_KEY_STATES.has(s.trim()));
      if (states.length > 0) {
        inFilters.push(['key_state', states]);
      }
    }

    const { data: keys, total } = await db.queryPaginated<Record<string, unknown>>('product_keys', {
      select: 'id, key_state, is_used, created_at, used_at, order_id, sales_blocked_at, marked_faulty_at',
      eq: eqFilters,
      in: inFilters.length > 0 ? inFilters : undefined,
      order: { column: 'created_at', ascending: false },
      range: [from, to],
    });

    let available = 0;
    let reserved = 0;
    let sold = 0;

    const allKeys = await db.query<{ key_state: string; is_used: boolean }>('product_keys', {
      select: 'key_state, is_used',
      eq: [['variant_id', variantId]],
      limit: 10000,
    });
    for (const k of allKeys) {
      const s = mapKeyState(k.key_state, k.is_used);
      if (s === 'available') available++;
      else if (s === 'reserved') reserved++;
      else sold++;
    }

    const mapped = keys.map(k => {
      const keyState = k.key_state as string | null;
      return {
        id: k.id as string,
        masked_value: '••••••••',
        status: mapKeyState(keyState, k.is_used as boolean),
        created_at: (k.created_at as string) ?? '',
        sold_at: (k.used_at as string) || null,
        order_id: (k.order_id as string) || null,
        is_sales_blocked: k.sales_blocked_at !== null && k.sales_blocked_at !== undefined,
        is_faulty: k.marked_faulty_at !== null && k.marked_faulty_at !== undefined,
      };
    });

    return reply.send({ keys: mapped, total, available, reserved, sold });
  });

  app.post('/keys/upload', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as {
      variant_id?: string;
      keys?: string[];
      purchase_cost?: number;
      purchase_currency?: string;
      price_mode?: 'total' | 'per_key';
      supplier_reference?: string;
      marketplace_eligible?: boolean;
      allowed_seller_provider_account_ids?: string[];
    };

    if (!body.variant_id || !UUID_RE.test(body.variant_id)) {
      return reply.code(400).send({ error: 'Valid variant_id is required' });
    }
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      return reply.code(400).send({ error: 'keys array is required and must not be empty' });
    }
    if (body.keys.length > 1000) {
      return reply.code(400).send({ error: 'Maximum 1000 keys per upload batch' });
    }

    if (!process.env.ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'ENCRYPTION_FAILED',
        message: 'Server encryption configuration is unavailable.',
      });
    }

    const authUser = (request as unknown as Record<string, unknown>).authUser as
      { id: string; email?: string } | undefined;
    const adminUserId = authUser?.id ?? 'unknown';
    const adminEmail = authUser?.email ?? null;
    const clientIp = request.ip;

    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const variant = await db.queryOne<{ id: string; product_id: string }>(
      'product_variants',
      { select: 'id, product_id', eq: [['id', body.variant_id]] },
    );
    if (!variant) {
      return reply.code(404).send({ error: 'Variant not found' });
    }

    const rawKeys = body.keys
      .map(k => k.trim())
      .filter(k => k.length > 0);

    if (rawKeys.length === 0) {
      return reply.code(400).send({ error: 'No valid keys after trimming whitespace' });
    }

    const priceMode = body.price_mode ?? 'total';
    const inputCost = body.purchase_cost ?? 0;
    const perKeyCost = priceMode === 'total' && rawKeys.length > 0
      ? Math.round(inputCost / rawKeys.length)
      : inputCost;

    const hashFn = async (key: string): Promise<string> => {
      const encoder = new TextEncoder();
      const data = encoder.encode(key);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return Buffer.from(hashBuffer).toString('hex');
    };

    const hashes = await Promise.all(rawKeys.map(k => hashFn(k)));
    const existingRows = await db.query<{ raw_key_hash: string }>(
      'product_keys',
      { select: 'raw_key_hash', in: [['raw_key_hash', hashes]] },
    );
    const existingHashes = new Set(existingRows.map(r => r.raw_key_hash));

    let uploaded = 0;
    let duplicates = 0;

    for (let i = 0; i < rawKeys.length; i++) {
      const key = rawKeys[i];
      const hash = hashes[i];

      if (existingHashes.has(hash)) {
        duplicates++;
        continue;
      }

      try {
        const encrypted = await SecureKeyManager.encrypt(key);

        await db.insert('product_keys', {
          variant_id: body.variant_id,
          encrypted_key: encrypted.encrypted,
          encryption_iv: encrypted.iv,
          encryption_salt: encrypted.salt,
          encryption_key_id: encrypted.keyId,
          encryption_version: 'aes-256-gcm',
          raw_key_hash: hash,
          key_state: 'available',
          is_used: false,
          created_by: adminUserId,
          purchase_cost: perKeyCost,
          purchase_currency: body.purchase_currency ?? 'USD',
          supplier_reference: body.supplier_reference ?? null,
          marketplace_eligible: body.marketplace_eligible ?? true,
          allowed_seller_provider_account_ids: body.allowed_seller_provider_account_ids ?? null,
        });
        uploaded++;
      } catch (err) {
        request.log.error({ keyIndex: i, error: err }, 'Failed to encrypt/insert key');
      }
    }

    try {
      await db.insert('admin_actions', {
        admin_user_id: adminUserId,
        admin_email: adminEmail,
        action_type: 'keys_upload',
        target_type: 'product_keys',
        target_id: body.variant_id,
        details: {
          variant_id: body.variant_id,
          uploaded,
          duplicates,
          total_submitted: rawKeys.length,
          purchase_cost: body.purchase_cost ?? 0,
          purchase_currency: body.purchase_currency ?? 'USD',
          supplier_reference: body.supplier_reference ?? null,
        },
        ip_address: clientIp,
        user_agent: request.headers['user-agent'] ?? null,
        client_channel: 'crm',
      });
    } catch {
      request.log.error('Failed to write upload audit log');
    }

    return reply.send({ uploaded, duplicates });
  });

  app.post('/keys/replace', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  app.post('/keys/fix-states', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  const DECRYPT_MAX_BATCH = 50;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.post('/keys/decrypt', {
    preHandler: [adminGuard],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const body = request.body as { key_ids?: unknown; context?: { variant_id?: string } };

    if (!Array.isArray(body.key_ids) || body.key_ids.length === 0) {
      return reply.code(400).send({ error: 'key_ids array is required' });
    }
    if (body.key_ids.length > DECRYPT_MAX_BATCH) {
      return reply.code(400).send({
        error: `Maximum ${DECRYPT_MAX_BATCH} keys per request`,
      });
    }
    const keyIds = body.key_ids as string[];
    for (const id of keyIds) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) {
        return reply.code(400).send({ error: `Invalid key_id format: ${String(id).slice(0, 40)}` });
      }
    }

    if (!process.env.ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: 'Server encryption configuration is unavailable.',
      });
    }

    const authUser = (request as unknown as Record<string, unknown>).authUser as
      { id: string; email?: string } | undefined;
    const adminUserId = authUser?.id ?? 'unknown';
    const adminEmail = authUser?.email ?? null;
    const clientIp = request.ip;

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
      in: [['id', keyIds]],
    });

    const decrypted: Array<{ id: string; decrypted_value: string }> = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      if (!row.encrypted_key || !row.encryption_iv || !row.encryption_salt) {
        failures.push({ id: row.id, error: 'Missing encryption data' });
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
        request.log.error({ keyId: row.id, err }, 'Key decryption failed');
        failures.push({ id: row.id, error: 'Decryption failed' });
      }
    }

    try {
      await db.insert('admin_actions', {
        admin_user_id: adminUserId,
        admin_email: adminEmail,
        action_type: 'keys_decrypt',
        target_type: 'product_keys',
        target_id: keyIds.length === 1 ? keyIds[0] : null,
        details: {
          key_count: keyIds.length,
          key_ids: keyIds,
          decrypted_count: decrypted.length,
          failed_count: failures.length,
          variant_id: body.context?.variant_id ?? null,
        },
        ip_address: clientIp,
        user_agent: request.headers['user-agent'] ?? null,
        client_channel: 'crm',
      });
    } catch {
      request.log.error('Failed to write decrypt audit log');
    }

    if (decrypted.length >= 10) {
      try {
        const dispatcher = container.resolve<INotificationDispatcher>(TOKENS.NotificationDispatcher);
        await dispatcher.dispatch({
          type: 'keys.bulk_decrypt',
          severity: decrypted.length >= 50 ? 'critical' : 'warning',
          actor: { id: adminUserId, email: adminEmail },
          payload: { key_count: decrypted.length, key_ids: keyIds },
          timestamp: new Date().toISOString(),
        });
      } catch {
        request.log.error('Failed to dispatch decrypt notification');
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

  const EXPORT_MAX_BATCH = 500;

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

    if (!process.env.ENCRYPTION_MASTER_KEY) {
      return reply.code(500).send({
        error: 'DECRYPTION_FAILED',
        message: 'Server encryption configuration is unavailable.',
      });
    }

    const authUser = (request as unknown as Record<string, unknown>).authUser as
      { id: string; email?: string } | undefined;
    const adminUserId = authUser?.id ?? 'unknown';
    const adminEmail = authUser?.email ?? null;
    const clientIp = request.ip;

    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const rows = await db.query<{
      id: string;
      variant_id: string;
      key_state: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
      created_at: string;
    }>('product_keys', {
      select: 'id, variant_id, key_state, encrypted_key, encryption_iv, encryption_salt, encryption_key_id, created_at',
      in: [['id', keyIds]],
    });

    const variantIds = [...new Set(rows.map(r => r.variant_id))];
    const variantProductMap = new Map<string, string>();
    const productNameMap = new Map<string, string>();

    if (variantIds.length > 0) {
      const variants = await db.query<{ id: string; product_id: string }>(
        'product_variants',
        { select: 'id, product_id', in: [['id', variantIds]] },
      );
      for (const v of variants) variantProductMap.set(v.id, v.product_id);

      const productIds = [...new Set(variants.map(v => v.product_id))];
      if (productIds.length > 0) {
        const products = await db.query<{ id: string; name: string }>(
          'products',
          { select: 'id, name', in: [['id', productIds]] },
        );
        for (const p of products) productNameMap.set(p.id, p.name);
      }
    }

    const csvLines: string[] = ['key_id,product,variant_id,key_value,status,added_at'];

    for (const row of rows) {
      let keyValue = '';
      if (row.encrypted_key && row.encryption_iv && row.encryption_salt) {
        try {
          keyValue = await SecureKeyManager.decrypt(
            row.encrypted_key,
            row.encryption_iv,
            row.encryption_salt,
            row.encryption_key_id ?? null,
          );
        } catch {
          keyValue = '[decryption failed]';
        }
      } else {
        keyValue = '[no encryption data]';
      }

      const productId = variantProductMap.get(row.variant_id) ?? '';
      const productName = productNameMap.get(productId) ?? '';
      const escapedProduct = productName.includes(',') ? `"${productName}"` : productName;
      const escapedKey = keyValue.includes(',') || keyValue.includes('"')
        ? `"${keyValue.replace(/"/g, '""')}"`
        : keyValue;

      csvLines.push(
        `${row.id},${escapedProduct},${row.variant_id},${escapedKey},${row.key_state},${row.created_at}`,
      );
    }

    try {
      await db.insert('admin_actions', {
        admin_user_id: adminUserId,
        admin_email: adminEmail,
        action_type: 'keys_export',
        target_type: 'product_keys',
        target_id: null,
        details: {
          key_count: keyIds.length,
          key_ids: keyIds,
        },
        ip_address: clientIp,
        user_agent: request.headers['user-agent'] ?? null,
        client_channel: 'crm',
      });
    } catch {
      request.log.error('Failed to write export audit log');
    }

    if (body.remove_from_inventory === true) {
      for (const row of rows) {
        try {
          await db.update('product_keys', { id: row.id }, {
            key_state: 'burnt',
            is_used: true,
          });
        } catch {
          request.log.error({ keyId: row.id }, 'Failed to mark key as burnt during export');
        }
      }
    }

    if (keyIds.length >= 10) {
      try {
        const dispatcher = container.resolve<INotificationDispatcher>(
          TOKENS.NotificationDispatcher,
        );
        await dispatcher.dispatch({
          type: 'keys.bulk_download',
          severity: keyIds.length >= 50 ? 'critical' : 'warning',
          actor: { id: adminUserId, email: adminEmail },
          payload: { key_count: keyIds.length, removed: body.remove_from_inventory === true },
          timestamp: new Date().toISOString(),
        });
      } catch {
        request.log.error('Failed to dispatch export notification');
      }
    }

    const csv = csvLines.join('\n');
    return reply.send({ csv, exported: rows.length, removed: body.remove_from_inventory === true });
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
    const buyerEmail = body.buyer_email.trim();
    const buyerName = typeof body.buyer_name === 'string' ? body.buyer_name.trim() || null : null;
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
    const priceCents = typeof body.price_cents === 'number' ? body.price_cents : 0;
    const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : 'USD';

    const authUser = (request as unknown as Record<string, unknown>).authUser as
      { id: string; email?: string } | undefined;
    const adminUserId = authUser?.id ?? 'unknown';
    const adminEmail = authUser?.email ?? null;
    const clientIp = request.ip;

    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(
      TOKENS.Database,
    );

    const keys = await db.query<{ id: string; key_state: string; variant_id: string }>(
      'product_keys',
      { select: 'id, key_state, variant_id', in: [['id', keyIds]] },
    );

    if (keys.length !== keyIds.length) {
      const found = new Set(keys.map(k => k.id));
      const missing = keyIds.filter(id => !found.has(id));
      return reply.code(404).send({ error: 'Some keys not found', missing_key_ids: missing });
    }

    const unavailable = keys.filter(k => k.key_state !== 'available');
    if (unavailable.length > 0) {
      return reply.code(409).send({
        error: 'Some keys are not available for sale',
        unavailable: unavailable.map(k => ({ id: k.id, current_state: k.key_state })),
      });
    }

    const firstVariantId = keys[0].variant_id;
    const variant = await db.queryOne<{ id: string; product_id: string }>(
      'product_variants',
      { select: 'id, product_id', eq: [['id', firstVariantId]] },
    );

    if (!variant) {
      return reply.code(500).send({ error: 'Could not resolve product for variant' });
    }

    const now = new Date().toISOString();

    const newOrder = await db.insert<{ id: string; order_number: string }>('orders', {
      status: 'fulfilled',
      order_channel: 'manual',
      payment_method: 'manual',
      delivery_email: buyerEmail,
      customer_full_name: buyerName,
      notes,
      total_amount: priceCents,
      currency,
      quantity: keyIds.length,
      product_id: variant.product_id,
      fulfillment_status: 'fulfilled',
      processed_at: now,
      processed_by: adminUserId,
    });

    for (const keyId of keyIds) {
      await db.update('product_keys', { id: keyId }, {
        key_state: 'used',
        is_used: true,
        order_id: newOrder.id,
        used_at: now,
      });
    }

    try {
      await db.insert('admin_actions', {
        admin_user_id: adminUserId,
        admin_email: adminEmail,
        action_type: 'keys_manual_sell',
        target_type: 'orders',
        target_id: newOrder.id,
        details: {
          key_count: keyIds.length,
          key_ids: keyIds,
          buyer_email: buyerEmail,
          order_id: newOrder.id,
          price_cents: priceCents,
          currency,
        },
        ip_address: clientIp,
        user_agent: request.headers['user-agent'] ?? null,
        client_channel: 'crm',
      });
    } catch {
      request.log.error('Failed to write manual-sell audit log');
    }

    if (keyIds.length >= 5) {
      try {
        const dispatcher = container.resolve<INotificationDispatcher>(
          TOKENS.NotificationDispatcher,
        );
        await dispatcher.dispatch({
          type: 'keys.manual_sale',
          severity: keyIds.length >= 10 ? 'critical' : 'warning',
          actor: { id: adminUserId, email: adminEmail },
          payload: { key_count: keyIds.length, order_id: newOrder.id, buyer_email: buyerEmail },
          timestamp: now,
        });
      } catch {
        request.log.error('Failed to dispatch manual-sell notification');
      }
    }

    return reply.send({
      order_id: newOrder.id,
      order_number: newOrder.order_number,
      keys_sold: keyIds.length,
    });
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
    const uc = container.resolve<import('../../core/use-cases/inventory/get-variant-context.use-case.js').GetVariantContextUseCase>(UC_TOKENS.GetVariantContext);

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
