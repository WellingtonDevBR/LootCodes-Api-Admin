export interface EmitInventoryStockChangedDto {
  product_ids: string[];
  reason: string;
  admin_id: string;
}

export interface EmitInventoryStockChangedResult {
  success: boolean;
}

export interface SendStockNotificationsNowDto {
  admin_id: string;
}

export interface SendStockNotificationsNowResult {
  success: boolean;
  notifications_sent: number;
}

export interface ReplaceKeyDto {
  order_item_id: string;
  old_key_id: string;
  admin_id: string;
}

export interface ReplaceKeyResult {
  success: boolean;
  new_key_id?: string;
}

export interface FixKeyStatesDto {
  variant_id: string;
  admin_id: string;
}

export interface FixKeyStatesResult {
  success: boolean;
  keys_fixed: number;
}

export interface UpdateAffectedKeyDto {
  key_id: string;
  new_status: string;
  admin_id: string;
}

export interface UpdateAffectedKeyResult {
  success: boolean;
}

export interface DecryptKeysDto {
  key_ids: string[];
  admin_id: string;
}

export interface DecryptKeysResult {
  keys: Array<{ id: string; decrypted_value: string }>;
}

export interface RecryptProductKeysDto {
  product_id: string;
  admin_id: string;
}

export interface RecryptProductKeysResult {
  success: boolean;
  keys_recrypted: number;
}

export interface SetKeysSalesBlockedDto {
  key_ids: string[];
  blocked: boolean;
  admin_id: string;
}

export interface SetKeysSalesBlockedResult {
  success: boolean;
  keys_updated: number;
}

export interface SetVariantSalesBlockedDto {
  variant_id: string;
  blocked: boolean;
  admin_id: string;
}

export interface SetVariantSalesBlockedResult {
  success: boolean;
}

export interface MarkKeysFaultyDto {
  key_ids: string[];
  admin_id: string;
  reason: string;
}

export interface MarkKeysFaultyKeyResult {
  key_id: string;
  /** 'marked_faulty' | 'state_locked:<state>' | 'not_found' */
  outcome: string;
  write_off_cents: number;
}

export interface MarkKeysFaultyResult {
  success: boolean;
  keys_marked: number;
  results: MarkKeysFaultyKeyResult[];
}

export interface LinkReplacementKeyDto {
  original_key_id: string;
  replacement_key_id: string;
  admin_id: string;
}

export interface LinkReplacementKeyResult {
  success: boolean;
}

export interface ManualSellDto {
  variant_id: string;
  quantity: number;
  buyer_email: string;
  admin_id: string;
}

export interface ManualSellResult {
  success: boolean;
  order_id?: string;
}

export interface UpdateVariantPriceDto {
  variant_id: string;
  price_cents: number;
  admin_id: string;
}

export interface UpdateVariantPriceResult {
  success: boolean;
}

export interface GetInventoryCatalogDto {
  limit?: number;
  offset?: number;
  search?: string;
}

export interface InventoryCatalogRow {
  product_id: string;
  product_name: string;
  variant_id: string;
  sku: string | null;
  face_value: string | null;
  region_name: string | null;
  platform_name: string | null;
  /** Count of physical keys in `product_keys` with `key_state = available`.
   *  Declared marketplace stock is intentionally excluded — it is not inventory we own. */
  stock_available: number;
  stock_reserved: number;
  stock_sold: number;
  price_usd: number;
  is_active: boolean;
  category: string | null;
  supplier_ids: string[];
  purchaser_ids: string[];
  default_cost_cents: number | null;
  default_cost_currency: string | null;
  /** Cheapest `last_price_cents` across active buy-provider offers (`provider_variant_offers`).
   *  Null when no offer has a price snapshot yet. */
  best_provider_cost_cents: number | null;
  best_provider_cost_currency: string | null;
  /** Sum of `declared_stock` across all active seller listings for this variant.
   *  Zero when the variant has no active marketplace listings. */
  total_declared_stock: number;
  /** Count of seller listings in `status = 'paused'` for this variant.
   *  Zero when none exist. Shown in the CRM as a warning badge. */
  paused_listing_count: number;
}

export interface ProviderAccountInfo {
  id: string;
  display_name: string;
  supports_seller: boolean;
}

export interface GetInventoryCatalogResult {
  rows: InventoryCatalogRow[];
  providers: ProviderAccountInfo[];
}

// --- Variant Context (seller detail page) ---

export interface GetVariantContextDto {
  variant_id: string;
}

export interface GetVariantContextResult {
  id: string;
  product_name: string;
  edition: string | null;
  platform_names: string[];
  region_name: string | null;
  sku: string;
  stock_available: number;
  price_usd: number;
}

// --- Upload Keys ---

export interface UploadKeysDto {
  variant_id: string;
  keys: string[];
  purchase_cost?: number;
  purchase_currency?: string;
  /** 'total' splits the cost evenly across all keys; 'per_key' treats cost as individual. */
  price_mode?: 'total' | 'per_key';
  supplier_reference?: string | null;
  marketplace_eligible?: boolean;
  allowed_seller_provider_account_ids?: string[] | null;
  allow_duplicates?: boolean;
  admin_user_id: string;
  admin_email: string | null;
  client_ip: string;
  user_agent: string | null;
}

export interface UploadKeysResult {
  uploaded: number;
  duplicates: number;
}

// --- KPIs ---

export interface GetInventoryKpisResult {
  availableKeyCount: number;
  /** USD-converted sum of `purchase_cost` across all `available` keys. */
  purchaseCostUsdTotal: number;
}

// --- List Keys ---

export interface ListKeysDto {
  productId?: string;
  variantId?: string;
  /** Comma-separated allowed key_state values (already validated by caller). */
  state?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface ListKeysKeyRow {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  variantSku: string | null;
  variantFaceValue: string | null;
  variantRegionName: string | null;
  key: string;
  keyState: string;
  supplierId: string;
  supplierName: string;
  addedAt: string;
  usedAt: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderChannel: string | null;
  marketplaceName: string | null;
  soldTo: string | null;
  purchaseCost: number | null;
  purchaseCurrency: string | null;
  locked: boolean;
}

export interface ListKeysResult {
  keys: ListKeysKeyRow[];
  total: number;
  page: number;
  pageSize: number;
}

// --- List Variant Keys ---

export interface ListVariantKeysDto {
  variant_id: string;
  /** Comma-separated allowed key_state values. */
  key_state?: string;
  limit?: number;
  offset?: number;
}

export interface ListVariantKeysKeyRow {
  id: string;
  masked_value: string;
  keyState: string;
  created_at: string;
  sold_at: string | null;
  order_id: string | null;
  is_sales_blocked: boolean;
  is_faulty: boolean;
  purchase_cost: number | null;
  purchase_currency: string | null;
}

export interface ListVariantKeysResult {
  keys: ListVariantKeysKeyRow[];
  total: number;
  available: number;
  reserved: number;
  sold: number;
}

// --- Lookup Keys by Value (plaintext hash) ---

export interface LookupKeysByValueDto {
  key_values: string[];
}

export interface LookupKeysByValueRow {
  input_value: string;
  matched: boolean;
  key_id: string | null;
  key_state: string | null;
  product_name: string | null;
  variant_sku: string | null;
  order_id: string | null;
}

export interface LookupKeysByValueResult {
  results: LookupKeysByValueRow[];
  matched: number;
  total: number;
}

// --- Bulk burn keys (available → burnt) ---

export interface BulkBurnKeysDto {
  key_ids: string[];
}

export interface BulkBurnKeysRow {
  key_id: string;
  outcome: string;
}

export interface BulkBurnKeysResult {
  success: boolean;
  keys_marked: number;
  results: BulkBurnKeysRow[];
}

// --- Manual sell ---

export interface ManualSellKeysDto {
  key_ids: string[];
  buyer_email: string;
  buyer_name: string | null;
  notes: string | null;
  price_cents: number;
  currency: string;
  admin_user_id: string;
  admin_email: string | null;
  client_ip: string;
  user_agent: string | null;
}

export interface ManualSellKeysResult {
  order_id: string;
  order_number: string;
  keys_sold: number;
}

// --- Decrypt keys (audit + notify orchestration) ---

export interface DecryptKeysOrchestrateDto {
  key_ids: string[];
  variant_id_context: string | null;
  admin_user_id: string;
  admin_email: string | null;
  client_ip: string;
  user_agent: string | null;
}

export interface DecryptKeysOrchestrateResult {
  keys: Array<{ id: string; decrypted_value: string }>;
  failures: Array<{ id: string; error: string }>;
}

// --- Export keys (CSV) ---

export interface ExportKeysDto {
  key_ids: string[];
  remove_from_inventory: boolean;
  admin_user_id: string;
  admin_email: string | null;
  client_ip: string;
  user_agent: string | null;
}

export interface ExportKeysResult {
  csv: string;
  exported: number;
  removed: boolean;
}
