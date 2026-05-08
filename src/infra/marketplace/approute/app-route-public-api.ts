import type { MarketplaceHttpClient } from '../_shared/marketplace-http.js';
import { assertAppRouteSuccess, parseAppRouteEnvelope } from './envelope.js';
import type { AppRouteAccountsData, AppRouteServiceNode, AppRouteServicesData } from './types.js';

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
}
