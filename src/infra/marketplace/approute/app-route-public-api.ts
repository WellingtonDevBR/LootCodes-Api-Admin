import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import { assertAppRouteSuccess, parseAppRouteEnvelope } from './envelope.js';
import type {
  AppRouteAccountsData,
  AppRouteDtuCheckRequest,
  AppRouteDtuCheckResult,
  AppRouteDtuOrderRequest,
  AppRouteDtuOrderResult,
  AppRouteServiceNode,
  AppRouteServicesData,
} from './types.js';

/**
 * Thin AppRoute HTTP façade — paths relative to `api_profile.base_url` (e.g. …/api/v1).
 */
export class AppRoutePublicApi {
  constructor(private readonly http: MarketplaceHttpClient) {}

  async getServices(): Promise<AppRouteServicesData> {
    const raw = await this.http.get<unknown>('services');
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env) as AppRouteServicesData;
  }

  /** Single catalog service (parent), including denomination line items. */
  async getService(serviceId: string): Promise<AppRouteServiceNode> {
    const path = `services/${encodeURIComponent(serviceId)}`;
    const raw = await this.http.get<unknown>(path);
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env) as AppRouteServiceNode;
  }

  /** Wallet balances per currency (`GET accounts`). */
  async getAccounts(): Promise<AppRouteAccountsData> {
    const raw = await this.http.get<unknown>('accounts');
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env) as AppRouteAccountsData;
  }

  async postOrders(body: Record<string, unknown>): Promise<unknown> {
    const raw = await this.http.post<unknown>('orders', body);
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env);
  }

  async getOrders(query: { readonly referenceId?: string; readonly orderId?: string; readonly unhide?: boolean }): Promise<unknown> {
    const q = new URLSearchParams();
    if (query.referenceId) q.set('referenceId', query.referenceId);
    if (query.orderId) q.set('orderId', query.orderId);
    if (query.unhide) q.set('unhide', 'true');
    const qs = q.toString();
    const raw = await this.http.get<unknown>(qs ? `orders?${qs}` : 'orders');
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env);
  }

  /**
   * Place a DTU (direct top-up) order. Unlike shop voucher orders, DTU
   * orders top up an external account and do not return voucher codes.
   * `referenceId` is REQUIRED for idempotency.
   */
  async postDtuOrder(req: AppRouteDtuOrderRequest): Promise<AppRouteDtuOrderResult> {
    const body = {
      ordersType: 'dtu',
      referenceId: req.referenceId,
      orders: req.orders.map(serializeDtuLine),
    };
    const raw = await this.http.post<unknown>('orders', body);
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env) as AppRouteDtuOrderResult;
  }

  /**
   * Validate a DTU top-up without creating an order. Returns canRecharge,
   * live price, and provider status. No idempotency key — read-only.
   */
  async postDtuCheck(req: AppRouteDtuCheckRequest): Promise<AppRouteDtuCheckResult> {
    const body = {
      ordersType: 'dtu',
      checkOnly: true,
      orders: req.orders.map(serializeDtuLine),
    };
    const raw = await this.http.post<unknown>('orders', body);
    const env = parseAppRouteEnvelope(raw);
    return assertAppRouteSuccess(env) as AppRouteDtuCheckResult;
  }
}

function serializeDtuLine(
  line: AppRouteDtuOrderRequest['orders'][number],
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    denominationId: line.denominationId,
    quantity: line.quantity,
  };
  if (typeof line.amountCurrencyCode === 'string' && line.amountCurrencyCode.length > 0) {
    out.amountCurrencyCode = line.amountCurrencyCode;
  }
  if (Array.isArray(line.fields) && line.fields.length > 0) {
    out.fields = line.fields.map((f) => ({ key: f.key, value: f.value }));
  }
  return out;
}
