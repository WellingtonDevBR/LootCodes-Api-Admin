export interface GetVariantPriceTimelineDto { variant_id: string; period?: string }
export interface GetVariantPriceTimelineResult { timeline: unknown[] }

export interface GetPricingSnapshotDto { limit?: number; offset?: number }

export interface PricingChannelPrice {
  cents: number;
  currency?: string;
}

export interface PricingChannelFee {
  channel: string;
  feePercent: number;
}

export interface PricingSnapshotListing {
  productId: string;
  name: string;
  sku: string;
  costBestCents: number;
  costCurrency: string;
  stock: number;
  prices: Record<string, PricingChannelPrice>;
}

export interface GetPricingSnapshotResult {
  listings: PricingSnapshotListing[];
  fees: PricingChannelFee[];
}
