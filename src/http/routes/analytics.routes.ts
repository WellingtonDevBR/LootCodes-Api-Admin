import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetDashboardMetricsUseCase } from '../../core/use-cases/analytics/get-dashboard-metrics.use-case.js';
import type { GetFinancialSummaryUseCase } from '../../core/use-cases/analytics/get-financial-summary.use-case.js';
import type { GetTransactionsUseCase } from '../../core/use-cases/analytics/get-transactions.use-case.js';
import type { GetChannelsOverviewUseCase } from '../../core/use-cases/analytics/get-channels-overview.use-case.js';
import type { GetAnalyticsSnapshotUseCase } from '../../core/use-cases/analytics/get-analytics-snapshot.use-case.js';

export async function adminAnalyticsRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { period?: string };
    const uc = container.resolve<GetDashboardMetricsUseCase>(UC_TOKENS.GetDashboardMetrics);
    const result = await uc.execute({ period: query.period });
    return reply.send(result);
  });

  app.get('/financial', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { period?: string; start_date?: string; end_date?: string };
    const uc = container.resolve<GetFinancialSummaryUseCase>(UC_TOKENS.GetFinancialSummary);
    const result = await uc.execute({
      period: query.period,
      start_date: query.start_date,
      end_date: query.end_date,
    });
    return reply.send(result);
  });

  app.get('/transactions', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      from?: string;
      to?: string;
    };
    const limit = query.limit ? Number(query.limit) : 25;
    const offset = query.offset ? Number(query.offset) : 0;
    const uc = container.resolve<GetTransactionsUseCase>(UC_TOKENS.GetTransactions);
    const result = await uc.execute({
      page: Math.floor(offset / limit) + 1,
      limit,
      from: query.from,
      to: query.to,
    });
    return reply.send(result);
  });

  app.get('/channels', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const uc = container.resolve<GetChannelsOverviewUseCase>(UC_TOKENS.GetChannelsOverview);
    const result = await uc.execute();
    return reply.send(result);
  });

  app.post('/process-preorder', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });

  /**
   * GET /analytics/snapshot?from=ISO&to=ISO&tz=IANA
   *
   * Returns a pre-aggregated analytics snapshot for the given window — daily
   * revenue/profit/orders, per-channel totals, and top products by profit.
   * All conversion is done inside the use case (currency rates port) so the
   * route handler stays trivial.
   */
  app.get('/snapshot', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; tz?: string };
    const uc = container.resolve<GetAnalyticsSnapshotUseCase>(UC_TOKENS.GetAnalyticsSnapshot);
    const result = await uc.execute({ from: query.from, to: query.to, tz: query.tz });
    reply.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return reply.send(result);
  });
}
