export interface TestProviderQuoteDto { variant_id: string; provider_code?: string; admin_id: string }

/** One row per linked `provider_variant_offers` snapshot returned by POST `/procurement/quote`. */
export interface TestProviderQuoteQuoteRow {
  readonly provider: string;
  readonly price_cents: number;
  /** True only when quantity is known and positive (never inferred from unknown stock). */
  readonly available: boolean;
  readonly available_quantity: number | null;
}

export interface TestProviderQuoteResult { quotes: TestProviderQuoteQuoteRow[] }

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

export interface ManualProviderPurchaseDto {
  variant_id: string;
  provider_code: string;
  /** Provider-native offer / product id (e.g. Bamboo ProductId), not `provider_variant_offers.id`. */
  offer_id: string;
  quantity: number;
  admin_id: string;
  /**
   * Bamboo: wallet currency to debit (GET accounts + catalog TargetCurrency). ISO 4217, e.g. USD, EUR.
   * Defaults to `api_profile.checkout_wallet_currency` or USD.
   */
  wallet_currency?: string;
}

/** Native in-process JIT purchase (marketplace reserve) — Bamboo only; uses linked `provider_variant_offers` row. */
export interface JitBambooPurchaseDto {
  variant_id: string;
  /** Must match the linked offer row (`provider_variant_offers.provider_account_id`). */
  provider_account_id: string;
  /** Bamboo catalog product id (`provider_variant_offers.external_offer_id`). */
  offer_id: string;
  quantity: number;
  /**
   * When set, attributes the attempt to this user. When omitted, `manual_admin_user_id` / key `created_by`
   * stay null — marketplace JIT is recorded as API automation (`response_snapshot.procurement_trigger`).
   */
  admin_user_id?: string;
  /** Stable per-attempt idempotency key (e.g. `jit-{variant}-{reservation}-{random}`). */
  idempotency_key: string;
  wallet_currency?: string;
}

/** Returned when key ingestion fails after a successful provider charge (admin-only surface). */
export interface ManualPurchaseFailedIngestion {
  readonly index: number;
  readonly stage: string;
  readonly error: string;
  readonly plaintext_key: string;
}

export interface ManualProviderPurchaseResult {
  success: boolean;
  purchase_id?: string;
  error?: string;
  provider_order_ref?: string;
  recoverable?: boolean;
  key_ids?: readonly string[];
  partial_failure?: boolean;
  keys_received?: number;
  keys_ingested?: number;
  failed_ingestions?: readonly ManualPurchaseFailedIngestion[];
}

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
  /** Parent listing / service id when provider nests SKUs (e.g. AppRoute service UUID vs denomination id). */
  external_parent_product_id: string | null;
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
  /** AppRoute: parent service id for GET /services/{id}; optional — resolved from catalog when omitted. */
  external_parent_product_id?: string;
  currency: string;
  price_cents: number;
  platform_code?: string;
  region_code?: string;
  admin_id: string;
  /**
   * When false, only wires marketplace seller integration — no `provider_variant_offers` row.
   * When omitted or true, legacy behavior (procurement offer is created).
   */
  create_procurement_offer?: boolean;
}

export interface LinkCatalogProductMarketplacePublishSnap {
  listing_id: string;
  external_listing_id: string;
  status: string;
  skipped_already_published: boolean;
}

export interface LinkCatalogProductResult {
  offer_id: string | null;
  seller_listing_id: string | null;
  marketplace_publish?: LinkCatalogProductMarketplacePublishSnap | null;
}

export interface LiveSearchProvidersDto {
  query: string;
  max_results?: number;
  exclude_provider_codes?: string[];
}

/** Returned with every live-search response for CRM visibility / ops audit (bootstrap vs runtime). */
export interface LiveSearchDiagnostics {
  readonly registered_provider_codes: string[];
  readonly live_http_provider_codes: string[];
  readonly catalog_fallback_provider_codes: string[];
  readonly hints: string[];
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
  diagnostics: LiveSearchDiagnostics;
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
