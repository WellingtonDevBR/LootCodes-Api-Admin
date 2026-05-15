import type {
  GetDashboardMetricsDto,
  GetDashboardMetricsResult,
  GetFinancialSummaryDto,
  GetFinancialSummaryResult,
  GetTransactionsDto,
  GetTransactionsResult,
  GetChannelsSnapshotDto,
  GetChannelsSnapshotResult,
  GetChannelsOverviewResult,
  GetAnalyticsSnapshotDto,
  GetAnalyticsSnapshotResult,
} from '../use-cases/analytics/analytics.types.js';

export interface IAdminAnalyticsRepository {
  getDashboardMetrics(dto: GetDashboardMetricsDto): Promise<GetDashboardMetricsResult>;
  getFinancialSummary(dto: GetFinancialSummaryDto): Promise<GetFinancialSummaryResult>;
  getTransactions(dto: GetTransactionsDto): Promise<GetTransactionsResult>;
  getChannelsSnapshot(dto: GetChannelsSnapshotDto): Promise<GetChannelsSnapshotResult>;
  getChannelsOverview(): Promise<GetChannelsOverviewResult>;
  /**
   * Returns the pre-aggregated analytics snapshot for the given window. The
   * implementation owns currency conversion (it injects the rates repository)
   * so route handlers don't need to thread `IDatabase` around.
   */
  getAnalyticsSnapshot(dto: GetAnalyticsSnapshotDto): Promise<GetAnalyticsSnapshotResult>;
}
