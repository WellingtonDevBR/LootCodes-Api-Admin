import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetDashboardMetricsUseCase } from '../../core/use-cases/analytics/get-dashboard-metrics.use-case.js';
import type { GetFinancialSummaryUseCase } from '../../core/use-cases/analytics/get-financial-summary.use-case.js';
import type { GetTransactionsUseCase } from '../../core/use-cases/analytics/get-transactions.use-case.js';

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
      search: query.from && query.to ? `${query.from}..${query.to}` : undefined,
    });
    return reply.send(result);
  });

  app.get('/channels', { preHandler: [employeeGuard] }, async (_request, reply) => {
    const { TOKENS } = await import('../../di/tokens.js');
    const db = container.resolve<import('../../core/ports/database.port.js').IDatabase>(TOKENS.Database);

    const providers = await db.query<Record<string, unknown>>('provider_accounts', {
      select: 'id, provider_code, display_name, health_status, seller_config, is_enabled',
      order: { column: 'priority', ascending: true },
    });

    const listings = await db.query<Record<string, unknown>>('seller_listings', {
      select: 'provider_account_id, status, last_synced_at',
    });

    const healthToStatus = (h: string | null): 'connected' | 'degraded' | 'disconnected' => {
      if (h === 'healthy') return 'connected';
      if (h === 'degraded') return 'degraded';
      return 'disconnected';
    };

    interface ChannelOverview {
      code: string;
      displayName: string;
      kind: 'marketplace' | 'website';
      feePercent: number;
      status: 'connected' | 'degraded' | 'disconnected';
      activeListings: number;
      totalListings: number;
      lastSyncedAt: string | null;
    }

    const channels: ChannelOverview[] = providers
      .filter(p => p.is_enabled)
      .map(p => {
        const pid = p.id as string;
        const providerListings = listings.filter(l => l.provider_account_id === pid);
        const activeListings = providerListings.filter(l => l.status === 'active').length;
        const lastSynced = providerListings
          .map(l => l.last_synced_at as string | null)
          .filter(Boolean)
          .sort()
          .reverse()[0] ?? null;
        const cfg = p.seller_config as Record<string, unknown> | null;
        const commission = cfg?.commission_rate_percent as number ?? 0;

        return {
          code: p.provider_code as string,
          displayName: (p.display_name as string) ?? (p.provider_code as string),
          kind: 'marketplace' as const,
          feePercent: commission / 100,
          status: healthToStatus(p.health_status as string | null),
          activeListings,
          totalListings: providerListings.length,
          lastSyncedAt: lastSynced,
        };
      });

    channels.push({
      code: 'website',
      displayName: 'Website',
      kind: 'website' as const,
      feePercent: 0,
      status: 'connected' as const,
      activeListings: 0,
      totalListings: 0,
      lastSyncedAt: null,
    });

    return reply.send({ channels });
  });

  app.post('/process-preorder', { preHandler: [adminGuard] }, async (_request, reply) => {
    return reply.send({ message: 'Not implemented yet' });
  });
}
