import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminAnalyticsRepository } from '../../core/ports/admin-analytics-repository.port.js';
import type {
  GetDashboardMetricsDto,
  GetDashboardMetricsResult,
  GetFinancialSummaryDto,
  GetFinancialSummaryResult,
  GetTransactionsDto,
  GetTransactionsResult,
} from '../../core/use-cases/analytics/analytics.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminAnalyticsRepository');

const DEFAULT_PAGE_LIMIT = 25;

@injectable()
export class SupabaseAdminAnalyticsRepository implements IAdminAnalyticsRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  async getDashboardMetrics(dto: GetDashboardMetricsDto): Promise<GetDashboardMetricsResult> {
    logger.info('Fetching dashboard metrics', { period: dto.period });

    const metrics = await this.db.rpc<unknown>(
      'get_dashboard_metrics',
      { p_period: dto.period ?? '7d' },
    );

    return { metrics };
  }

  async getFinancialSummary(dto: GetFinancialSummaryDto): Promise<GetFinancialSummaryResult> {
    logger.info('Fetching financial summary', { period: dto.period });

    const summary = await this.db.rpc<unknown>(
      'get_comprehensive_financial_summary',
      {
        p_period: dto.period ?? '30d',
        p_start_date: dto.start_date ?? null,
        p_end_date: dto.end_date ?? null,
      },
    );

    return { summary };
  }

  async getTransactions(dto: GetTransactionsDto): Promise<GetTransactionsResult> {
    const result = await this.db.rpc<{ transactions: unknown[]; total: number }>(
      'admin_list_transactions',
      {
        p_page: dto.page ?? 1,
        p_limit: dto.limit ?? DEFAULT_PAGE_LIMIT,
        p_type: dto.type ?? null,
        p_status: dto.status ?? null,
        p_search: dto.search ?? null,
      },
    );

    return {
      transactions: result.transactions ?? [],
      total: result.total ?? 0,
    };
  }
}
