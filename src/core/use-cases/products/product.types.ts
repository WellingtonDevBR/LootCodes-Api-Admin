export interface ListProductsDto {
  search?: string;
  product_type?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListProductsResult {
  products: unknown[];
  total: number;
}

export interface GetProductDto {
  product_id: string;
}

export interface GetProductResult {
  product: unknown;
  variants: unknown[];
}

export interface CreateProductDto {
  name: string;
  product_type: string;
  category?: string;
  developer?: string;
  publisher?: string;
  description?: string;
  short_description?: string;
  seo_title?: string;
  seo_description?: string;
  tags?: string;
  delivery_type?: string;
  release_date?: string;
  image_url?: string;
  featured?: boolean;
  is_hot_deal?: boolean;
  is_popular?: boolean;
  is_latest_release?: boolean;
  genre_ids?: string[];
  variants?: CreateVariantInput[];
  admin_id: string;
}

export interface CreateVariantInput {
  platform_ids: string[];
  region_id?: string;
  price_usd: number;
  retail_price_usd?: number;
  face_value?: string;
  release_date?: string;
}

export interface CreateProductResult {
  success: boolean;
  product_id: string;
}

export interface UpdateProductDto {
  product_id: string;
  name?: string;
  product_type?: string;
  category?: string;
  developer?: string;
  publisher?: string;
  description?: string;
  short_description?: string;
  seo_title?: string;
  seo_description?: string;
  tags?: string;
  delivery_type?: string;
  release_date?: string;
  image_url?: string;
  featured?: boolean;
  is_hot_deal?: boolean;
  is_popular?: boolean;
  is_latest_release?: boolean;
  admin_id: string;
}

export interface UpdateProductResult {
  success: boolean;
}

export interface DeleteProductDto {
  product_id: string;
  admin_id: string;
}

export interface DeleteProductResult {
  success: boolean;
  action: 'deleted' | 'deactivated';
}

export interface ToggleProductActiveDto {
  product_id: string;
  is_active: boolean;
  admin_id: string;
}

export interface ToggleProductActiveResult {
  success: boolean;
}

export interface CreateVariantDto {
  product_id: string;
  platform_ids: string[];
  region_id?: string;
  price_usd: number;
  retail_price_usd?: number;
  face_value?: string;
  release_date?: string;
  admin_id: string;
}

export interface CreateVariantResult {
  success: boolean;
  variant_id: string;
  sku: string;
}

export interface UpdateVariantDto {
  variant_id: string;
  platform_ids?: string[];
  region_id?: string;
  price_usd?: number;
  retail_price_usd?: number;
  face_value?: string;
  is_active?: boolean;
  activation_instructions?: string;
  image_url?: string;
  force_available?: boolean;
  earn_bps_bonus?: number;
  default_cost_cents?: number | null;
  default_cost_currency?: string | null;
  admin_id: string;
}

export interface UpdateVariantResult {
  success: boolean;
}

export interface DeleteVariantDto {
  variant_id: string;
  admin_id: string;
}

export interface DeleteVariantResult {
  success: boolean;
}

export interface ToggleVariantActiveDto {
  variant_id: string;
  is_active: boolean;
  admin_id: string;
}

export interface ToggleVariantActiveResult {
  success: boolean;
}

export interface ListMetadataResult {
  platforms: Array<{ id: string; name: string; code: string }>;
  regions: Array<{ id: string; name: string; code: string }>;
  genres: Array<{ id: string; name: string; slug: string }>;
}

export interface ListFeaturedResult {
  products: unknown[];
}

export interface UpdateFeaturedFlagsDto {
  product_id: string;
  featured?: boolean;
  is_hot_deal?: boolean;
  is_popular?: boolean;
  is_latest_release?: boolean;
  admin_id: string;
}

export interface UpdateFeaturedFlagsResult {
  success: boolean;
}

export interface ListProductVariantsDto {
  product_id: string;
}

export interface ListProductVariantsResult {
  variants: unknown[];
}
