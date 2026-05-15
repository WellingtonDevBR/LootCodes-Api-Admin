import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { ICurrencyRatesRepository } from '../../core/ports/currency-rates-repository.port.js';
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
  GetChannelsOverviewResult,
  ChannelOverviewRow,
  GetAnalyticsSnapshotDto,
  GetAnalyticsSnapshotResult,
} from '../../core/use-cases/analytics/analytics.types.js';
import { convertCents } from '../../http/routes/_currency-helpers.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminAnalyticsRepository');

const DEFAULT_PAGE_LIMIT = 25;

/**
 * Provider code → user-facing channel label. Marketplace providers map to
 * their brand name; `stripe`/`web` collapse to "Website".
 */
const PROVIDER_TO_CHANNEL: Record<string, string> = {
  eneba: 'Eneba',
  g2a: 'G2A',
  gamivo: 'Gamivo',
  kinguin: 'Kinguin',
  digiseller: 'Digiseller',
  stripe: 'Website',
  web: 'Website',
};

const SNAPSHOT_REPORT_CURRENCY = 'AUD';
const SNAPSHOT_BATCH_SIZE = 200;

function healthToStatus(h: string | null): 'connected' | 'degraded' | 'disconnected' {
  if (h === 'healthy') return 'connected';
  if (h === 'degraded') return 'degraded';
  return 'disconnected';
}

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

@injectable()
export class SupabaseAdminAnalyticsRepository implements IAdminAnalyticsRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
    @inject(TOKENS.CurrencyRatesRepository) private currencyRates: ICurrencyRatesRepository,
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

  async getChannelsOverview(): Promise<GetChannelsOverviewResult> {
    const [providers, listings] = await Promise.all([
      this.db.query<Record<string, unknown>>('provider_accounts', {
        select: 'id, provider_code, display_name, health_status, seller_config, is_enabled',
        order: { column: 'priority', ascending: true },
      }),
      this.db.query<Record<string, unknown>>('seller_listings', {
        select: 'provider_account_id, status, last_synced_at',
      }),
    ]);

    const channels: ChannelOverviewRow[] = providers
      .filter((p) => p.is_enabled)
      .map((p) => {
        const pid = p.id as string;
        const providerListings = listings.filter((l) => l.provider_account_id === pid);
        const activeListings = providerListings.filter((l) => l.status === 'active').length;
        const lastSynced = providerListings
          .map((l) => l.last_synced_at as string | null)
          .filter(Boolean)
          .sort()
          .reverse()[0] ?? null;
        const cfg = p.seller_config as Record<string, unknown> | null;
        const commission = (cfg?.commission_rate_percent as number | undefined) ?? 0;
        return {
          code: p.provider_code as string,
          displayName: (p.display_name as string) ?? (p.provider_code as string),
          kind: 'marketplace',
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
      kind: 'website',
      feePercent: 0,
      status: 'connected',
      activeListings: 0,
      totalListings: 0,
      lastSyncedAt: null,
    });

    return { channels };
  }

  async getAnalyticsSnapshot(dto: GetAnalyticsSnapshotDto): Promise<GetAnalyticsSnapshotResult> {
    const tz = dto.tz?.trim() || undefined;
    const tzKey = tz && tz !== 'UTC' ? tz : undefined;

    const getLocalDateKey = (iso: string): string => {
      const d = new Date(iso);
      return d.toLocaleDateString('en-CA', tzKey ? { timeZone: tzKey } : {});
    };

    const fmtDayLabel = (isoDate: string): string => {
      const [y, m, day] = isoDate.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, day))
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };

    const filterOpts: { gte?: Array<[string, unknown]>; lte?: Array<[string, unknown]> } = {};
    if (dto.from) filterOpts.gte = [['created_at', dto.from]];
    if (dto.to) filterOpts.lte = [['created_at', dto.to]];

    const MINIMAL_SELECT =
      'id, total_amount, currency, net_amount, provider_fee, order_channel, marketplace_pricing, payment_provider, created_at, quantity';
    const [rates, orders] = await Promise.all([
      this.currencyRates.getActiveRates(),
      this.db.queryAll<Record<string, unknown>>('orders', {
        select: MINIMAL_SELECT,
        order: { column: 'created_at', ascending: true },
        ...filterOpts,
      }),
    ]);

    const orderIds = orders.map((o) => o.id as string);

    const batchQuery = async <T>(
      table: string,
      select: string,
      column: string,
      ids: string[],
    ): Promise<T[]> => {
      const result: T[] = [];
      for (let i = 0; i < ids.length; i += SNAPSHOT_BATCH_SIZE) {
        const rows = await this.db.query<T>(table, {
          select,
          in: [[column, ids.slice(i, i + SNAPSHOT_BATCH_SIZE)]],
        });
        result.push(...rows);
      }
      return result;
    };

    const [keyRows, itemRows] = await Promise.all([
      orderIds.length > 0
        ? batchQuery<{ order_id: string; purchase_cost: string | number | null; purchase_currency: string | null }>(
            'product_keys',
            'order_id, purchase_cost, purchase_currency',
            'order_id',
            orderIds,
          )
        : Promise.resolve([]),
      orderIds.length > 0
        ? batchQuery<{ order_id: string; products: { name: string } | null }>(
            'order_items',
            'order_id, products(name)',
            'order_id',
            orderIds,
          )
        : Promise.resolve([]),
    ]);

    const keyCostMap = new Map<string, { cost: number; currency: string }>();
    for (const k of keyRows) {
      const cost = typeof k.purchase_cost === 'number'
        ? k.purchase_cost
        : typeof k.purchase_cost === 'string'
        ? Number(k.purchase_cost)
        : 0;
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

      const grossAud = convertCents(totalAmount, currency, SNAPSHOT_REPORT_CURRENCY, rates);
      const netAud = convertCents(netAmount, currency, SNAPSHOT_REPORT_CURRENCY, rates);
      const keyCostAud = convertCents(keyCostCents, keyCostCurrency, SNAPSHOT_REPORT_CURRENCY, rates);
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

    const fromDate = dto.from ? new Date(dto.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const daily = [] as GetAnalyticsSnapshotResult['daily'];
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
      .map((p) => ({
        productName: p.productName,
        units: p.units,
        revenueCents: p.revenueCents,
        profitCents: p.profitCents,
      }));

    return {
      reportCurrency: SNAPSHOT_REPORT_CURRENCY,
      daily,
      byChannel,
      topProducts,
    };
  }
}
