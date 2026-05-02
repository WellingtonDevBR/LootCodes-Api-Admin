export interface GetDashboardMetricsDto { period?: string }
export interface GetDashboardMetricsResult { metrics: unknown }
export interface GetFinancialSummaryDto { period?: string; start_date?: string; end_date?: string }
export interface GetFinancialSummaryResult { summary: unknown }
export interface GetTransactionsDto { page?: number; limit?: number; type?: string; status?: string; search?: string }
export interface GetTransactionsResult { transactions: unknown[]; total: number }
