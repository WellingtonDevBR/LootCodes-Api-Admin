import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
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
} from '../../core/use-cases/products/product.types.js';

@injectable()
export class SupabaseAdminProductRepository implements IAdminProductRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async listProducts(dto: ListProductsDto): Promise<ListProductsResult> {
    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;

    const eq: Array<[string, unknown]> = [];
    if (dto.product_type) eq.push(['product_type', dto.product_type]);
    if (dto.is_active !== undefined) eq.push(['is_active', dto.is_active]);

    const products = await this.db.query('products', {
      eq,
      order: { column: 'created_at', ascending: false },
      limit,
    });

    const filtered = dto.search
      ? products.filter((p) => {
          const record = p as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name : '';
          return name.toLowerCase().includes(dto.search!.toLowerCase());
        })
      : products;

    const allProducts = await this.db.query('products', { eq });
    const total = dto.search
      ? allProducts.filter((p) => {
          const record = p as Record<string, unknown>;
          const name = typeof record.name === 'string' ? record.name : '';
          return name.toLowerCase().includes(dto.search!.toLowerCase());
        }).length
      : allProducts.length;

    const paginated = dto.search ? filtered.slice(offset, offset + limit) : products;

    return { products: paginated, total };
  }

  async getProduct(dto: GetProductDto): Promise<GetProductResult> {
    const product = await this.db.queryOne('products', {
      eq: [['id', dto.product_id]],
    });

    const variants = await this.db.query('product_variants', {
      eq: [['product_id', dto.product_id]],
      order: { column: 'created_at', ascending: true },
    });

    return { product, variants };
  }

  async createProduct(dto: CreateProductDto): Promise<CreateProductResult> {
    const now = new Date().toISOString();

    const product = await this.db.insert<Record<string, unknown>>('products', {
      name: dto.name,
      product_type: dto.product_type,
      category: dto.category ?? null,
      developer: dto.developer ?? null,
      publisher: dto.publisher ?? null,
      description: dto.description ?? null,
      short_description: dto.short_description ?? null,
      seo_title: dto.seo_title ?? null,
      seo_description: dto.seo_description ?? null,
      tags: dto.tags ?? null,
      delivery_type: dto.delivery_type ?? 'instant',
      release_date: dto.release_date ?? null,
      image_url: dto.image_url ?? null,
      featured: dto.featured ?? false,
      is_hot_deal: dto.is_hot_deal ?? false,
      is_popular: dto.is_popular ?? false,
      is_latest_release: dto.is_latest_release ?? false,
      is_active: true,
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
        const variant = await this.db.insert<Record<string, unknown>>('product_variants', {
          product_id: productId,
          region_id: v.region_id ?? null,
          price_usd: v.price_usd,
          retail_price_usd: v.retail_price_usd ?? null,
          face_value: v.face_value ?? null,
          release_date: v.release_date ?? null,
          is_active: true,
          created_at: now,
          updated_at: now,
        });

        const variantId = variant.id as string;

        for (const platformId of v.platform_ids) {
          await this.db.insert('variant_platforms', {
            variant_id: variantId,
            platform_id: platformId,
          });
        }
      }
    }

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

    const variant = await this.db.insert<Record<string, unknown>>('product_variants', {
      product_id: dto.product_id,
      region_id: dto.region_id ?? null,
      price_usd: dto.price_usd,
      retail_price_usd: dto.retail_price_usd ?? null,
      face_value: dto.face_value ?? null,
      release_date: dto.release_date ?? null,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    const variantId = variant.id as string;

    for (const platformId of dto.platform_ids) {
      await this.db.insert('variant_platforms', {
        variant_id: variantId,
        platform_id: platformId,
      });
    }

    const skuResult = await this.db.rpc<Record<string, unknown>>('generate_variant_sku', {
      p_variant_id: variantId,
    });

    const sku = typeof skuResult === 'string' ? skuResult : (skuResult?.sku as string) ?? '';

    return { success: true, variant_id: variantId, sku };
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
}
