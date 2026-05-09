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

export interface MarkKeysFaultyResult {
  success: boolean;
  keys_marked: number;
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
