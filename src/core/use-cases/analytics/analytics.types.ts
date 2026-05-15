export interface GetDashboardMetricsDto { period?: string }
export interface GetDashboardMetricsResult { metrics: unknown }
export interface GetFinancialSummaryDto { period?: string; start_date?: string; end_date?: string }
export interface GetFinancialSummaryResult { summary: unknown }
export interface GetTransactionsDto { page?: number; limit?: number; type?: string; status?: string; from?: string; to?: string }
export interface GetTransactionsResult { transactions: unknown[]; total: number }

export interface GetChannelsSnapshotDto { from?: string; to?: string }
export interface ChannelRow { channel: string; order_count: number; revenue_cents: number; period: string }
export interface GetChannelsSnapshotResult { channels: ChannelRow[] }

/**
 * `/api/admin/analytics/channels` overview — per-provider sales-channel summary
 * with seller-config commission %, health status, and listing counts.
 */
export interface ChannelOverviewRow {
  code: string;
  displayName: string;
  kind: 'marketplace' | 'website';
  feePercent: number;
  status: 'connected' | 'degraded' | 'disconnected';
  activeListings: number;
  totalListings: number;
  lastSyncedAt: string | null;
}
export interface GetChannelsOverviewResult { channels: ChannelOverviewRow[] }

/**
 * `/api/admin/analytics/snapshot` — pre-aggregated daily / per-channel / top-product
 * report for the given window. Currency conversion is performed in the report
 * currency (`reportCurrency`).
 */
export interface GetAnalyticsSnapshotDto {
  from?: string;
  to?: string;
  tz?: string;
}
export interface AnalyticsSnapshotDayBucket {
  date: string;
  revenueCents: number;
  profitCents: number;
  orders: number;
}
export interface AnalyticsSnapshotChannelBucket {
  channel: string;
  revenueCents: number;
  profitCents: number;
  orders: number;
}
export interface AnalyticsSnapshotProductBucket {
  productName: string;
  units: number;
  revenueCents: number;
  profitCents: number;
}
export interface GetAnalyticsSnapshotResult {
  reportCurrency: string;
  daily: AnalyticsSnapshotDayBucket[];
  byChannel: AnalyticsSnapshotChannelBucket[];
  topProducts: AnalyticsSnapshotProductBucket[];
}
