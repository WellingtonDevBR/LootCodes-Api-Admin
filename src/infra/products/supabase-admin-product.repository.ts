import { randomUUID } from 'node:crypto';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import { InternalError } from '../../core/errors/domain-errors.js';
import type { IDatabase, QueryOptions } from '../../core/ports/database.port.js';
import { sanitizeIlikeTerm } from '../../shared/sanitize-ilike.js';
import type { IAdminProductRepository } from '../../core/ports/admin-product-repository.port.js';
import type {
  ListProductsDto, ListProductsResult,
  GetProductDto, GetProductResult,
  CreateProductDto, CreateProductResult,
  UpdateProductDto, UpdateProductResult,
  DeleteProductDto, DeleteProductResult,
  ToggleProductActiveDto, ToggleProductActiveResult,
  CreateVariantDto, CreateVariantResult,
  UpdateVariantDto, UpdateVariantResult,
  DeleteVariantDto, DeleteVariantResult,
  ToggleVariantActiveDto, ToggleVariantActiveResult,
  ListMetadataResult,
  ListFeaturedResult,
  UpdateFeaturedFlagsDto, UpdateFeaturedFlagsResult,
  ListProductVariantsDto, ListProductVariantsResult,
  GetContentStatusDto, ContentPipelineStatus, ContentQueueStatus,
  RegenerateContentDto, RegenerateContentResult,
} from '../../core/use-cases/products/product.types.js';

@injectable()
export class SupabaseAdminProductRepository implements IAdminProductRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  /**
   * Inserts a variant with a placeholder SKU (NOT NULL), links platforms, then replaces SKU via
   * `generate_variant_sku` (RPC reads variant_platforms — cannot run before platform rows exist).
   */
  private async insertVariantWithPlatformsAndSku(params: {
    readonly product_id: string;
    readonly region_id: string;
    readonly platform_ids: readonly string[];
    readonly price_usd: number;
    readonly retail_price_usd?: number | null;
    readonly face_value?: string | null;
    readonly release_date?: string | null;
    readonly nowIso: string;
  }): Promise<{ variant_id: string; sku: string }> {
    // Defense-in-depth: callers (create-variant use-case + create-product flow)
    // already validate region_id, but a regression slipped a null past validation
    // once (LOOTCODES-API-C). Fail fast with a clear error before touching Postgres.
    if (!params.region_id || typeof params.region_id !== 'string' || params.region_id.trim() === '') {
      throw new InternalError('insertVariantWithPlatformsAndSku: region_id is required');
    }
    if (!params.product_id || typeof params.product_id !== 'string' || params.product_id.trim() === '') {
      throw new InternalError('insertVariantWithPlatformsAndSku: product_id is required');
    }
    const placeholderSku = `SKU-TEMP-${randomUUID().replace(/-/g, '')}`;
    const variant = await this.db.insert<Record<string, unknown>>('product_variants', {
      product_id: params.product_id,
      region_id: params.region_id,
      price_usd: params.price_usd,
      retail_price_usd: params.retail_price_usd ?? null,
      face_value: params.face_value ?? null,
      release_date: params.release_date ?? null,
      is_active: true,
      sku: placeholderSku,
      created_at: params.nowIso,
      updated_at: params.nowIso,
    });

    const variantId = variant.id as string;

    for (const platformId of params.platform_ids) {
      await this.db.insert('variant_platforms', {
        variant_id: variantId,
        platform_id: platformId,
      });
    }

    const generated = await this.db.rpc<string>('generate_variant_sku', {
      p_variant_id: variantId,
    });
    const sku = typeof generated === 'string' ? generated.trim() : '';
    if (!sku) {
      throw new InternalError('generate_variant_sku returned an empty SKU');
    }

    await this.db.update('product_variants', { id: variantId }, {
      sku,
      updated_at: new Date().toISOString(),
    });

    return { variant_id: variantId, sku };
  }

  private async batchedQuery<T>(
    table: string,
    column: string,
    ids: string[],
    options: Omit<QueryOptions, 'in'>,
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

  async listProducts(dto: ListProductsDto): Promise<ListProductsResult> {
    const limit = Math.min(Math.max(dto.limit ?? 50, 1), 200);
    const offset = Math.max(dto.offset ?? 0, 0);
    const range: [number, number] = [offset, offset + limit - 1];

    const eq: Array<[string, unknown]> = [];
    if (dto.product_type) eq.push(['product_type', dto.product_type]);
    if (dto.is_active !== undefined) eq.push(['is_active', dto.is_active]);

    const rawSearch = dto.search?.trim() ?? '';
    const searchTerm = rawSearch.length > 0 ? sanitizeIlikeTerm(rawSearch) : '';

    const listQuery: QueryOptions = {
      select: '*',
      order: { column: 'name', ascending: true },
      range,
    };
    if (eq.length > 0) listQuery.eq = eq;
    if (searchTerm.length > 0) {
      const pattern = `%${searchTerm}%`;
      listQuery.or = `name.ilike.${pattern},slug.ilike.${pattern}`;
    }

    const { data: pageRows, total } = await this.db.queryPaginated<Record<string, unknown>>('products', listQuery);

    const productIds = pageRows.map(p => p.id as string);
    if (productIds.length === 0) {
      return { products: [], total };
    }

    const allVariants = await this.batchedQuery<{ id: string; product_id: string }>(
      'product_variants', 'product_id', productIds, { select: 'id, product_id' },
    );

    const variantsByProduct = new Map<string, string[]>();
    for (const v of allVariants) {
      const arr = variantsByProduct.get(v.product_id) ?? [];
      arr.push(v.id);
      variantsByProduct.set(v.product_id, arr);
    }

    const allVariantIds = allVariants.map(v => v.id);

    const [availableKeys, activeListings] = await Promise.all([
      this.batchedQuery<{ variant_id: string }>('product_keys', 'variant_id', allVariantIds, { select: 'variant_id', eq: [['key_state', 'available']] }),
      this.batchedQuery<{ variant_id: string }>('seller_listings', 'variant_id', allVariantIds, { select: 'variant_id', eq: [['status', 'active']] }),
    ]);

    const stockByVariant = new Map<string, number>();
    for (const k of availableKeys) {
      stockByVariant.set(k.variant_id, (stockByVariant.get(k.variant_id) ?? 0) + 1);
    }

    const listingVariants = new Set(activeListings.map(l => l.variant_id));

    type EnrichedProduct = Record<string, unknown> & {
      variant_count: number;
      total_stock: number;
      linked_channel_count: number;
    };

    const enriched: EnrichedProduct[] = pageRows.map(p => {
      const pid = p.id as string;
      const variantIds = variantsByProduct.get(pid) ?? [];
      let totalStock = 0;
      let channelCount = 0;
      for (const vid of variantIds) {
        totalStock += stockByVariant.get(vid) ?? 0;
        if (listingVariants.has(vid)) channelCount++;
      }
      return { ...p, variant_count: variantIds.length, total_stock: totalStock, linked_channel_count: channelCount };
    });

    enriched.sort((a, b) => {
      const aTier = a.total_stock > 0 ? 0 : a.linked_channel_count > 0 ? 1 : 2;
      const bTier = b.total_stock > 0 ? 0 : b.linked_channel_count > 0 ? 1 : 2;
      if (aTier !== bTier) return aTier - bTier;
      return ((a.name as string) ?? '').localeCompare((b.name as string) ?? '');
    });

    return { products: enriched, total };
  }

  async getProduct(dto: GetProductDto): Promise<GetProductResult> {
    const product = await this.db.queryOne('products', {
      eq: [['id', dto.product_id]],
    });

    const rawVariants = await this.db.query<Record<string, unknown>>('product_variants', {
      eq: [['product_id', dto.product_id]],
      order: { column: 'created_at', ascending: true },
    });

    const allPlatforms = await this.db.query<Record<string, unknown>>('product_platforms', {});
    const allRegions = await this.db.query<Record<string, unknown>>('product_regions', {});

    const variants = await Promise.all(
      rawVariants.map(async (v) => {
        const variantId = v.id as string;

        const vp = await this.db.query<Record<string, unknown>>('variant_platforms', {
          eq: [['variant_id', variantId]],
        });
        const platformIds = vp.map((row) => row.platform_id as string);
        const platformNames = platformIds
          .map((pid) => allPlatforms.find((p) => p.id === pid))
          .filter(Boolean)
          .map((p) => (p as Record<string, unknown>).name as string);

        let regionName: string | null = null;
        if (v.region_id) {
          const region = allRegions.find((r) => r.id === v.region_id);
          regionName = region ? (region.name as string) : null;
        }

        const [availableResult, reservedResult, soldResult] = await Promise.all([
          this.db.queryPaginated('product_keys', {
            eq: [['variant_id', variantId], ['key_state', 'available']],
            select: 'id', limit: 1,
          }),
          this.db.queryPaginated('product_keys', {
            eq: [['variant_id', variantId]],
            in: [['key_state', ['assigned', 'seller_reserved']]],
            select: 'id', limit: 1,
          }),
          this.db.queryPaginated('product_keys', {
            eq: [['variant_id', variantId]],
            in: [['key_state', ['revealed', 'used', 'seller_provisioned']]],
            select: 'id', limit: 1,
          }),
        ]);
        const stockAvailable = availableResult.total;
        const stockReserved = reservedResult.total;
        const stockSold = soldResult.total;

        return {
          ...v,
          platform_ids: platformIds,
          platform_names: platformNames,
          region_name: regionName,
          stock_available: stockAvailable,
          stock_reserved: stockReserved,
          stock_sold: stockSold,
        };
      }),
    );

    return { product, variants };
  }

  async createProduct(dto: CreateProductDto): Promise<CreateProductResult> {
    const now = new Date().toISOString();

    const product = await this.db.insert<Record<string, unknown>>('products', {
      name: dto.name,
      product_type: dto.product_type,
      category: dto.category ?? 'games',
      developer: dto.developer ?? null,
      publisher: dto.publisher ?? null,
      description: dto.description ?? null,
      short_description: dto.short_description ?? null,
      seo_title: dto.seo_title ?? null,
      seo_description: dto.seo_description ?? null,
      tags: dto.tags ?? [],
      delivery_type: dto.delivery_type ?? 'instant',
      release_date: dto.release_date ?? null,
      image_url: dto.image_url ?? null,
      featured: dto.featured ?? false,
      is_hot_deal: dto.is_hot_deal ?? false,
      is_popular: dto.is_popular ?? false,
      is_latest_release: dto.is_latest_release ?? false,
      is_active: true,
      platform: 'multi',
      currency: 'USD',
      price_usd: 0,
      force_available: false,
      created_by: dto.admin_id,
      created_at: now,
      updated_at: now,
    });

    const productId = product.id as string;

    if (dto.genre_ids?.length) {
      for (const genreId of dto.genre_ids) {
        await this.db.insert('product_genres', {
          product_id: productId,
          genre_id: genreId,
        });
      }
    }

    if (dto.variants?.length) {
      for (const v of dto.variants) {
        if (!v.region_id) {
          throw new InternalError('Each variant requires region_id when creating a product with variants');
        }
        await this.insertVariantWithPlatformsAndSku({
          product_id: productId,
          region_id: v.region_id,
          platform_ids: v.platform_ids,
          price_usd: v.price_usd,
          retail_price_usd: v.retail_price_usd ?? null,
          face_value: v.face_value ?? null,
          release_date: v.release_date ?? null,
          nowIso: now,
        });
      }
    }

    if (!dto.image_url) {
      try {
        await this.db.insert('product_media_queue', {
          product_id: productId,
          status: 'pending',
          priority: 5,
          created_at: now,
        });
      } catch { /* non-blocking — media queue may not exist yet */ }
    }

    try {
      await this.db.insert('admin_actions', {
        admin_user_id: dto.admin_id,
        action_type: 'product_create',
        target_type: 'product',
        target_id: productId,
        details: { name: dto.name, product_type: dto.product_type },
      });
    } catch { /* non-blocking audit */ }

    return { success: true, product_id: productId };
  }

  async updateProduct(dto: UpdateProductDto): Promise<UpdateProductResult> {
    const data: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.product_type !== undefined) data.product_type = dto.product_type;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.developer !== undefined) data.developer = dto.developer;
    if (dto.publisher !== undefined) data.publisher = dto.publisher;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.short_description !== undefined) data.short_description = dto.short_description;
    if (dto.seo_title !== undefined) data.seo_title = dto.seo_title;
    if (dto.seo_description !== undefined) data.seo_description = dto.seo_description;
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.delivery_type !== undefined) data.delivery_type = dto.delivery_type;
    if (dto.release_date !== undefined) data.release_date = dto.release_date;
    if (dto.image_url !== undefined) data.image_url = dto.image_url;
    if (dto.featured !== undefined) data.featured = dto.featured;
    if (dto.is_hot_deal !== undefined) data.is_hot_deal = dto.is_hot_deal;
    if (dto.is_popular !== undefined) data.is_popular = dto.is_popular;
    if (dto.is_latest_release !== undefined) data.is_latest_release = dto.is_latest_release;

    await this.db.update('products', { id: dto.product_id }, data);
    return { success: true };
  }

  async deleteProduct(dto: DeleteProductDto): Promise<DeleteProductResult> {
    const orders = await this.db.query('order_items', {
      eq: [['product_id', dto.product_id]],
      limit: 1,
    });

    if (orders.length > 0) {
      await this.db.update('products', { id: dto.product_id }, {
        is_active: false,
        updated_at: new Date().toISOString(),
      });
      return { success: true, action: 'deactivated' };
    }

    await this.db.delete('products', { id: dto.product_id });
    return { success: true, action: 'deleted' };
  }

  async toggleProductActive(dto: ToggleProductActiveDto): Promise<ToggleProductActiveResult> {
    await this.db.update('products', { id: dto.product_id }, {
      is_active: dto.is_active,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async listProductVariants(dto: ListProductVariantsDto): Promise<ListProductVariantsResult> {
    const variants = await this.db.query('product_variants', {
      eq: [['product_id', dto.product_id]],
      order: { column: 'created_at', ascending: true },
    });
    return { variants };
  }

  async createVariant(dto: CreateVariantDto): Promise<CreateVariantResult> {
    const now = new Date().toISOString();

    if (!dto.region_id) {
      throw new InternalError('region_id is required to create a variant');
    }

    const { variant_id, sku } = await this.insertVariantWithPlatformsAndSku({
      product_id: dto.product_id,
      region_id: dto.region_id,
      platform_ids: dto.platform_ids,
      price_usd: dto.price_usd,
      retail_price_usd: dto.retail_price_usd ?? null,
      face_value: dto.face_value ?? null,
      release_date: dto.release_date ?? null,
      nowIso: now,
    });

    return { success: true, variant_id, sku };
  }

  async updateVariant(dto: UpdateVariantDto): Promise<UpdateVariantResult> {
    const data: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (dto.region_id !== undefined) data.region_id = dto.region_id;
    if (dto.price_usd !== undefined) data.price_usd = dto.price_usd;
    if (dto.retail_price_usd !== undefined) data.retail_price_usd = dto.retail_price_usd;
    if (dto.face_value !== undefined) data.face_value = dto.face_value;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.activation_instructions !== undefined) data.activation_instructions = dto.activation_instructions;
    if (dto.image_url !== undefined) data.image_url = dto.image_url;
    if (dto.force_available !== undefined) data.force_available = dto.force_available;
    if (dto.earn_bps_bonus !== undefined) data.earn_bps_bonus = dto.earn_bps_bonus;
    if (dto.default_cost_cents !== undefined) data.default_cost_cents = dto.default_cost_cents;
    if (dto.default_cost_currency !== undefined) data.default_cost_currency = dto.default_cost_currency;

    await this.db.update('product_variants', { id: dto.variant_id }, data);

    if (dto.platform_ids) {
      await this.db.delete('variant_platforms', { variant_id: dto.variant_id });
      for (const platformId of dto.platform_ids) {
        await this.db.insert('variant_platforms', {
          variant_id: dto.variant_id,
          platform_id: platformId,
        });
      }
    }

    return { success: true };
  }

  async deleteVariant(dto: DeleteVariantDto): Promise<DeleteVariantResult> {
    await this.db.delete('variant_platforms', { variant_id: dto.variant_id });
    await this.db.delete('product_variants', { id: dto.variant_id });
    return { success: true };
  }

  async toggleVariantActive(dto: ToggleVariantActiveDto): Promise<ToggleVariantActiveResult> {
    await this.db.update('product_variants', { id: dto.variant_id }, {
      is_active: dto.is_active,
      updated_at: new Date().toISOString(),
    });
    return { success: true };
  }

  async listMetadata(): Promise<ListMetadataResult> {
    const [platforms, regions, genres] = await Promise.all([
      this.db.query<{ id: string; name: string; code: string }>('product_platforms', {
        order: { column: 'name', ascending: true },
      }),
      this.db.query<{ id: string; name: string; code: string }>('product_regions', {
        order: { column: 'name', ascending: true },
      }),
      this.db.query<{ id: string; name: string; slug: string }>('genres', {
        order: { column: 'name', ascending: true },
      }),
    ]);

    return { platforms, regions, genres };
  }

  async listFeatured(): Promise<ListFeaturedResult> {
    const products = await this.db.query('products', {
      eq: [['is_active', true]],
    });

    const featured = products.filter((p) => {
      const record = p as Record<string, unknown>;
      return record.featured === true
        || record.is_hot_deal === true
        || record.is_popular === true
        || record.is_latest_release === true;
    });

    return { products: featured };
  }

  async updateFeaturedFlags(dto: UpdateFeaturedFlagsDto): Promise<UpdateFeaturedFlagsResult> {
    const data: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (dto.featured !== undefined) data.featured = dto.featured;
    if (dto.is_hot_deal !== undefined) data.is_hot_deal = dto.is_hot_deal;
    if (dto.is_popular !== undefined) data.is_popular = dto.is_popular;
    if (dto.is_latest_release !== undefined) data.is_latest_release = dto.is_latest_release;

    await this.db.update('products', { id: dto.product_id }, data);
    return { success: true };
  }

  async getContentPipelineStatus(dto: GetContentStatusDto): Promise<ContentPipelineStatus> {
    const aiRows = await this.db.query<Record<string, unknown>>('ai_content_generation_queue', {
      eq: [['product_id', dto.product_id]],
    });

    const getAiStatus = (contentType: string): ContentQueueStatus => {
      const row = aiRows.find(r => r.content_type === contentType);
      if (!row) return 'not_queued';
      return row.status as ContentQueueStatus;
    };

    let mediaStatus: ContentQueueStatus = 'not_queued';
    const mediaRows = await this.db.query<Record<string, unknown>>('product_media_queue', {
      eq: [['product_id', dto.product_id]],
      limit: 1,
    });
    if (mediaRows.length > 0) {
      mediaStatus = mediaRows[0].status as ContentQueueStatus;
    }

    return {
      ai: {
        description: getAiStatus('product_description'),
        translations: getAiStatus('product_translations'),
        platformContent: getAiStatus('platform_content'),
      },
      media: mediaStatus,
    };
  }

  async regenerateContent(dto: RegenerateContentDto): Promise<RegenerateContentResult> {
    const queued: string[] = [];
    const now = new Date().toISOString();
    const targets = dto.target === 'all'
      ? ['description', 'translations', 'platform_content', 'media']
      : [dto.target];

    for (const target of targets) {
      if (target === 'media') {
        const existing = await this.db.query<Record<string, unknown>>('product_media_queue', {
          eq: [['product_id', dto.product_id]],
          limit: 1,
        });
        if (existing.length > 0) {
          await this.db.update('product_media_queue', { product_id: dto.product_id }, {
            status: 'pending',
            attempts: 0,
            last_error: null,
            processed_at: null,
          });
        } else {
          await this.db.insert('product_media_queue', {
            product_id: dto.product_id,
            status: 'pending',
            priority: 5,
            created_at: now,
          });
        }
        queued.push('media');
        continue;
      }

      const contentTypeMap: Record<string, string> = {
        description: 'product_description',
        translations: 'product_translations',
        platform_content: 'platform_content',
      };
      const contentType = contentTypeMap[target];
      if (!contentType) continue;

      const existing = await this.db.query<Record<string, unknown>>('ai_content_generation_queue', {
        eq: [['product_id', dto.product_id], ['content_type', contentType]],
        limit: 1,
      });

      if (existing.length > 0) {
        await this.db.update(
          'ai_content_generation_queue',
          { id: existing[0].id as string },
          { status: 'pending', attempts: 0, last_error: null, processed_at: null, completed_at: null },
        );
      } else {
        const product = await this.db.queryOne<Record<string, unknown>>('products', {
          eq: [['id', dto.product_id]],
          select: 'name',
        });
        await this.db.insert('ai_content_generation_queue', {
          product_id: dto.product_id,
          content_type: contentType,
          status: 'pending',
          priority: contentType === 'product_description' ? 10 : 7,
          product_name: (product?.name as string) ?? null,
          created_at: now,
        });
      }
      queued.push(target);
    }

    try {
      await this.db.insert('admin_actions', {
        admin_user_id: dto.admin_id,
        action_type: 'regenerate_content',
        target_type: 'product',
        target_id: dto.product_id,
        details: { target: dto.target, queued },
      });
    } catch { /* non-blocking audit */ }

    return { success: true, queued };
  }
}
