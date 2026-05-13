import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase, QueryOptions } from '../../core/ports/database.port.js';
import { sanitizeIlikeTerm } from '../../shared/sanitize-ilike.js';
import type { IAdminInventoryRepository } from '../../core/ports/admin-inventory-repository.port.js';
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
} from '../../core/use-cases/inventory/inventory.types.js';

@injectable()
export class SupabaseAdminInventoryRepository implements IAdminInventoryRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
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
}
