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
  GetChannelsSnapshotDto,
  GetChannelsSnapshotResult,
  ChannelRow,
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
    const limit = dto.limit ?? DEFAULT_PAGE_LIMIT;
    const page = dto.page ?? 1;
    const offset = (page - 1) * limit;

    const queryOpts: import('../../core/ports/database.port.js').QueryOptions = {
      select: 'id, type, status, amount, currency, description, created_at, order_id',
      order: { column: 'created_at', ascending: false },
      range: [offset, offset + limit - 1],
    };

    const eqFilters: Array<[string, unknown]> = [];
    if (dto.type) eqFilters.push(['type', dto.type]);
    if (dto.status) eqFilters.push(['status', dto.status]);
    if (eqFilters.length > 0) queryOpts.eq = eqFilters;

    if (dto.from) queryOpts.gte = [['created_at', dto.from]];
    if (dto.to) queryOpts.lte = [['created_at', dto.to]];

    const result = await this.db.queryPaginated<Record<string, unknown>>('transactions', queryOpts);

    return {
      transactions: result.data,
      total: result.total,
    };
  }

  async getChannelsSnapshot(dto: GetChannelsSnapshotDto): Promise<GetChannelsSnapshotResult> {
    logger.info('Fetching channels snapshot', { from: dto.from, to: dto.to });

    const orders = await this.db.query<Record<string, unknown>>('orders', {
      select: 'id, total_amount, created_at, order_channel',
      order: { column: 'created_at', ascending: false },
      limit: 5000,
    });

    const channelMap = new Map<string, { order_count: number; revenue_cents: number }>();
    for (const o of orders) {
      const channel = (o.order_channel as string) ?? 'direct';
      const created = o.created_at as string;
      if (dto.from && created < dto.from) continue;
      if (dto.to && created > dto.to) continue;
      const entry = channelMap.get(channel) ?? { order_count: 0, revenue_cents: 0 };
      entry.order_count += 1;
      entry.revenue_cents += (o.total_amount as number) ?? 0;
      channelMap.set(channel, entry);
    }

    const channels: ChannelRow[] = [...channelMap.entries()].map(([channel, stats]) => ({
      channel,
      order_count: stats.order_count,
      revenue_cents: stats.revenue_cents,
      period: `${dto.from ?? 'all'}_${dto.to ?? 'now'}`,
    }));

    return { channels };
  }
}
