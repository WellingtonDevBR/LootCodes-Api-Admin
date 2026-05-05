export interface TestProviderQuoteDto { variant_id: string; provider_code?: string; admin_id: string }
export interface TestProviderQuoteResult { quotes: Array<{ provider: string; price_cents: number; available: boolean }> }

export interface SearchProvidersDto { query: string; limit?: number }
export interface SearchProvidersResult { providers: unknown[] }

export interface ManageProviderOfferDto { variant_id: string; provider_code: string; action: 'link' | 'unlink' | 'update'; offer_data?: Record<string, unknown>; admin_id: string }
export interface ManageProviderOfferResult { success: boolean }

export interface IngestProviderCatalogDto { provider_code: string; admin_id: string }
export interface IngestProviderCatalogResult { job_id: string; status: string }

export interface IngestProviderCatalogStatusDto { job_id: string }
export interface IngestProviderCatalogStatusResult { job_id: string; status: string; progress?: number; error?: string }

export interface RefreshProviderPricesDto { provider_code?: string; admin_id: string }
export interface RefreshProviderPricesResult { success: boolean; prices_updated: number }

export interface ManualProviderPurchaseDto { variant_id: string; provider_code: string; quantity: number; admin_id: string }
export interface ManualProviderPurchaseResult { success: boolean; purchase_id?: string }

export interface RecoverProviderOrderDto { purchase_id: string; admin_id: string }
export interface RecoverProviderOrderResult { success: boolean; new_status: string }

export interface SearchCatalogDto {
  search?: string;
  provider_code?: string;
  page?: number;
  page_size?: number;
}

export interface CatalogProductRow {
  id: string;
  provider_code: string;
  external_product_id: string;
  product_name: string;
  platform: string | null;
  region: string | null;
  min_price_cents: number;
  currency: string;
  qty: number;
  available_to_buy: boolean;
  thumbnail: string | null;
  slug: string | null;
  wholesale_price_cents: number | null;
  updated_at: string;
}

export interface SearchCatalogResult {
  products: CatalogProductRow[];
  total: number;
}

export interface LinkCatalogProductDto {
  variant_id: string;
  provider_code: string;
  external_product_id: string;
  currency: string;
  price_cents: number;
  platform_code?: string;
  region_code?: string;
  admin_id: string;
}

export interface LinkCatalogProductResult {
  offer_id: string;
  seller_listing_id: string | null;
}

export interface LiveSearchProvidersDto {
  query: string;
  max_results?: number;
  exclude_provider_codes?: string[];
}

export interface LiveSearchOffer {
  provider_code: string;
  external_product_id: string;
  product_name: string;
  platform: string | null;
  region: string | null;
  price_cents: number;
  currency: string;
  available: boolean;
  thumbnail?: string | null;
}

export interface LiveSearchProviderGroup {
  provider_code: string;
  offers: LiveSearchOffer[];
}

export interface LiveSearchProvidersResult {
  providers: LiveSearchProviderGroup[];
}
