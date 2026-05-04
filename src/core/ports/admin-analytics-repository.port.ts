import type {
  GetDashboardMetricsDto,
  GetDashboardMetricsResult,
  GetFinancialSummaryDto,
  GetFinancialSummaryResult,
  GetTransactionsDto,
  GetTransactionsResult,
  GetChannelsSnapshotDto,
  GetChannelsSnapshotResult,
} from '../use-cases/analytics/analytics.types.js';

export interface IAdminAnalyticsRepository {
  getDashboardMetrics(dto: GetDashboardMetricsDto): Promise<GetDashboardMetricsResult>;
  getFinancialSummary(dto: GetFinancialSummaryDto): Promise<GetFinancialSummaryResult>;
  getTransactions(dto: GetTransactionsDto): Promise<GetTransactionsResult>;
  getChannelsSnapshot(dto: GetChannelsSnapshotDto): Promise<GetChannelsSnapshotResult>;
}
