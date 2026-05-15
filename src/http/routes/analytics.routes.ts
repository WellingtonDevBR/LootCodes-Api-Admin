import type { FastifyInstance } from 'fastify';
import { container } from '../../di/container.js';
import { TOKENS, UC_TOKENS } from '../../di/tokens.js';
import { adminGuard, employeeGuard } from '../middleware/auth.guard.js';
import type { GetDashboardMetricsUseCase } from '../../core/use-cases/analytics/get-dashboard-metrics.use-case.js';
import type { GetFinancialSummaryUseCase } from '../../core/use-cases/analytics/get-financial-summary.use-case.js';
import type { GetTransactionsUseCase } from '../../core/use-cases/analytics/get-transactions.use-case.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import { loadCurrencyRates, convertCents } from './_currency-helpers.js';

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

  /**
   * GET /analytics/snapshot?from=ISO&to=ISO&tz=IANA
   *
   * Returns a pre-aggregated analytics snapshot for the given date range.
   * Replaces the old pattern of fetching all raw orders via GET /orders?limit=5000
   * and aggregating in the CRM's JavaScript. This endpoint:
   *   1. Fetches orders with MINIMAL fields (no nested order_items join).
   *   2. Fetches key costs + product names in parallel (one batch each).
   *   3. Aggregates daily / channel / topProducts server-side.
   *   4. Returns ~5 KB of pre-aggregated JSON instead of hundreds of KB of raw orders.
   */
  app.get('/snapshot', { preHandler: [employeeGuard] }, async (request, reply) => {
    const query = request.query as { from?: string; to?: string; tz?: string };
    const db = container.resolve<IDatabase>(TOKENS.Database);
    const DC = 'AUD';

    const PROVIDER_TO_CHANNEL: Record<string, string> = {
      eneba: 'Eneba', g2a: 'G2A', gamivo: 'Gamivo', kinguin: 'Kinguin',
      digiseller: 'Digiseller', stripe: 'Website', web: 'Website',
    };

    function resolveOrderChannel(o: Record<string, unknown>): string {
      const mp = o.marketplace_pricing as Record<string, unknown> | null;
      const provider = (mp?.provider ?? mp?.provider_code ?? null) as string | null;
      if (provider) {
        return PROVIDER_TO_CHANNEL[provider.toLowerCase()]
          ?? (provider.charAt(0).toUpperCase() + provider.slice(1));
      }
      const pp = (o.payment_provider as string) ?? '';
      if (pp) return PROVIDER_TO_CHANNEL[pp.toLowerCase()] ?? pp;
      const oc = (o.order_channel as string) ?? '';
      if (oc === 'web' || oc === 'direct' || oc === 'manual') return 'Website';
      return oc || 'Website';
    }

    const tz = query.tz?.trim() || undefined;
    const tzKey = tz && tz !== 'UTC' ? tz : undefined;

    function getLocalDateKey(iso: string): string {
      const d = new Date(iso);
      return d.toLocaleDateString('en-CA', tzKey ? { timeZone: tzKey } : {});
    }

    function fmtDayLabel(isoDate: string): string {
      const [y, m, day] = isoDate.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, day))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    const filterOpts: { gte?: Array<[string, unknown]>; lte?: Array<[string, unknown]> } = {};
    if (query.from) filterOpts.gte = [['created_at', query.from]];
    if (query.to) filterOpts.lte = [['created_at', query.to]];

    // Step 1: minimal order fetch + currency rates in parallel (no nested joins)
    const MINIMAL_SELECT = 'id, total_amount, currency, net_amount, provider_fee, order_channel, marketplace_pricing, payment_provider, created_at, quantity';
    const [rates, orders] = await Promise.all([
      loadCurrencyRates(db),
      db.queryAll<Record<string, unknown>>('orders', {
        select: MINIMAL_SELECT,
        order: { column: 'created_at', ascending: true },
        ...filterOpts,
      }),
    ]);

    const orderIds = orders.map(o => o.id as string);

    // Generic batch-fetcher for PostgREST IN filters (chunks of 200 to stay under URL limits)
    const BATCH = 200;
    async function batchQuery<T>(
      table: string,
      select: string,
      column: string,
      ids: string[],
    ): Promise<T[]> {
      const result: T[] = [];
      for (let i = 0; i < ids.length; i += BATCH) {
        const rows = await db.query<T>(table, {
          select,
          in: [[column, ids.slice(i, i + BATCH)]],
        });
        result.push(...rows);
      }
      return result;
    }

    // Step 2: key costs + product names fetched in parallel
    const [keyRows, itemRows] = await Promise.all([
      orderIds.length > 0
        ? batchQuery<{ order_id: string; purchase_cost: string | number | null; purchase_currency: string | null }>(
            'product_keys', 'order_id, purchase_cost, purchase_currency', 'order_id', orderIds,
          )
        : Promise.resolve([]),
      orderIds.length > 0
        ? batchQuery<{ order_id: string; products: { name: string } | null }>(
            'order_items', 'order_id, products(name)', 'order_id', orderIds,
          )
        : Promise.resolve([]),
    ]);

    // Build lookup maps
    const keyCostMap = new Map<string, { cost: number; currency: string }>();
    for (const k of keyRows) {
      const cost = typeof k.purchase_cost === 'number' ? k.purchase_cost
        : typeof k.purchase_cost === 'string' ? Number(k.purchase_cost) : 0;
      const existing = keyCostMap.get(k.order_id);
      keyCostMap.set(k.order_id, {
        cost: (existing?.cost ?? 0) + cost,
        currency: k.purchase_currency ?? existing?.currency ?? 'USD',
      });
    }

    const productNameMap = new Map<string, string>();
    for (const item of itemRows) {
      if (!productNameMap.has(item.order_id) && item.products?.name) {
        productNameMap.set(item.order_id, item.products.name);
      }
    }

    // Step 3: aggregate
    interface DayBucket { revenueCents: number; profitCents: number; orders: number }
    interface ChannelBucket { revenueCents: number; profitCents: number; orders: number }
    interface ProductBucket { units: number; revenueCents: number; profitCents: number; productName: string }

    const dayMap = new Map<string, DayBucket>();
    const channelMap = new Map<string, ChannelBucket>();
    const productMap = new Map<string, ProductBucket>();

    for (const o of orders) {
      const totalAmount = (o.total_amount as number) ?? 0;
      const currency = (o.currency as string) ?? 'USD';
      const netAmount = (o.net_amount as number) ?? totalAmount;
      const isMarketplace = (o.order_channel as string) === 'marketplace';
      const qty = (o.quantity as number) ?? 1;

      const keyCost = keyCostMap.get(o.id as string);
      const keyCostCents = keyCost?.cost ?? 0;
      const keyCostCurrency = keyCost?.currency ?? 'USD';

      const grossAud = convertCents(totalAmount, currency, DC, rates);
      const netAud = convertCents(netAmount, currency, DC, rates);
      const keyCostAud = convertCents(keyCostCents, keyCostCurrency, DC, rates);
      const profitAud = isMarketplace ? netAud - keyCostAud : grossAud - keyCostAud;

      const channel = resolveOrderChannel(o);
      const ch = channelMap.get(channel) ?? { revenueCents: 0, profitCents: 0, orders: 0 };
      ch.revenueCents += grossAud;
      ch.profitCents += profitAud;
      ch.orders += 1;
      channelMap.set(channel, ch);

      const dateKey = getLocalDateKey(o.created_at as string);
      const day = dayMap.get(dateKey) ?? { revenueCents: 0, profitCents: 0, orders: 0 };
      day.revenueCents += grossAud;
      day.profitCents += profitAud;
      day.orders += 1;
      dayMap.set(dateKey, day);

      const productName = productNameMap.get(o.id as string) ?? '';
      if (productName) {
        const pk = productName.toLowerCase();
        const prod = productMap.get(pk) ?? { units: 0, revenueCents: 0, profitCents: 0, productName };
        prod.units += qty;
        prod.revenueCents += grossAud;
        prod.profitCents += profitAud;
        productMap.set(pk, prod);
      }
    }

    // Build the 7-day slot array (one entry per calendar day in the window)
    const fromDate = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const daily: Array<{ date: string; revenueCents: number; profitCents: number; orders: number }> = [];
    for (let i = 0; i < 7; i++) {
      const slotMs = fromDate.getTime() + i * 24 * 60 * 60 * 1000;
      const dateKey = new Date(slotMs).toLocaleDateString('en-CA', tzKey ? { timeZone: tzKey } : {});
      const bucket = dayMap.get(dateKey) ?? { revenueCents: 0, profitCents: 0, orders: 0 };
      daily.push({ date: fmtDayLabel(dateKey), ...bucket });
    }

    const byChannel = [...channelMap.entries()].map(([channel, b]) => ({
      channel,
      revenueCents: b.revenueCents,
      profitCents: b.profitCents,
      orders: b.orders,
    }));

    const topProducts = [...productMap.values()]
      .sort((a, b) => b.profitCents - a.profitCents)
      .slice(0, 10)
      .map(p => ({ productName: p.productName, units: p.units, revenueCents: p.revenueCents, profitCents: p.profitCents }));

    reply.header('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    return reply.send({ reportCurrency: DC, daily, byChannel, topProducts });
  });
}
