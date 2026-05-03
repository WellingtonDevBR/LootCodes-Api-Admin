export interface ProviderAccountItem {
  id: string;
  provider_code: string;
  display_name: string;
  is_enabled: boolean;
  priority: number;
  supports_catalog: boolean;
  supports_quote: boolean;
  supports_purchase: boolean;
  supports_callback: boolean;
  supports_seller: boolean;
  seller_config: Record<string, unknown>;
  procurement_config: Record<string, unknown>;
  health_status: string;
  created_at: string;
  updated_at: string;
}

export interface ListProviderAccountsResult {
  accounts: ProviderAccountItem[];
}

export interface ListSellerListingsDto {
  variant_id: string;
}

export interface SellerListingItem {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_listing_id: string | null;
  external_product_id: string;
  listing_type: 'key_upload' | 'declared_stock';
  status: string;
  currency: string;
  price_cents: number;
  min_price_cents: number;
  declared_stock: number;
  auto_sync_stock: boolean;
  auto_sync_price: boolean;
  last_synced_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  provider_code: string | null;
  provider_name: string | null;
}

export interface ListSellerListingsResult {
  listings: SellerListingItem[];
}

export interface GetVariantOffersDto {
  variant_id: string;
}

export interface VariantOfferItem {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_sku: string | null;
  external_offer_id: string | null;
  currency: string;
  last_price_cents: number | null;
  available_quantity: number | null;
  is_active: boolean;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
  provider_code: string | null;
  provider_name: string | null;
}

export interface GetVariantOffersResult {
  offers: VariantOfferItem[];
}
