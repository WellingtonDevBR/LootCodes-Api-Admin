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

// --- Procurement Config ---

export interface ProcurementConfig {
  auto_buy_enabled: boolean;
  daily_spend_limit_cents: number | null;
  max_cost_per_item_cents: number | null;
}

export interface GetProcurementConfigResult {
  config: ProcurementConfig;
  today_spend_cents: number;
}

export interface UpdateProcurementConfigDto {
  auto_buy_enabled?: boolean;
  daily_spend_limit_cents?: number | null;
  max_cost_per_item_cents?: number | null;
  admin_id: string;
}

// --- Purchase Queue ---

export interface PurchaseQueueItemRow {
  id: string;
  order_id: string;
  order_item_id: string;
  variant_id: string;
  quantity_needed: number;
  status: string;
  attempts_total: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
  next_retry_at: string | null;
}

export interface ListPurchaseQueueDto {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ListPurchaseQueueResult {
  items: PurchaseQueueItemRow[];
  total: number;
}

export interface CancelQueueItemDto {
  queue_id: string;
  admin_id: string;
}

export interface CancelQueueItemResult {
  success: boolean;
}

export interface PurchaseAttemptRow {
  id: string;
  queue_id: string;
  provider_account_id: string;
  attempt_no: number;
  status: string;
  provider_order_ref: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface ListPurchaseAttemptsDto {
  queue_id: string;
}

export interface ListPurchaseAttemptsResult {
  attempts: PurchaseAttemptRow[];
}
