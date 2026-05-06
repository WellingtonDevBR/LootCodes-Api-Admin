import type { SellerListingType, SellerPriceStrategy } from './seller.types.js';

// --- Create Listing ---

export interface CreateSellerListingDto {
  variant_id: string;
  provider_account_id: string;
  price_cents: number;
  currency: string;
  listing_type: SellerListingType;
  external_product_id?: string;
  auto_sync_stock?: boolean;
  auto_sync_price?: boolean;
  admin_id: string;
}

export interface CreateSellerListingResult {
  listing_id: string;
  external_listing_id: string | null;
  status: string;
}

// --- Update Listing Price ---

export interface UpdateSellerListingPriceDto {
  listing_id: string;
  price_cents: number;
  admin_id: string;
}

export interface UpdateSellerListingPriceResult {
  listing_id: string;
  price_cents: number;
  updated_at: string;
}

// --- Toggle Sync Flags ---

export interface ToggleSellerListingSyncDto {
  listing_id: string;
  sync_stock?: boolean;
  sync_price?: boolean;
  admin_id: string;
}

export interface ToggleSellerListingSyncResult {
  listing_id: string;
  auto_sync_stock: boolean;
  auto_sync_price: boolean;
}

// --- Update Min Price ---

export interface UpdateSellerListingMinPriceDto {
  listing_id: string;
  mode: 'auto' | 'manual';
  override_cents?: number;
  admin_id: string;
}

export interface UpdateSellerListingMinPriceResult {
  listing_id: string;
  min_price_cents: number;
  min_price_mode: string;
}

// --- Update Pricing Overrides ---

export interface SellerListingPricingOverrides {
  commission_override_percent?: number | null;
  min_profit_percent?: number | null;
  cost_basis_override_cents?: number | null;
  cost_basis_override_currency?: string | null;
  price_strategy?: SellerPriceStrategy | null;
  price_strategy_value?: number | null;
  /** When true, auto-pricer ignores profitability/cost-breakeven floors except provider min floor + manual listing min. */
  bypass_profitability_guard?: boolean | null;
}

export interface UpdateSellerListingOverridesDto {
  listing_id: string;
  overrides: SellerListingPricingOverrides;
  admin_id: string;
}

export interface UpdateSellerListingOverridesResult {
  listing_id: string;
  pricing_overrides: SellerListingPricingOverrides;
}

// --- Set Visibility (G2A) ---

export interface SetSellerListingVisibilityDto {
  listing_id: string;
  visibility: 'all' | 'retail' | 'business';
  admin_id: string;
}

export interface SetSellerListingVisibilityResult {
  listing_id: string;
  visibility: string;
}

// --- Deactivate ---

export interface DeactivateSellerListingDto {
  listing_id: string;
  admin_id: string;
}

export interface DeactivateSellerListingResult {
  listing_id: string;
  status: string;
}

// --- Delete ---

export interface DeleteSellerListingDto {
  listing_id: string;
  deactivate_first?: boolean;
  admin_id: string;
}

// --- Recover Health ---

export interface RecoverSellerListingHealthDto {
  listing_id: string;
  reset_metrics?: boolean;
  clear_pause_message?: boolean;
  resume_active?: boolean;
  admin_id: string;
}

export interface RecoverSellerListingHealthResult {
  listing_id: string;
  status: string;
  health_status: string;
}

// --- Sync Stock (marketplace interaction) ---

export interface SyncSellerStockDto {
  listing_id: string;
  admin_id: string;
}

export interface SyncSellerStockResult {
  listing_id: string;
  declared_stock: number;
  synced_at: string;
}

// --- Fetch Remote Stock (marketplace interaction) ---

export interface FetchRemoteStockDto {
  listing_id: string;
  admin_id: string;
}

export interface RemoteStockItem {
  external_id: string;
  name: string;
  price_cents: number;
  currency: string;
  stock: number;
  is_own: boolean;
}

export interface FetchRemoteStockResult {
  listing_id: string;
  items: RemoteStockItem[];
}

// --- Batch Price Update ---

export interface BatchUpdatePricesDto {
  provider_account_id: string;
  updates: Array<{ external_listing_id: string; price_cents: number }>;
  admin_id: string;
}

export interface BatchUpdatePricesResult {
  updated: number;
  failed: number;
  errors?: Array<{ externalListingId: string; error: string }>;
}

// --- Batch Stock Update ---

export interface BatchUpdateStockDto {
  provider_account_id: string;
  updates: Array<{ external_listing_id: string; quantity: number }>;
  admin_id: string;
}

export interface BatchUpdateStockResult {
  updated: number;
  failed: number;
}

// --- Global Stock Status ---

export interface UpdateGlobalStockStatusDto {
  provider_account_id: string;
  enabled: boolean;
  admin_id: string;
}

export interface UpdateGlobalStockStatusResult {
  success: boolean;
}

// --- Enable Declared Stock ---

export interface EnableDeclaredStockDto {
  provider_account_id: string;
  admin_id: string;
}

export interface EnableDeclaredStockResult {
  success: boolean;
  failureReason: string | null;
}

// --- Enable Key Replacements ---

export interface EnableKeyReplacementsDto {
  provider_account_id: string;
  admin_id: string;
}

export interface EnableKeyReplacementsResult {
  success: boolean;
}

// --- Remove Callback ---

export interface RemoveCallbackDto {
  provider_account_id: string;
  callback_id: string;
  admin_id: string;
}

export interface RemoveCallbackResult {
  removed: boolean;
}

// --- Expire Reservations ---

export interface ExpireReservationsDto {
  admin_id: string;
  max_age_minutes?: number;
}

export interface ExpireReservationsResult {
  expired: number;
}
