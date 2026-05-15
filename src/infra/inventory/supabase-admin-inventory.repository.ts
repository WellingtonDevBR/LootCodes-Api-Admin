import crypto from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase, QueryOptions } from '../../core/ports/database.port.js';
import type { ICurrencyRatesRepository } from '../../core/ports/currency-rates-repository.port.js';
import { convertCentsToUsd } from '../../http/routes/_currency-helpers.js';
import { sanitizeIlikeTerm } from '../../shared/sanitize-ilike.js';
import { createLogger } from '../../shared/logger.js';
import type { IAdminInventoryRepository } from '../../core/ports/admin-inventory-repository.port.js';

const logger = createLogger('supabase-admin-inventory-repository');

const VALID_KEY_STATES = new Set([
  'available', 'assigned', 'revealed', 'used', 'burnt', 'faulty',
  'seller_uploaded', 'seller_provisioned', 'seller_reserved',
]);

const KEYS_LIST_SELECT = [
  'id, variant_id, key_state, is_used, created_at, used_at, supplier_reference, order_id,',
  'purchase_cost, purchase_currency,',
  'orders(order_number, order_channel, marketplace_pricing, delivery_email,',
  'guest_email, contact_email, customer_full_name)',
].join(' ');

const LOOKUP_BY_HASH_CHUNK_SIZE = 100;
const LOOKUP_IN_CHUNK_UUID = 200;

function keyStateToKpiBucket(keyState: string | null, isUsed: boolean): 'available' | 'reserved' | 'sold' {
  if (isUsed || keyState === 'used' || keyState === 'seller_provisioned') return 'sold';
  if (keyState === 'faulty' || keyState === 'burnt') return 'sold';
  if (
    keyState === 'assigned' ||
    keyState === 'revealed' ||
    keyState === 'seller_reserved' ||
    keyState === 'seller_uploaded'
  ) return 'reserved';
  return 'available';
}
import type {
  EmitInventoryStockChangedDto,
  EmitInventoryStockChangedResult,
  SendStockNotificationsNowDto,
  SendStockNotificationsNowResult,
  ReplaceKeyDto,
  ReplaceKeyResult,
  FixKeyStatesDto,
  FixKeyStatesResult,
  UpdateAffectedKeyDto,
  UpdateAffectedKeyResult,
  DecryptKeysDto,
  DecryptKeysResult,
  RecryptProductKeysDto,
  RecryptProductKeysResult,
  SetKeysSalesBlockedDto,
  SetKeysSalesBlockedResult,
  SetVariantSalesBlockedDto,
  SetVariantSalesBlockedResult,
  MarkKeysFaultyDto,
  MarkKeysFaultyResult,
  LinkReplacementKeyDto,
  LinkReplacementKeyResult,
  ManualSellDto,
  ManualSellResult,
  UpdateVariantPriceDto,
  UpdateVariantPriceResult,
  GetInventoryCatalogDto,
  GetInventoryCatalogResult,
  GetVariantContextDto,
  GetVariantContextResult,
  InventoryCatalogRow,
  UploadKeysDto,
  UploadKeysResult,
  GetInventoryKpisResult,
  ListKeysDto,
  ListKeysResult,
  ListVariantKeysDto,
  ListVariantKeysResult,
  LookupKeysByValueDto,
  LookupKeysByValueResult,
  BulkBurnKeysDto,
  BulkBurnKeysResult,
  ManualSellKeysDto,
  ManualSellKeysResult,
  DecryptKeysOrchestrateDto,
  DecryptKeysOrchestrateResult,
  ExportKeysDto,
  ExportKeysResult,
} from '../../core/use-cases/inventory/inventory.types.js';

@injectable()
export class SupabaseAdminInventoryRepository implements IAdminInventoryRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.CurrencyRatesRepository) private currencyRates: ICurrencyRatesRepository,
  ) {}

  async emitInventoryStockChanged(dto: EmitInventoryStockChangedDto): Promise<EmitInventoryStockChangedResult> {
    await this.db.rpc('emit_inventory_stock_changed', {
      p_product_ids: dto.product_ids,
      p_reason: dto.reason,
      p_admin_id: dto.admin_id,
    });
    return { success: true };
  }

  async sendStockNotificationsNow(dto: SendStockNotificationsNowDto): Promise<SendStockNotificationsNowResult> {
    const result = await this.db.rpc<{ notifications_sent: number }>(
      'send_stock_notifications_now',
      { p_admin_id: dto.admin_id },
    );
    return { success: true, notifications_sent: result.notifications_sent };
  }

  async replaceKey(dto: ReplaceKeyDto): Promise<ReplaceKeyResult> {
    const result = await this.db.rpc<{ new_key_id: string }>('atomic_replace_key', {
      p_order_item_id: dto.order_item_id,
      p_old_key_id: dto.old_key_id,
      p_admin_id: dto.admin_id,
    });
    return { success: true, new_key_id: result.new_key_id };
  }

  async fixKeyStates(dto: FixKeyStatesDto): Promise<FixKeyStatesResult> {
    const result = await this.db.rpc<{ keys_fixed: number }>('admin_fix_key_states', {
      p_variant_id: dto.variant_id,
      p_admin_id: dto.admin_id,
    });
    return { success: true, keys_fixed: result.keys_fixed };
  }

  async updateAffectedKey(dto: UpdateAffectedKeyDto): Promise<UpdateAffectedKeyResult> {
    await this.db.update('product_keys', { id: dto.key_id }, {
      key_state: dto.new_status,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async decryptKeys(dto: DecryptKeysDto): Promise<DecryptKeysResult> {
    const keys = await this.db.rpc<Array<{ id: string; decrypted_value: string }>>(
      'admin_decrypt_keys',
      { p_key_ids: dto.key_ids, p_admin_id: dto.admin_id },
    );
    return { keys: Array.isArray(keys) ? keys : [] };
  }

  async recryptProductKeys(dto: RecryptProductKeysDto): Promise<RecryptProductKeysResult> {
    const result = await this.db.rpc<{ keys_recrypted: number }>('admin_recrypt_product_keys', {
      p_product_id: dto.product_id,
      p_admin_id: dto.admin_id,
    });
    return { success: true, keys_recrypted: result.keys_recrypted };
  }

  async setKeysSalesBlocked(dto: SetKeysSalesBlockedDto): Promise<SetKeysSalesBlockedResult> {
    if (dto.key_ids.length === 0) return { success: true, keys_updated: 0 };
    const updated = await this.db.updateIn(
      'product_keys',
      'id',
      dto.key_ids,
      { sales_blocked: dto.blocked, updated_at: new Date().toISOString() },
    );
    return { success: true, keys_updated: updated.length };
  }

  async setVariantSalesBlocked(dto: SetVariantSalesBlockedDto): Promise<SetVariantSalesBlockedResult> {
    await this.db.update('product_variants', { id: dto.variant_id }, {
      sales_blocked: dto.blocked,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async markKeysFaulty(dto: MarkKeysFaultyDto): Promise<MarkKeysFaultyResult> {
    const rows = await this.db.rpc<Array<{ key_id: string; outcome: string; write_off_cents: number }>>(
      'admin_mark_keys_faulty',
      { p_key_ids: dto.key_ids, p_reason: dto.reason, p_actor: dto.admin_id },
    );
    const results = Array.isArray(rows) ? rows : [];
    const keysMarked = results.filter((r) => r.outcome === 'marked_faulty').length;
    return { success: true, keys_marked: keysMarked, results };
  }

  async linkReplacementKey(dto: LinkReplacementKeyDto): Promise<LinkReplacementKeyResult> {
    await this.db.update('product_keys', { id: dto.replacement_key_id }, {
      replaces_key_id: dto.original_key_id,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async manualSell(dto: ManualSellDto): Promise<ManualSellResult> {
    const result = await this.db.rpc<{ order_id: string }>('admin_manual_sell', {
      p_variant_id: dto.variant_id,
      p_quantity: dto.quantity,
      p_buyer_email: dto.buyer_email,
      p_admin_id: dto.admin_id,
    });
    return { success: true, order_id: result.order_id };
  }

  async updateVariantPrice(dto: UpdateVariantPriceDto): Promise<UpdateVariantPriceResult> {
    await this.db.update('product_variants', { id: dto.variant_id }, {
      price_cents: dto.price_cents,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  private async batchedQuery<T>(
    table: string,
    column: string,
    ids: string[],
    options: Omit<QueryOptions, 'in' | 'range' | 'limit'>,
    batchSize = 200,
  ): Promise<T[]> {
    if (ids.length === 0) return [];
    if (ids.length <= batchSize) {
      return this.db.queryAll<T>(table, { ...options, in: [[column, ids]] });
    }
    const results: T[] = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize);
      const rows = await this.db.queryAll<T>(table, { ...options, in: [[column, chunk]] });
      results.push(...rows);
    }
    return results;
  }

  async getInventoryCatalog(dto: GetInventoryCatalogDto): Promise<GetInventoryCatalogResult> {
    const selectVariants =
      'id, sku, price_usd, is_active, product_id, region_id, default_cost_cents, default_cost_currency, face_value';

    const rawSearch = dto.search?.trim() ?? '';
    const searchTerm = rawSearch.length > 0 ? sanitizeIlikeTerm(rawSearch) : '';

    // Use queryAll (auto-paginating in 1 000-row chunks) instead of a single
    // queryPaginated call.  Supabase hosted PostgREST enforces max-rows = 1 000
    // per request: a Range: 0-4999 header is silently truncated to 1 000 rows,
    // which was causing the "1 000 SKUs" display bug when we have 1 719 variants.
    let sliced: Record<string, unknown>[];
    if (searchTerm.length > 0) {
      const pattern = `%${searchTerm}%`;
      const matchingProducts = await this.db.query<{ id: string }>('products', {
        select: 'id',
        ilike: [['name', pattern]],
        limit: 100,
      });
      const pidList = matchingProducts.map(p => p.id);
      const orParts: string[] = [`sku.ilike.${pattern}`];
      if (pidList.length > 0) {
        const inList = pidList.map(id => `"${id}"`).join(',');
        orParts.push(`product_id.in.(${inList})`);
      }
      sliced = await this.db.queryAll<Record<string, unknown>>('product_variants', {
        select: selectVariants,
        or: orParts.join(','),
        order: { column: 'created_at', ascending: false },
      });
    } else {
      sliced = await this.db.queryAll<Record<string, unknown>>('product_variants', {
        select: selectVariants,
        order: { column: 'created_at', ascending: false },
      });
    }
    const variantIds = sliced.map(v => v.id as string);
    const productIds = [...new Set(sliced.map(v => v.product_id as string))];
    const regionIds = [...new Set(sliced.map(v => v.region_id as string).filter(Boolean))];

    const [products, regions, availableKeys, soldKeys, variantPlatforms, providerOffers, providerAccounts, sellerListings, pausedListings] = await Promise.all([
      productIds.length
        ? this.batchedQuery<Record<string, unknown>>('products', 'id', productIds, { select: 'id, name, category' })
        : [],
      regionIds.length
        ? this.batchedQuery<Record<string, unknown>>('product_regions', 'id', regionIds, { select: 'id, name, code' })
        : [],
      this.batchedQuery<Record<string, unknown>>(
        'product_keys', 'variant_id', variantIds,
        { select: 'variant_id', eq: [['key_state', 'available']] },
      ),
      this.batchedQuery<Record<string, unknown>>(
        'product_keys', 'variant_id', variantIds,
        { select: 'variant_id', eq: [['is_used', true]] },
      ),
      this.batchedQuery<Record<string, unknown>>(
        'variant_platforms', 'variant_id', variantIds,
        { select: 'variant_id, platform_id' },
      ),
      this.batchedQuery<Record<string, unknown>>(
        'provider_variant_offers', 'variant_id', variantIds,
        { select: 'variant_id, provider_account_id, is_active, last_price_cents, currency' },
      ),
      this.db.query<Record<string, unknown>>('provider_accounts', {
        select: 'id, display_name, supports_seller',
      }),
      this.batchedQuery<Record<string, unknown>>(
        'seller_listings', 'variant_id', variantIds,
        { select: 'variant_id, declared_stock, provider_account_id', eq: [['status', 'active']] },
      ),
      this.batchedQuery<Record<string, unknown>>(
        'seller_listings', 'variant_id', variantIds,
        { select: 'variant_id', eq: [['status', 'paused']] },
      ),
    ]);

    const productMap = new Map(products.map(p => [p.id as string, p]));
    const regionMap = new Map(regions.map(r => [r.id as string, r]));

    // Stock counts per variant
    const stockAvailableMap = new Map<string, number>();
    for (const k of availableKeys) {
      const vid = k.variant_id as string;
      stockAvailableMap.set(vid, (stockAvailableMap.get(vid) ?? 0) + 1);
    }
    const stockSoldMap = new Map<string, number>();
    for (const k of soldKeys) {
      const vid = k.variant_id as string;
      stockSoldMap.set(vid, (stockSoldMap.get(vid) ?? 0) + 1);
    }

    const declaredStockMap = new Map<string, number>();
    for (const sl of sellerListings) {
      const vid = sl.variant_id as string;
      const ds = typeof sl.declared_stock === 'number' ? sl.declared_stock : 0;
      if (ds > 0) {
        declaredStockMap.set(vid, (declaredStockMap.get(vid) ?? 0) + ds);
      }
    }

    const pausedListingCountMap = new Map<string, number>();
    for (const pl of pausedListings) {
      const vid = pl.variant_id as string;
      pausedListingCountMap.set(vid, (pausedListingCountMap.get(vid) ?? 0) + 1);
    }

    // Platform names per variant
    const platformIds = [...new Set(variantPlatforms.map(vp => vp.platform_id as string))];
    const platforms = platformIds.length
      ? await this.db.query<Record<string, unknown>>('product_platforms', { select: 'id, name', in: [['id', platformIds]] })
      : [];
    const platformNameMap = new Map(platforms.map(p => [p.id as string, p.name as string]));
    const variantPlatformMap = new Map<string, string>();
    for (const vp of variantPlatforms) {
      const name = platformNameMap.get(vp.platform_id as string);
      if (name) variantPlatformMap.set(vp.variant_id as string, name);
    }

    // Provider/supplier data per variant
    const providerMap = new Map(providerAccounts.map(pa => [pa.id as string, pa]));
    const supplierIdsMap = new Map<string, string[]>();
    const purchaserIdsMap = new Map<string, string[]>();
    // Best buy-side cost: minimum last_price_cents across active offers that have a price.
    const bestProviderCostMap = new Map<string, { cents: number; currency: string }>();
    for (const offer of providerOffers) {
      const vid = offer.variant_id as string;
      const provider = providerMap.get(offer.provider_account_id as string);
      if (!provider) continue;
      const provId = provider.id as string;
      if (provider.supports_seller) {
        const arr = purchaserIdsMap.get(vid) ?? [];
        if (!arr.includes(provId)) arr.push(provId);
        purchaserIdsMap.set(vid, arr);
      }
      const arr = supplierIdsMap.get(vid) ?? [];
      if (!arr.includes(provId)) arr.push(provId);
      supplierIdsMap.set(vid, arr);

      // Collect cheapest active offer with a price (buy-provider side only)
      const isActive = offer.is_active === true;
      const priceCents = typeof offer.last_price_cents === 'number' ? offer.last_price_cents : null;
      if (isActive && priceCents !== null && priceCents > 0) {
        const cur = typeof offer.currency === 'string' ? offer.currency : 'USD';
        const existing = bestProviderCostMap.get(vid);
        if (!existing || priceCents < existing.cents) {
          bestProviderCostMap.set(vid, { cents: priceCents, currency: cur });
        }
      }
    }
    // Seller listings also represent purchasers (marketplaces buying from us)
    for (const sl of sellerListings) {
      const vid = sl.variant_id as string;
      const provId = sl.provider_account_id as string;
      if (!provId) continue;
      const arr = purchaserIdsMap.get(vid) ?? [];
      if (!arr.includes(provId)) arr.push(provId);
      purchaserIdsMap.set(vid, arr);
    }

    const rows: InventoryCatalogRow[] = sliced.map(v => {
      const product = productMap.get(v.product_id as string);
      const region = regionMap.get(v.region_id as string);
      const vid = v.id as string;
      const defaultCostCents = typeof v.default_cost_cents === 'number' ? v.default_cost_cents : null;
      const defaultCostCurrency = typeof v.default_cost_currency === 'string' ? v.default_cost_currency : null;
      const keysAvailable = stockAvailableMap.get(vid) ?? 0;
      const bestCost = bestProviderCostMap.get(vid) ?? null;
      return {
        product_id: (v.product_id as string) ?? '',
        product_name: (product?.name as string) ?? '',
        variant_id: vid,
        sku: (v.sku as string) ?? null,
        face_value: typeof v.face_value === 'string' ? v.face_value : null,
        region_name: (region?.code as string) ?? (region?.name as string) ?? null,
        platform_name: variantPlatformMap.get(vid) ?? null,
        stock_available: keysAvailable,
        stock_reserved: 0,
        stock_sold: stockSoldMap.get(vid) ?? 0,
        price_usd: (v.price_usd as number) ?? 0,
        is_active: (v.is_active as boolean) ?? false,
        category: (product?.category as string) ?? null,
        supplier_ids: supplierIdsMap.get(vid) ?? [],
        purchaser_ids: purchaserIdsMap.get(vid) ?? [],
        default_cost_cents: defaultCostCents,
        default_cost_currency: defaultCostCurrency,
        best_provider_cost_cents: bestCost?.cents ?? null,
        best_provider_cost_currency: bestCost?.currency ?? null,
        total_declared_stock: declaredStockMap.get(vid) ?? 0,
        paused_listing_count: pausedListingCountMap.get(vid) ?? 0,
      };
    });

    const providers = providerAccounts.map(pa => ({
      id: pa.id as string,
      display_name: (pa.display_name as string) ?? '',
      supports_seller: (pa.supports_seller as boolean) ?? false,
    }));

    return { rows, providers };
  }

  async getVariantContext(dto: GetVariantContextDto): Promise<GetVariantContextResult> {
    const variant = await this.db.queryOne<Record<string, unknown>>('product_variants', {
      select: 'id, sku, price_usd, product_id, region_id, face_value',
      filter: { id: dto.variant_id },
    });

    if (!variant) throw new Error(`Variant ${dto.variant_id} not found`);

    const [product, variantPlatforms, availableKeys] = await Promise.all([
      this.db.queryOne<Record<string, unknown>>('products', {
        select: 'name',
        filter: { id: variant.product_id as string },
      }),
      this.db.query<Record<string, unknown>>('variant_platforms', {
        select: 'platform_id',
        filter: { variant_id: dto.variant_id },
      }),
      this.db.query<Record<string, unknown>>('product_keys', {
        select: 'id',
        filter: { variant_id: dto.variant_id },
        eq: [['key_state', 'available']],
      }),
    ]);

    const platformIds = variantPlatforms.map(vp => vp.platform_id as string);
    const platforms = platformIds.length
      ? await this.db.query<Record<string, unknown>>('product_platforms', {
          select: 'id, name',
          in: [['id', platformIds]],
        })
      : [];

    let regionName: string | null = null;
    if (variant.region_id) {
      const region = await this.db.queryOne<Record<string, unknown>>('product_regions', {
        select: 'name',
        filter: { id: variant.region_id as string },
      });
      regionName = (region?.name as string) ?? null;
    }

    return {
      id: variant.id as string,
      product_name: (product?.name as string) ?? 'Unknown',
      edition: typeof variant.face_value === 'string' ? variant.face_value : null,
      platform_names: platforms.map(p => p.name as string),
      region_name: regionName,
      sku: variant.sku as string,
      stock_available: availableKeys.length,
      price_usd: variant.price_usd as number,
    };
  }

  async uploadKeys(
    dto: UploadKeysDto,
    encryptFn: (plaintext: string) => Promise<{
      encrypted_key: string;
      encryption_iv: string;
      encryption_salt: string;
      encryption_key_id: string;
    }>,
  ): Promise<UploadKeysResult> {
    const rawKeys = dto.keys.map(k => k.trim()).filter(k => k.length > 0);

    const hashKey = async (key: string): Promise<string> => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
      return Buffer.from(buf).toString('hex');
    };

    const hashes = await Promise.all(rawKeys.map(k => hashKey(k)));

    const allowDuplicates = dto.allow_duplicates === true;

    const existingHashes = new Set<string>();
    if (!allowDuplicates) {
      const HASH_CHUNK = 100;
      for (let c = 0; c < hashes.length; c += HASH_CHUNK) {
        const chunk = hashes.slice(c, c + HASH_CHUNK);
        const rows = await this.db.query<{ raw_key_hash: string }>(
          'product_keys',
          { select: 'raw_key_hash', in: [['raw_key_hash', chunk]] },
        );
        for (const r of rows) existingHashes.add(r.raw_key_hash);
      }
    }

    const priceMode = dto.price_mode ?? 'total';
    const inputCost = dto.purchase_cost ?? 0;
    const perKeyCost = priceMode === 'total' && rawKeys.length > 0
      ? Math.round(inputCost / rawKeys.length)
      : inputCost;

    const newEntries: Array<{ key: string; hash: string }> = [];
    let duplicates = 0;
    for (let i = 0; i < rawKeys.length; i++) {
      if (!allowDuplicates && existingHashes.has(hashes[i]!)) {
        duplicates++;
      } else {
        newEntries.push({ key: rawKeys[i]!, hash: hashes[i]! });
      }
    }

    const ENCRYPT_CHUNK = 50;
    const rows: Record<string, unknown>[] = [];
    for (let c = 0; c < newEntries.length; c += ENCRYPT_CHUNK) {
      const chunk = newEntries.slice(c, c + ENCRYPT_CHUNK);
      const encryptedChunk = await Promise.all(chunk.map((e) => encryptFn(e.key)));
      for (let j = 0; j < chunk.length; j++) {
        const enc = encryptedChunk[j]!;
        rows.push({
          variant_id: dto.variant_id,
          encrypted_key: enc.encrypted_key,
          encryption_iv: enc.encryption_iv,
          encryption_salt: enc.encryption_salt,
          encryption_key_id: enc.encryption_key_id,
          encryption_version: 'aes-256-gcm',
          raw_key_hash: allowDuplicates ? null : chunk[j]!.hash,
          key_state: 'available',
          is_used: false,
          created_by: dto.admin_user_id,
          purchase_cost: perKeyCost,
          purchase_currency: dto.purchase_currency ?? 'USD',
          supplier_reference: dto.supplier_reference ?? null,
          marketplace_eligible: dto.marketplace_eligible ?? true,
          allowed_seller_provider_account_ids: dto.allowed_seller_provider_account_ids ?? null,
        });
      }
    }

    const INSERT_CHUNK = 500;
    let uploaded = 0;
    for (let c = 0; c < rows.length; c += INSERT_CHUNK) {
      const chunk = rows.slice(c, c + INSERT_CHUNK);
      try {
        await this.db.insertMany('product_keys', chunk);
        uploaded += chunk.length;
      } catch (err) {
        logger.error('Bulk key insert failed', err as Error, {
          chunkStart: c,
          chunkSize: chunk.length,
          variant_id: dto.variant_id,
        });
      }
    }

    try {
      await this.db.insert('admin_actions', {
        admin_user_id: dto.admin_user_id,
        admin_email: dto.admin_email,
        action_type: 'keys_upload',
        target_type: 'product_keys',
        target_id: dto.variant_id,
        details: {
          variant_id: dto.variant_id,
          uploaded,
          duplicates,
          total_submitted: rawKeys.length,
          allow_duplicates: allowDuplicates,
          purchase_cost: dto.purchase_cost ?? 0,
          purchase_currency: dto.purchase_currency ?? 'USD',
          supplier_reference: dto.supplier_reference ?? null,
        },
        ip_address: dto.client_ip,
        user_agent: dto.user_agent,
        client_channel: 'crm',
      });
    } catch (auditErr) {
      logger.error('Failed to write upload audit log', auditErr as Error, {
        variant_id: dto.variant_id,
        uploaded,
        duplicates,
      });
    }

    return { uploaded, duplicates };
  }

  async getInventoryKpis(): Promise<GetInventoryKpisResult> {
    const [countResult, costRows, rates] = await Promise.all([
      this.db.queryPaginated<Record<string, unknown>>('product_keys', {
        select: 'id',
        eq: [['key_state', 'available']],
        limit: 1,
      }),
      this.db.queryAll<{
        purchase_cost: string | number | null;
        purchase_currency: string | null;
      }>('product_keys', {
        select: 'purchase_cost, purchase_currency',
        eq: [['key_state', 'available']],
      }),
      this.currencyRates.getActiveRates(),
    ]);

    let totalCostUsdCents = 0;
    for (const row of costRows) {
      const cost = typeof row.purchase_cost === 'number'
        ? row.purchase_cost
        : typeof row.purchase_cost === 'string'
        ? Number(row.purchase_cost)
        : 0;
      if (cost <= 0) continue;
      const currency = (row.purchase_currency ?? 'USD').toUpperCase();
      totalCostUsdCents += convertCentsToUsd(cost, currency, rates);
    }

    return {
      availableKeyCount: countResult.total,
      purchaseCostUsdTotal: totalCostUsdCents / 100,
    };
  }

  async listKeys(dto: ListKeysDto): Promise<ListKeysResult> {
    const page = Math.max(1, dto.page ?? 1);
    const pageSize = Math.min(500, Math.max(1, dto.pageSize ?? 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const eqFilters: Array<[string, unknown]> = [];
    const inFilters: Array<[string, unknown[]]> = [];
    const ilikeFilters: Array<[string, string]> = [];

    if (dto.variantId) {
      eqFilters.push(['variant_id', dto.variantId]);
    } else if (dto.productId) {
      const variants = await this.db.query<{ id: string }>('product_variants', {
        select: 'id',
        eq: [['product_id', dto.productId]],
      });
      const variantIds = variants.map((v) => v.id);
      if (variantIds.length === 0) {
        return { keys: [], total: 0, page, pageSize };
      }
      inFilters.push(['variant_id', variantIds]);
    }

    if (dto.state) {
      const states = dto.state.split(',').filter((s) => VALID_KEY_STATES.has(s.trim()));
      if (states.length > 0) inFilters.push(['key_state', states]);
    }

    if (dto.search) {
      ilikeFilters.push(['id', `${sanitizeIlikeTerm(dto.search)}%`]);
    }

    const { data: keys, total } = await this.db.queryPaginated<Record<string, unknown>>(
      'product_keys',
      {
        select: KEYS_LIST_SELECT,
        eq: eqFilters.length > 0 ? eqFilters : undefined,
        in: inFilters.length > 0 ? inFilters : undefined,
        ilike: ilikeFilters.length > 0 ? ilikeFilters : undefined,
        order: { column: 'created_at', ascending: false },
        range: [from, to],
      },
    );

    const variantIds = [...new Set(keys.map((k) => k.variant_id as string))];
    const variantProductMap = new Map<string, string>();
    const variantMetaMap = new Map<string, { sku: string; face_value: string | null; region_id: string | null }>();
    const regionNameMap = new Map<string, string>();
    const productMap = new Map<string, string>();

    if (variantIds.length > 0) {
      const variants = await this.db.query<{
        id: string;
        product_id: string;
        sku: string;
        face_value: string | null;
        region_id: string | null;
      }>('product_variants', {
        select: 'id, product_id, sku, face_value, region_id',
        in: [['id', variantIds]],
      });
      for (const v of variants) {
        variantProductMap.set(v.id, v.product_id);
        variantMetaMap.set(v.id, { sku: v.sku, face_value: v.face_value, region_id: v.region_id });
      }

      const regionIds = [...new Set(
        variants.map((v) => v.region_id).filter((id): id is string => typeof id === 'string' && id.length > 0),
      )];
      if (regionIds.length > 0) {
        const regions = await this.db.query<{ id: string; name: string }>('product_regions', {
          select: 'id, name',
          in: [['id', regionIds]],
        });
        for (const r of regions) regionNameMap.set(r.id, r.name);
      }

      const productIds = [...new Set(variants.map((v) => v.product_id))];
      if (productIds.length > 0) {
        const products = await this.db.query<{ id: string; name: string }>('products', {
          select: 'id, name',
          in: [['id', productIds]],
        });
        for (const p of products) productMap.set(p.id, p.name);
      }
    }

    const mapped = keys.map((k) => {
      const vid = k.variant_id as string;
      const productId = variantProductMap.get(vid) ?? '';
      const productName = productMap.get(productId) ?? '';
      const meta = variantMetaMap.get(vid);
      const regionName = meta?.region_id ? regionNameMap.get(meta.region_id) ?? null : null;
      const order = k.orders as {
        order_number?: string;
        order_channel?: string;
        marketplace_pricing?: { provider?: string } | null;
        delivery_email?: string;
        guest_email?: string;
        contact_email?: string;
        customer_full_name?: string;
      } | null;

      const soldTo = order
        ? (order.customer_full_name
            || order.delivery_email
            || order.contact_email
            || order.guest_email
            || null)
        : null;

      return {
        id: k.id as string,
        productId,
        productName,
        variantId: vid,
        variantSku: meta?.sku ?? null,
        variantFaceValue: meta?.face_value ?? null,
        variantRegionName: regionName,
        key: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
        keyState: k.key_state as string,
        supplierId: '',
        supplierName: (k.supplier_reference as string) || '\u2014',
        addedAt: (k.created_at as string) ?? '',
        usedAt: (k.used_at as string) || null,
        orderId: (k.order_id as string) || null,
        orderNumber: order?.order_number ?? null,
        orderChannel: order?.order_channel ?? null,
        marketplaceName: order?.marketplace_pricing?.provider ?? null,
        soldTo,
        purchaseCost: typeof k.purchase_cost === 'number'
          ? k.purchase_cost
          : typeof k.purchase_cost === 'string'
          ? Number(k.purchase_cost)
          : null,
        purchaseCurrency: (k.purchase_currency as string) || null,
        locked: true,
      };
    });

    return { keys: mapped, total, page, pageSize };
  }

  async listVariantKeys(dto: ListVariantKeysDto): Promise<ListVariantKeysResult> {
    const limit = Math.min(500, Math.max(1, dto.limit ?? 50));
    const offset = Math.max(0, dto.offset ?? 0);
    const from = offset;
    const to = offset + limit - 1;

    const eqFilters: Array<[string, unknown]> = [['variant_id', dto.variant_id]];
    const inFilters: Array<[string, unknown[]]> = [];

    if (dto.key_state) {
      const states = dto.key_state.split(',').filter((s) => VALID_KEY_STATES.has(s.trim()));
      if (states.length > 0) inFilters.push(['key_state', states]);
    }

    const { data: keys, total } = await this.db.queryPaginated<Record<string, unknown>>(
      'product_keys',
      {
        select: [
          'id, key_state, is_used, created_at, used_at, order_id,',
          'sales_blocked_at, marked_faulty_at, purchase_cost, purchase_currency',
        ].join(' '),
        eq: eqFilters,
        in: inFilters.length > 0 ? inFilters : undefined,
        order: { column: 'created_at', ascending: false },
        range: [from, to],
      },
    );

    let available = 0;
    let reserved = 0;
    let sold = 0;
    const allKeys = await this.db.query<{ key_state: string; is_used: boolean }>('product_keys', {
      select: 'key_state, is_used',
      eq: [['variant_id', dto.variant_id]],
      limit: 10000,
    });
    for (const k of allKeys) {
      const bucket = keyStateToKpiBucket(k.key_state, k.is_used);
      if (bucket === 'available') available++;
      else if (bucket === 'reserved') reserved++;
      else sold++;
    }

    const mapped = keys.map((k) => ({
      id: k.id as string,
      masked_value: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
      keyState: (k.key_state as string) ?? 'available',
      created_at: (k.created_at as string) ?? '',
      sold_at: (k.used_at as string) || null,
      order_id: (k.order_id as string) || null,
      is_sales_blocked: k.sales_blocked_at !== null && k.sales_blocked_at !== undefined,
      is_faulty: k.marked_faulty_at !== null && k.marked_faulty_at !== undefined,
      purchase_cost: typeof k.purchase_cost === 'number'
        ? k.purchase_cost
        : typeof k.purchase_cost === 'string'
        ? Number(k.purchase_cost)
        : null,
      purchase_currency: (k.purchase_currency as string) || null,
    }));

    return { keys: mapped, total, available, reserved, sold };
  }

  async lookupKeysByValue(dto: LookupKeysByValueDto): Promise<LookupKeysByValueResult> {
    const rawValues = dto.key_values.map((v) => v.trim());

    const hashFn = async (key: string): Promise<string> => {
      const data = new TextEncoder().encode(key);
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Buffer.from(buf).toString('hex');
    };
    const hashes = await Promise.all(rawValues.map((v) => hashFn(v)));

    type KeyLookupRow = {
      id: string;
      raw_key_hash: string;
      key_state: string;
      variant_id: string;
      order_id: string | null;
      marked_faulty_at: string | null;
      sales_blocked_at: string | null;
    };

    const uniqueHashes = [...new Set(hashes)];
    const hashToRow = new Map<string, KeyLookupRow>();
    const select = 'id, raw_key_hash, key_state, variant_id, order_id, marked_faulty_at, sales_blocked_at';

    for (let i = 0; i < uniqueHashes.length; i += LOOKUP_BY_HASH_CHUNK_SIZE) {
      const chunk = uniqueHashes.slice(i, i + LOOKUP_BY_HASH_CHUNK_SIZE);
      const rows = await this.db.query<KeyLookupRow>('product_keys', {
        select,
        in: [['raw_key_hash', chunk]],
      });
      for (const row of rows) hashToRow.set(row.raw_key_hash, row);
    }

    const found = [...hashToRow.values()];

    const variantIds = [...new Set(found.map((r) => r.variant_id))];
    type VariantRow = { id: string; sku: string | null; product_id: string };
    const variants: VariantRow[] = [];
    for (let i = 0; i < variantIds.length; i += LOOKUP_IN_CHUNK_UUID) {
      const chunk = variantIds.slice(i, i + LOOKUP_IN_CHUNK_UUID);
      const rows = await this.db.query<VariantRow>('product_variants', {
        select: 'id, sku, product_id',
        in: [['id', chunk]],
      });
      variants.push(...rows);
    }
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const productIds = [...new Set(variants.map((v) => v.product_id))];
    type ProductRow = { id: string; name: string };
    const products: ProductRow[] = [];
    for (let i = 0; i < productIds.length; i += LOOKUP_IN_CHUNK_UUID) {
      const chunk = productIds.slice(i, i + LOOKUP_IN_CHUNK_UUID);
      const rows = await this.db.query<ProductRow>('products', {
        select: 'id, name',
        in: [['id', chunk]],
      });
      products.push(...rows);
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    const results = rawValues.map((raw, i) => {
      const hash = hashes[i]!;
      const row = hashToRow.get(hash);
      if (!row) {
        return {
          input_value: raw,
          matched: false,
          key_id: null,
          key_state: null,
          product_name: null,
          variant_sku: null,
          order_id: null,
        };
      }
      const variant = variantMap.get(row.variant_id);
      const product = variant ? productMap.get(variant.product_id) : undefined;
      return {
        input_value: raw,
        matched: true,
        key_id: row.id,
        key_state: row.key_state,
        product_name: product?.name ?? null,
        variant_sku: variant?.sku ?? null,
        order_id: row.order_id,
      };
    });

    return {
      results,
      matched: results.filter((r) => r.matched).length,
      total: rawValues.length,
    };
  }

  async bulkBurnAvailableKeys(dto: BulkBurnKeysDto): Promise<BulkBurnKeysResult> {
    const rows = await this.db.query<{ id: string; key_state: string }>('product_keys', {
      select: 'id, key_state',
      in: [['id', dto.key_ids]],
    });

    const eligible = rows.filter((r) => r.key_state === 'available');
    const locked = rows.filter((r) => r.key_state !== 'available');

    const results: BulkBurnKeysResult['results'] = locked.map((r) => ({
      key_id: r.id,
      outcome: `state_locked:${r.key_state}`,
    }));

    let keysUpdated = 0;
    for (const row of eligible) {
      await this.db.update('product_keys', { id: row.id }, {
        key_state: 'burnt',
        marketplace_eligible: false,
      });
      results.push({ key_id: row.id, outcome: 'updated' });
      keysUpdated++;
    }

    return { success: true, keys_marked: keysUpdated, results };
  }

  async manualSellKeys(dto: ManualSellKeysDto): Promise<ManualSellKeysResult> {
    const keys = await this.db.query<{ id: string; key_state: string; variant_id: string }>(
      'product_keys',
      { select: 'id, key_state, variant_id', in: [['id', dto.key_ids]] },
    );
    if (keys.length !== dto.key_ids.length) {
      const found = new Set(keys.map((k) => k.id));
      const missing = dto.key_ids.filter((id) => !found.has(id));
      throw Object.assign(new Error('Some keys not found'), { code: 'KEYS_NOT_FOUND', missing });
    }
    const unavailable = keys.filter((k) => k.key_state !== 'available');
    if (unavailable.length > 0) {
      throw Object.assign(new Error('Some keys are not available for sale'), {
        code: 'KEYS_UNAVAILABLE',
        unavailable: unavailable.map((k) => ({ id: k.id, current_state: k.key_state })),
      });
    }

    const firstVariantId = keys[0]!.variant_id;
    const variant = await this.db.queryOne<{ id: string; product_id: string }>(
      'product_variants',
      { select: 'id, product_id', eq: [['id', firstVariantId]] },
    );
    if (!variant) {
      throw new Error('Could not resolve product for variant');
    }

    const now = new Date().toISOString();
    const newOrder = await this.db.insert<{ id: string; order_number: string }>('orders', {
      status: 'fulfilled',
      order_channel: 'manual',
      payment_method: 'manual',
      delivery_email: dto.buyer_email,
      customer_full_name: dto.buyer_name,
      notes: dto.notes,
      total_amount: dto.price_cents,
      currency: dto.currency,
      quantity: dto.key_ids.length,
      product_id: variant.product_id,
      fulfillment_status: 'fulfilled',
      processed_at: now,
      processed_by: dto.admin_user_id,
    });

    for (const keyId of dto.key_ids) {
      await this.db.update('product_keys', { id: keyId }, {
        key_state: 'used',
        is_used: true,
        order_id: newOrder.id,
        used_at: now,
      });
    }

    try {
      await this.db.insert('admin_actions', {
        admin_user_id: dto.admin_user_id,
        admin_email: dto.admin_email,
        action_type: 'keys_manual_sell',
        target_type: 'orders',
        target_id: newOrder.id,
        details: {
          key_count: dto.key_ids.length,
          key_ids: dto.key_ids,
          buyer_email: dto.buyer_email,
          order_id: newOrder.id,
          price_cents: dto.price_cents,
          currency: dto.currency,
        },
        ip_address: dto.client_ip,
        user_agent: dto.user_agent,
        client_channel: 'crm',
      });
    } catch (auditErr) {
      logger.error('Failed to write manual-sell audit log', auditErr as Error, {
        order_id: newOrder.id,
      });
    }

    return {
      order_id: newOrder.id,
      order_number: newOrder.order_number,
      keys_sold: dto.key_ids.length,
    };
  }

  async decryptAndAuditKeys(
    dto: DecryptKeysOrchestrateDto,
    decryptFn: (row: {
      id: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
    }) => Promise<string>,
  ): Promise<DecryptKeysOrchestrateResult> {
    const rows = await this.db.query<{
      id: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
    }>('product_keys', {
      select: 'id, encrypted_key, encryption_iv, encryption_salt, encryption_key_id',
      in: [['id', dto.key_ids]],
    });

    const decrypted: Array<{ id: string; decrypted_value: string }> = [];
    const failures: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      if (!row.encrypted_key || !row.encryption_iv || !row.encryption_salt) {
        failures.push({ id: row.id, error: 'Missing encryption data' });
        continue;
      }
      try {
        const value = await decryptFn(row);
        decrypted.push({ id: row.id, decrypted_value: value });
      } catch (err) {
        logger.error('Key decryption failed', err as Error, { keyId: row.id });
        failures.push({ id: row.id, error: 'Decryption failed' });
      }
    }

    try {
      await this.db.insert('admin_actions', {
        admin_user_id: dto.admin_user_id,
        admin_email: dto.admin_email,
        action_type: 'keys_decrypt',
        target_type: 'product_keys',
        target_id: dto.key_ids.length === 1 ? dto.key_ids[0] : null,
        details: {
          key_count: dto.key_ids.length,
          key_ids: dto.key_ids,
          decrypted_count: decrypted.length,
          failed_count: failures.length,
          variant_id: dto.variant_id_context,
        },
        ip_address: dto.client_ip,
        user_agent: dto.user_agent,
        client_channel: 'crm',
      });
    } catch (auditErr) {
      logger.error('Failed to write decrypt audit log', auditErr as Error);
    }

    return { keys: decrypted, failures };
  }

  async exportKeysCsv(
    dto: ExportKeysDto,
    decryptFn: (row: {
      id: string;
      encrypted_key: string | null;
      encryption_iv: string | null;
      encryption_salt: string | null;
      encryption_key_id: string | null;
    }) => Promise<string>,
  ): Promise<ExportKeysResult> {
    const rows = await this.db.query<{
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
      in: [['id', dto.key_ids]],
    });

    const variantIds = [...new Set(rows.map((r) => r.variant_id))];
    const variantProductMap = new Map<string, string>();
    const productNameMap = new Map<string, string>();

    if (variantIds.length > 0) {
      const variants = await this.db.query<{ id: string; product_id: string }>(
        'product_variants',
        { select: 'id, product_id', in: [['id', variantIds]] },
      );
      for (const v of variants) variantProductMap.set(v.id, v.product_id);

      const productIds = [...new Set(variants.map((v) => v.product_id))];
      if (productIds.length > 0) {
        const products = await this.db.query<{ id: string; name: string }>(
          'products',
          { select: 'id, name', in: [['id', productIds]] },
        );
        for (const p of products) productNameMap.set(p.id, p.name);
      }
    }

    const csvLines: string[] = ['key_id,product,variant_id,key_value,key_state,added_at'];
    for (const row of rows) {
      let keyValue = '';
      if (row.encrypted_key && row.encryption_iv && row.encryption_salt) {
        try {
          keyValue = await decryptFn(row);
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
      await this.db.insert('admin_actions', {
        admin_user_id: dto.admin_user_id,
        admin_email: dto.admin_email,
        action_type: 'keys_export',
        target_type: 'product_keys',
        target_id: null,
        details: {
          key_count: dto.key_ids.length,
          key_ids: dto.key_ids,
        },
        ip_address: dto.client_ip,
        user_agent: dto.user_agent,
        client_channel: 'crm',
      });
    } catch (auditErr) {
      logger.error('Failed to write export audit log', auditErr as Error);
    }

    if (dto.remove_from_inventory) {
      for (const row of rows) {
        try {
          await this.db.update('product_keys', { id: row.id }, {
            key_state: 'burnt',
            is_used: true,
          });
        } catch (burnErr) {
          logger.error('Failed to mark key as burnt during export', burnErr as Error, {
            keyId: row.id,
          });
        }
      }
    }

    return {
      csv: csvLines.join('\n'),
      exported: rows.length,
      removed: dto.remove_from_inventory,
    };
  }
}
