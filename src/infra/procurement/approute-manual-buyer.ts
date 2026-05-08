import { createHash } from 'node:crypto';
import type { MarketplaceHttpClient } from '../marketplace/_shared/marketplace-http.js';
import { MarketplaceApiError } from '../marketplace/_shared/marketplace-http.js';
import { AppRoutePublicApi } from '../marketplace/approute/app-route-public-api.js';
import { createAppRouteMarketplaceHttpClient } from '../marketplace/approute/create-app-route-http-client.js';
import { resolveAppRouteBaseUrlFromApiProfile } from '../marketplace/approute/resolve-app-route-base-url.js';
import {
  formatAppRouteErrors,
  isIdempotencyReplayError,
  parseAppRouteEnvelope,
  type AppRouteEnvelope,
} from '../marketplace/approute/envelope.js';
import { floatToCents } from '../../shared/pricing.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('approute-manual-buyer');

const POLL_INTERVAL_MS = 150;
const POLL_MAX_ATTEMPTS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic UUID-shaped reference id from idempotency material (same semantics as Bamboo manual buyer). */
export function approuteReferenceUuidFromKey(input: string): string {
  const hex = createHash('sha256').update(input, 'utf8').digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

export interface AppRouteManualPurchaseExecResult {
  readonly success: boolean;
  readonly keys?: ReadonlyArray<string>;
  readonly provider_order_ref?: string;
  readonly cost_cents?: number | null;
  readonly currency?: string;
  readonly error_code?: string;
  readonly error_message?: string;
}

export function createAppRouteManualBuyer(params: {
  readonly secrets: Record<string, string>;
  readonly profile: Record<string, unknown>;
}): AppRouteManualBuyer | null {
  const apiKey = params.secrets['APPROUTE_API_KEY'];
  const baseUrl = resolveAppRouteBaseUrlFromApiProfile(params.profile);
  if (!apiKey?.trim() || !baseUrl?.trim()) {
    logger.warn('AppRoute manual buyer unavailable — missing APPROUTE_API_KEY or api_profile.base_url');
    return null;
  }

  const http = createAppRouteMarketplaceHttpClient({
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
  });
  return new AppRouteManualBuyer(new AppRoutePublicApi(http), http);
}

function isMaskedVoucher(value: string): boolean {
  const t = value.trim();
  if (t.length === 0) return true;
  return /[*•]+/.test(t) || /^x{3,}$/i.test(t);
}

function extractVoucherCodes(node: unknown, acc: string[]): void {
  if (node == null) return;
  if (typeof node === 'string') return;
  if (Array.isArray(node)) {
    for (const x of node) extractVoucherCodes(x, acc);
    return;
  }
  if (typeof node === 'object') {
    const o = node as Record<string, unknown>;
    for (const key of ['code', 'voucherCode', 'pin', 'serial', 'voucher']) {
      const v = o[key];
      if (typeof v === 'string' && v.length > 0 && !isMaskedVoucher(v)) {
        acc.push(v);
      }
    }
    for (const v of Object.values(o)) extractVoucherCodes(v, acc);
  }
}

function collectCodes(data: unknown): string[] {
  const acc: string[] = [];
  extractVoucherCodes(data, acc);
  return [...new Set(acc)];
}

function extractCost(data: unknown): { cents: number | null; currency: string } {
  let currency = 'USD';

  const scan = (node: unknown): number | null => {
    if (node == null) return null;
    if (typeof node === 'object' && !Array.isArray(node)) {
      const o = node as Record<string, unknown>;
      const c = o.currency;
      if (typeof c === 'string' && /^[A-Za-z]{3}$/.test(c.trim())) {
        currency = c.trim().toUpperCase();
      }

      const centsRaw = o.totalAmountCents ?? o.total_price_cents ?? o.costCents ?? o.priceCents;
      if (typeof centsRaw === 'number' && Number.isFinite(centsRaw)) {
        return Math.round(centsRaw);
      }

      const tp = o.totalPrice ?? o.total_amount ?? o.amount ?? o.total;
      if (typeof tp === 'number' && Number.isFinite(tp)) {
        return floatToCents(tp);
      }
      if (typeof tp === 'string') {
        const n = Number.parseFloat(tp.trim());
        return Number.isFinite(n) ? floatToCents(n) : null;
      }

      for (const v of Object.values(o)) {
        const hit = scan(v);
        if (hit != null) return hit;
      }
    }
    if (Array.isArray(node)) {
      for (const x of node) {
        const hit = scan(x);
        if (hit != null) return hit;
      }
    }
    return null;
  };

  return { cents: scan(data), currency };
}

function classifyPollEnvelope(env: AppRouteEnvelope): {
  readonly kind: 'continue' | 'done' | 'error';
  readonly data?: unknown;
  readonly message?: string;
  readonly code?: string;
} {
  const errs = env.errors;
  if (Array.isArray(errs) && errs.length > 0) {
    const msg = formatAppRouteErrors(errs);
    let code: string | undefined;
    if (/OUT_OF_STOCK/i.test(msg)) code = 'OUT_OF_STOCK';
    else if (/INSUFFICIENT_FUNDS/i.test(msg)) code = 'INSUFFICIENT_FUNDS';
    else if (/IDEMPOTENCY_REPLAY/i.test(msg)) return { kind: 'continue' };
    return { kind: 'error', message: msg, code };
  }

  if (typeof env.statusCode === 'number' && env.statusCode >= 400) {
    const msg = env.statusMessage ?? String(env.statusCode);
    let code: string | undefined;
    if (/OUT_OF_STOCK/i.test(msg)) code = 'OUT_OF_STOCK';
    else if (/INSUFFICIENT_FUNDS/i.test(msg)) code = 'INSUFFICIENT_FUNDS';
    return { kind: 'error', message: msg, code };
  }

  const data = env.data;
  const statusText = deepFindStatus(data).toUpperCase();

  if (
    statusText.includes('IN_PROGRESS')
    || statusText.includes('PENDING')
    || statusText.includes('PROCESS')
    || statusText.includes('PROGRESS')
  ) {
    return { kind: 'continue' };
  }

  if (
    statusText.includes('SUCCESS')
    || statusText.includes('COMPLET')
    || statusText.includes('FULFIL')
  ) {
    return { kind: 'done', data };
  }

  if (
    statusText.includes('FAIL')
    || statusText.includes('CANCEL')
    || statusText.includes('ERROR')
    || statusText.includes('REJECT')
  ) {
    return { kind: 'error', message: statusText || 'AppRoute order failed' };
  }

  const codes = collectCodes(data);
  if (codes.length > 0) {
    return { kind: 'done', data };
  }

  if (statusText.length === 0) {
    return { kind: 'continue' };
  }

  return { kind: 'done', data };
}

function deepFindStatus(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  if (typeof o.status === 'string') return o.status;
  if (typeof o.orderStatus === 'string') return o.orderStatus;
  if (typeof o.state === 'string') return o.state;

  for (const key of ['result', 'order', 'data']) {
    const inner = o[key];
    const found = deepFindStatus(inner);
    if (found) return found;
  }

  const orders = o.orders;
  if (Array.isArray(orders) && orders.length > 0) {
    const found = deepFindStatus(orders[0]);
    if (found) return found;
  }

  return '';
}

export class AppRouteManualBuyer {
  constructor(
    private readonly api: AppRoutePublicApi,
    private readonly http: MarketplaceHttpClient,
  ) {}

  /**
   * Shop voucher flow: POST /orders → poll GET /orders → optional `unhide=true` for plaintext voucher codes.
   */
  async purchase(
    denominationId: string,
    quantity: number,
    idempotencyKey: string,
  ): Promise<AppRouteManualPurchaseExecResult> {
    const referenceUuid = approuteReferenceUuidFromKey(idempotencyKey);
    const body = {
      referenceId: referenceUuid,
      ordersType: 'shop',
      orders: [{
        denominationId,
        quantity,
      }],
    };

    try {
      await this.tryPostOrders(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error_code: 'ORDER_CREATE_FAILED',
        error_message: message,
      };
    }

    const polled = await this.pollOrder(referenceUuid, false);
    if (!polled.ok) {
      return polled.error;
    }

    let data: unknown = polled.data;
    let codes = collectCodes(data);
    const needsUnhide = codes.length === 0 || codes.some(isMaskedVoucher);

    if (needsUnhide) {
      const revealed = await this.pollOrder(referenceUuid, true);
      if (!revealed.ok) {
        return revealed.error;
      }
      data = revealed.data;
      codes = collectCodes(data);
    }

    if (codes.length === 0) {
      return {
        success: false,
        provider_order_ref: referenceUuid,
        error_code: 'NO_KEYS_RETURNED',
        error_message: 'AppRoute returned no voucher codes after terminal order state',
      };
    }

    const cost = extractCost(data);
    return {
      success: true,
      keys: codes,
      provider_order_ref: referenceUuid,
      cost_cents: cost.cents,
      currency: cost.currency,
    };
  }

  private async tryPostOrders(body: Record<string, unknown>): Promise<void> {
    try {
      await this.api.postOrders(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const extra = err instanceof MarketplaceApiError ? (err.responseBody ?? '') : '';
      if (isIdempotencyReplayError(`${msg}\n${extra}`)) {
        logger.info('AppRoute POST /orders — idempotency replay; polling existing order');
        return;
      }
      throw err;
    }
  }

  private async pollOrder(
    referenceId: string,
    unhide: boolean,
  ): Promise<
    | { ok: true; data: unknown }
    | { ok: false; error: AppRouteManualPurchaseExecResult }
  > {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(POLL_INTERVAL_MS);

      let raw: unknown;
      try {
        const qs = unhide
          ? `orders?referenceId=${encodeURIComponent(referenceId)}&unhide=true`
          : `orders?referenceId=${encodeURIComponent(referenceId)}`;
        raw = await this.http.get<unknown>(qs);
      } catch (err) {
        if (err instanceof MarketplaceApiError) {
          const msg = `${err.message}${err.responseBody ?? ''}`;
          if (/OUT_OF_STOCK/i.test(msg)) {
            return {
              ok: false,
              error: {
                success: false,
                provider_order_ref: referenceId,
                error_code: 'OUT_OF_STOCK',
                error_message: msg,
              },
            };
          }
          if (/INSUFFICIENT_FUNDS/i.test(msg)) {
            return {
              ok: false,
              error: {
                success: false,
                provider_order_ref: referenceId,
                error_code: 'INSUFFICIENT_FUNDS',
                error_message: msg,
              },
            };
          }
        }
        continue;
      }

      const env = parseAppRouteEnvelope(raw);
      const kind = classifyPollEnvelope(env);
      if (kind.kind === 'error') {
        return {
          ok: false,
          error: {
            success: false,
            provider_order_ref: referenceId,
            error_code: kind.code ?? 'ORDER_FAILED',
            error_message: kind.message ?? 'AppRoute order error',
          },
        };
      }
      if (kind.kind === 'done') {
        return { ok: true, data: kind.data };
      }
    }

    return {
      ok: false,
      error: {
        success: false,
        provider_order_ref: referenceId,
        error_code: 'ORDER_TIMEOUT',
        error_message: 'AppRoute order did not reach a terminal state in time',
      },
    };
  }
}
