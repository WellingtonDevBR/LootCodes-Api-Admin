import type { SellerListingType } from './seller.types.js';

// --- Calculate Payout ---

export interface CalculatePayoutDto {
  listing_id: string;
  price_cents: number;
}

export interface PayoutBreakdown {
  gross_price_cents: number;
  marketplace_fee_cents: number;
  marketplace_fee_percent: number;
  net_payout_cents: number;
  effective_floor_cents: number;
  cost_basis_cents: number | null;
  profit_cents: number | null;
  profit_percent: number | null;
}

export interface CalculatePayoutResult {
  listing_id: string;
  payout: PayoutBreakdown;
}

// --- Get Competitors ---

export interface GetCompetitorsDto {
  listing_id: string;
}

export interface CompetitorItem {
  merchant_name: string;
  price_cents: number;
  currency: string;
  in_stock: boolean;
  is_own_offer: boolean;
}

export interface GetCompetitorsResult {
  listing_id: string;
  competitors: CompetitorItem[];
  own_position: number | null;
  own_price_cents: number | null;
}

// --- Suggest Price ---

export interface SuggestPriceDto {
  listing_id: string;
  effective_cost_cents: number;
  listing_type: SellerListingType;
}

export interface PriceSuggestion {
  suggested_price_cents: number;
  strategy: string;
  strategy_value: number | null;
  estimated_payout_cents: number | null;
  reasoning: string;
}

export interface SuggestPriceResult {
  listing_id: string;
  suggestion: PriceSuggestion | null;
}

// --- Dry Run Pricing ---

export interface DryRunPricingDto {
  listing_id: string;
}

export interface DryRunResult {
  current_price_cents: number;
  target_price_cents: number;
  would_change: boolean;
  effective_floor_cents: number;
  cost_basis_cents: number | null;
  competitor_count: number;
  lowest_competitor_cents: number | null;
  our_position: number | null;
  is_dampened: boolean;
  oscillation_detected: boolean;
  worth_it: boolean;
  skip_reason: string | null;
  floor_data: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  profitability: Record<string, unknown> | null;
}

export interface DryRunPricingResult {
  listing_id: string;
  dry_run: DryRunResult;
}

// --- Decision History ---

export interface GetDecisionHistoryDto {
  listing_id: string;
  limit?: number;
  offset?: number;
}

export interface PricingDecisionItem {
  id: string;
  listing_id: string;
  action: string;
  reason_code: string;
  price_before_cents: number;
  target_price_cents: number;
  lowest_competitor_cents: number | null;
  our_position_before: number | null;
  estimated_fee_cents: number | null;
  config_snapshot: Record<string, unknown> | null;
  decision_context: Record<string, unknown> | null;
  created_at: string;
}

export interface GetDecisionHistoryResult {
  listing_id: string;
  decisions: PricingDecisionItem[];
  total: number;
}

// --- Latest Decision ---

export interface GetLatestDecisionDto {
  listing_id: string;
}

export interface GetLatestDecisionResult {
  listing_id: string;
  decision: PricingDecisionItem | null;
}

// --- Provider Defaults ---

export interface GetProviderDefaultsDto {
  provider_account_id: string;
}

export interface ProviderSellerDefaults {
  commission_rate_percent: number | null;
  min_price_floor_cents: number | null;
  price_strategy: string | null;
  price_strategy_value: number | null;
  default_listing_type: string | null;
  default_currency: string | null;
  auto_list_new_stock: boolean;
}

export interface GetProviderDefaultsResult {
  provider_account_id: string;
  defaults: ProviderSellerDefaults;
}
