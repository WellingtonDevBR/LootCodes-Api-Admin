export interface ListOpportunitiesDto {
  readonly status?: string;
  readonly min_margin_pct?: number;
  readonly buy_provider?: string;
  readonly sell_provider?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface OpportunityRow {
  readonly opportunity_id: string;
  readonly variant_id: string;
  readonly product_id: string;
  readonly product_name: string;
  readonly product_image_url: string | null;
  readonly variant_label: string;
  readonly buy_provider_code: string;
  readonly buy_price_cents: number;
  readonly buy_qty: number | null;
  readonly sell_provider_code: string;
  readonly sell_market_floor_cents: number;
  readonly sell_commission_pct: number;
  readonly sell_fixed_fee_cents: number;
  readonly net_margin_cents: number;
  readonly net_margin_pct: number;
  readonly detected_at: string;
  readonly updated_at: string;
  readonly status: string;
}

export interface ListOpportunitiesResult {
  readonly opportunities: readonly OpportunityRow[];
  readonly total_count: number;
}
