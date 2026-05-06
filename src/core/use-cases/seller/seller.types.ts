export type SellerListingType = 'key_upload' | 'declared_stock';
export type SellerPriceStrategy =
  | 'fixed'
  | 'match_lowest'
  | 'undercut_percent'
  | 'undercut_fixed'
  | 'margin_target'
  | 'smart_compete';

export interface SellerProviderConfig {
  commission_rate_percent: number;
  fixed_fee_cents: number;
  min_price_floor_cents: number;
  min_profit_margin_pct: number;
  auto_list_new_stock: boolean;
  default_listing_type: SellerListingType;
  price_strategy: SellerPriceStrategy;
  price_strategy_value: number;
  default_currency: string;
  auto_sync_stock_default: boolean;
  auto_sync_price_default: boolean;
  auto_price_free_only: boolean;
  smart_pricing_enabled: boolean;
  min_change_delta_cents: number;
  dampening_snapshots: number;
  max_position_target: number;
  position_gap_threshold_pct: number;
  oscillation_threshold: number;
  oscillation_window_hours: number;
  price_change_free_quota: number;
  price_change_fee_cents: number;
  price_change_window_hours: number;
  price_change_max_paid_per_window: number;
  seller_declared_stock_enabled: boolean;
  callback_url: string;
  callback_auth_token: string;
  callback_ids: unknown[];
}

export const SELLER_CONFIG_DEFAULTS: SellerProviderConfig = {
  commission_rate_percent: 0,
  fixed_fee_cents: 0,
  min_price_floor_cents: 0,
  min_profit_margin_pct: 0,
  auto_list_new_stock: false,
  default_listing_type: 'key_upload',
  price_strategy: 'fixed',
  price_strategy_value: 0,
  default_currency: 'EUR',
  auto_sync_stock_default: false,
  auto_sync_price_default: false,
  auto_price_free_only: false,
  smart_pricing_enabled: false,
  min_change_delta_cents: 5,
  dampening_snapshots: 2,
  max_position_target: 2,
  position_gap_threshold_pct: 15,
  oscillation_threshold: 4,
  oscillation_window_hours: 0,
  price_change_free_quota: -1,
  price_change_fee_cents: 0,
  price_change_window_hours: 24,
  price_change_max_paid_per_window: 0,
  seller_declared_stock_enabled: false,
  callback_url: '',
  callback_auth_token: '',
  callback_ids: [],
};

const VALID_LISTING_TYPES: SellerListingType[] = ['key_upload', 'declared_stock'];
const VALID_PRICE_STRATEGIES: SellerPriceStrategy[] = [
  'fixed',
  'match_lowest',
  'undercut_percent',
  'undercut_fixed',
  'margin_target',
  'smart_compete',
];

export function parseSellerConfig(raw: Record<string, unknown>): SellerProviderConfig {
  const D = SELLER_CONFIG_DEFAULTS;
  const lt = raw.default_listing_type as string;
  const ps = raw.price_strategy as string;

  const num = (key: string, min: number, max: number, def: number): number => {
    const v = raw[key];
    return typeof v === 'number' && v >= min && v <= max ? v : def;
  };
  const bool = (key: string, def: boolean): boolean => {
    const v = raw[key];
    return typeof v === 'boolean' ? v : def;
  };
  const str = (key: string, def: string): string => {
    const v = raw[key];
    return typeof v === 'string' ? v : def;
  };

  let freeQuota = D.price_change_free_quota;
  let feeCents = D.price_change_fee_cents;
  let windowHours = D.price_change_window_hours;
  let maxPaid = D.price_change_max_paid_per_window;

  if (typeof raw.price_change_free_quota === 'number') {
    freeQuota = Math.max(-1, raw.price_change_free_quota as number);
    feeCents = num('price_change_fee_cents', 0, 100_000, D.price_change_fee_cents);
    windowHours = num('price_change_window_hours', 1, 720, D.price_change_window_hours);
    maxPaid = num('price_change_max_paid_per_window', 0, 1000, D.price_change_max_paid_per_window);
  } else if (typeof raw.price_change_limit_per_day === 'number') {
    const legacy = raw.price_change_limit_per_day as number;
    freeQuota = legacy <= 0 ? -1 : Math.round(legacy);
    feeCents = 0;
    windowHours = num('price_change_limit_window_hours', 1, 720, D.price_change_window_hours);
    maxPaid = 0;
  }

  return {
    commission_rate_percent: num('commission_rate_percent', 0, 100, D.commission_rate_percent),
    fixed_fee_cents: num('fixed_fee_cents', 0, 100_000, D.fixed_fee_cents),
    min_price_floor_cents: num('min_price_floor_cents', 0, 1_000_000, D.min_price_floor_cents),
    min_profit_margin_pct: num('min_profit_margin_pct', 0, 100, D.min_profit_margin_pct),
    auto_list_new_stock: bool('auto_list_new_stock', D.auto_list_new_stock),
    default_listing_type: VALID_LISTING_TYPES.includes(lt as SellerListingType)
      ? (lt as SellerListingType) : D.default_listing_type,
    price_strategy: VALID_PRICE_STRATEGIES.includes(ps as SellerPriceStrategy)
      ? (ps as SellerPriceStrategy) : D.price_strategy,
    price_strategy_value: num('price_strategy_value', 0, 100, D.price_strategy_value),
    default_currency: typeof raw.default_currency === 'string' && (raw.default_currency as string).length === 3
      ? (raw.default_currency as string).toUpperCase() : D.default_currency,
    auto_sync_stock_default: bool('auto_sync_stock_default', D.auto_sync_stock_default),
    auto_sync_price_default: bool('auto_sync_price_default', D.auto_sync_price_default),
    auto_price_free_only: bool('auto_price_free_only', D.auto_price_free_only),
    smart_pricing_enabled: bool('smart_pricing_enabled', D.smart_pricing_enabled),
    min_change_delta_cents: num('min_change_delta_cents', 0, 100_000, D.min_change_delta_cents),
    dampening_snapshots: num('dampening_snapshots', 1, 10, D.dampening_snapshots),
    max_position_target: num('max_position_target', 1, 5, D.max_position_target),
    position_gap_threshold_pct: num('position_gap_threshold_pct', 1, 100, D.position_gap_threshold_pct),
    oscillation_threshold: num('oscillation_threshold', 2, 20, D.oscillation_threshold),
    oscillation_window_hours: num('oscillation_window_hours', 0, 720, D.oscillation_window_hours),
    price_change_free_quota: freeQuota,
    price_change_fee_cents: feeCents,
    price_change_window_hours: windowHours,
    price_change_max_paid_per_window: maxPaid,
    seller_declared_stock_enabled: raw.seller_declared_stock_enabled === true,
    callback_url: str('callback_url', D.callback_url),
    callback_auth_token: str('callback_auth_token', D.callback_auth_token),
    callback_ids: Array.isArray(raw.callback_ids) ? (raw.callback_ids as unknown[]) : D.callback_ids,
  };
}

export interface ProcurementConfig {
  auto_buy_enabled?: boolean;
  max_cost_per_item_cents?: number;
  daily_spend_limit_cents?: number;
  tracked_seller_ids?: number[];
  [key: string]: unknown;
}

export interface ProviderAccountDetail {
  id: string;
  provider_code: string;
  display_name: string;
  is_enabled: boolean;
  priority: number;
  health_status: string;
  prioritize_quote_sync: boolean;
  supports_catalog: boolean;
  supports_quote: boolean;
  supports_purchase: boolean;
  supports_callback: boolean;
  supports_seller: boolean;
  seller_config: SellerProviderConfig;
  procurement_config: ProcurementConfig;
  api_profile_keys: string[];
  created_at: string;
  updated_at: string;
}

export interface GetProviderAccountDetailResult {
  account: ProviderAccountDetail;
}

export interface WebhookStatusItem {
  id: string;
  type: string;
  url: string;
  active: boolean;
}

export interface GetWebhookStatusResult {
  provider_account_id: string;
  webhooks: WebhookStatusItem[];
  declared_stock_enabled: boolean;
}

export interface RegisterWebhooksResult {
  registered: number;
  webhook_ids: string[];
}

export interface ProviderAccountItem {
  id: string;
  provider_code: string;
  display_name: string;
  is_enabled: boolean;
  priority: number;
  api_profile: Record<string, unknown>;
  supports_catalog: boolean;
  supports_quote: boolean;
  supports_purchase: boolean;
  supports_callback: boolean;
  supports_seller: boolean;
  seller_config: Record<string, unknown>;
  procurement_config: Record<string, unknown>;
  health_status: string;
  prioritize_quote_sync: boolean;
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
  listing_type: SellerListingType;
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
  /** Per-listing JSON overrides (CRM); drives cron via merge into provider seller_config. */
  pricing_overrides?: Record<string, unknown> | null;
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

export interface CreateProviderAccountDto {
  provider_code: string;
  display_name: string;
  is_enabled?: boolean;
  priority?: number;
  api_profile?: Record<string, unknown>;
  supports_catalog?: boolean;
  supports_quote?: boolean;
  supports_purchase?: boolean;
  supports_callback?: boolean;
  supports_seller?: boolean;
  seller_config?: Record<string, unknown>;
  procurement_config?: Record<string, unknown>;
  prioritize_quote_sync?: boolean;
}

export interface UpdateProviderAccountDto {
  id: string;
  display_name?: string;
  priority?: number;
  is_enabled?: boolean;
  api_profile?: Record<string, unknown>;
  supports_catalog?: boolean;
  supports_quote?: boolean;
  supports_purchase?: boolean;
  supports_callback?: boolean;
  supports_seller?: boolean;
  seller_config?: Record<string, unknown>;
  procurement_config?: Record<string, unknown>;
  health_status?: string;
  prioritize_quote_sync?: boolean;
}

export interface CreateProviderAccountResult {
  account: ProviderAccountItem;
}

export interface UpdateProviderAccountResult {
  account: ProviderAccountItem;
}

export interface CreateVariantOfferDto {
  variant_id: string;
  provider_account_id: string;
  external_sku?: string;
  external_offer_id?: string;
  external_platform_code?: string;
  external_region_code?: string;
  currency?: string;
  is_active?: boolean;
}

export interface UpdateVariantOfferDto {
  id: string;
  external_sku?: string;
  external_offer_id?: string;
  external_platform_code?: string;
  external_region_code?: string;
  currency?: string;
  is_active?: boolean;
}

export interface CreateVariantOfferResult {
  offer: VariantOfferItem;
}

export interface UpdateVariantOfferResult {
  offer: VariantOfferItem;
}
