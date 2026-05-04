export interface GetDashboardMetricsDto { period?: string }
export interface GetDashboardMetricsResult { metrics: unknown }
export interface GetFinancialSummaryDto { period?: string; start_date?: string; end_date?: string }
export interface GetFinancialSummaryResult { summary: unknown }
export interface GetTransactionsDto { page?: number; limit?: number; type?: string; status?: string; search?: string }
export interface GetTransactionsResult { transactions: unknown[]; total: number }

export interface GetChannelsSnapshotDto { from?: string; to?: string }
export interface ChannelRow { channel: string; order_count: number; revenue_cents: number; period: string }
export interface GetChannelsSnapshotResult { channels: ChannelRow[] }
