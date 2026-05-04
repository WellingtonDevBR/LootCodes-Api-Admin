export interface GetVariantPriceTimelineDto { variant_id: string; period?: string }
export interface GetVariantPriceTimelineResult { timeline: unknown[] }

export interface GetPricingSnapshotDto { limit?: number; offset?: number }

export interface PricingSnapshotRow {
  variant_id: string;
  provider_code: string | null;
  provider_name: string | null;
  price_cents: number;
  currency: string;
  min_price_cents: number | null;
  commission_rate: number | null;
  status: string;
}

export interface GetPricingSnapshotResult { listings: PricingSnapshotRow[] }
