/**
 * Digiseller admin repository — purchase/info API client + reconciliation.
 *
 * Mirrors the Edge Function's `digiseller-order-info.ts` reconciliation
 * logic: fetch authoritative invoice data from Digiseller, derive fee ratio,
 * update transactions + orders + order_items + seller_listings.
 */
import { injectable, inject } from 'tsyringe';
import { createHash } from 'node:crypto';
import { TOKENS } from '../../di/tokens.js';
import type { IDatabase } from '../../core/ports/database.port.js';
import type { IAdminDigisellerRepository } from '../../core/ports/admin-digiseller-repository.port.js';
import type {
  DigisellerReconcileProfitDto,
  DigisellerReconcileProfitResult,
  DigisellerOrderInfo,
  ReconcileChange,
  ReconcileResultItem,
} from '../../core/use-cases/digiseller/digiseller.types.js';
import { createLogger } from '../../shared/logger.js';

const logger = createLogger('AdminDigisellerRepository');

const DIGISELLER_INVOICE_STATE = {
  PAYMENT_EXPECTED: 1,
  CANCELLED: 2,
  PAID: 3,
  OVERDUE: 4,
  REFUNDED: 5,
  REFUND_NOT_COMPLETED: 35,
} as const;

const WEBMONEY_TO_ISO: Record<string, string> = {
  WMZ: 'USD', WME: 'EUR', WMR: 'RUB', WMU: 'UAH',
  WMB: 'BYN', WMK: 'KZT', WMT: 'USD',
};

function webmoneyToIso(code: string | null | undefined): string | null {
  if (!code) return null;
  return WEBMONEY_TO_ISO[code.trim().toUpperCase()] ?? null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return v.trim() !== '' && Number.isFinite(n) ? n : null;
  }
  return null;
}

const DEFAULT_LIMIT = 50;
const HARD_LIMIT = 100;

function clampLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.round(raw), HARD_LIMIT);
}

@injectable()
export class SupabaseAdminDigisellerRepository implements IAdminDigisellerRepository {
  constructor(
    @inject(TOKENS.Database) private db: IDatabase,
  ) {}

  // ─── Fetch authoritative Digiseller order info ──────────────────────

  async fetchOrderInfo(providerAccountId: string, invoiceId: string): Promise<DigisellerOrderInfo> {
    const invoice = String(invoiceId).trim();
    if (!invoice) throw new Error('invoiceId is required');

    const { token, baseUrl } = await this.resolveDigisellerAuth(providerAccountId);

    const url = `${baseUrl}/api/purchase/info/${encodeURIComponent(invoice)}?token=${encodeURIComponent(token)}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => 'unknown');
      throw new Error(`Digiseller purchase/info HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    const json = await resp.json() as {
      retval: number;
      retdesc: string | null;
      content?: Record<string, unknown>;
    };

    if (json.retval !== 0 || !json.content) {
      throw new Error(`Digiseller purchase/info retval=${json.retval} desc=${json.retdesc ?? 'unknown'}`);
    }

    const c = json.content;
    const nativeCurrency = (String(c.currency_type ?? '')).trim().toUpperCase();

    return {
      invoiceId: invoice,
      itemId: typeof c.item_id === 'number' ? c.item_id : null,
      productName: typeof c.name === 'string' ? c.name : null,
      amountNative: num(c.amount) ?? 0,
      profitNative: num(c.profit),
      agentFeeNative: num(c.agent_fee) ?? 0,
      amountUsd: num(c.amount_usd),
      nativeCurrencyCode: nativeCurrency,
      isoCurrencyCode: webmoneyToIso(nativeCurrency),
      invoiceState: typeof c.invoice_state === 'number'
        ? c.invoice_state : DIGISELLER_INVOICE_STATE.PAYMENT_EXPECTED,
      lockState: typeof c.lock_state === 'string' ? c.lock_state : '',
      dayLock: typeof c.day_lock === 'number' ? c.day_lock : 0,
      datePay: typeof c.date_pay === 'string' ? c.date_pay : null,
      purchaseDate: typeof c.purchase_date === 'string' ? c.purchase_date : null,
      agentId: typeof c.agent_id === 'number' ? c.agent_id : null,
      buyerEmail: (c.buyer_info as Record<string, unknown> | null)?.email as string | null ?? null,
      raw: json.content,
    };
  }

  // ─── Reconcile profit ───────────────────────────────────────────────

  async reconcileProfit(dto: DigisellerReconcileProfitDto): Promise<DigisellerReconcileProfitResult> {
    const modesSelected = [
      dto.transaction_id != null && dto.transaction_id.trim().length > 0,
      dto.invoice_id != null && dto.invoice_id.trim().length > 0,
      dto.all_missing === true,
    ].filter(Boolean).length;

    if (modesSelected !== 1) {
      return {
        ok: false, dry_run: dto.dry_run ?? false, processed: 0,
        summary: { applied: 0, would_apply: 0, unchanged: 0, errored: 1 },
        results: [{ transactionId: '', invoiceId: '', invoiceState: 0, change: 'unchanged', error: 'Specify exactly one of: transaction_id, invoice_id, all_missing' }],
      };
    }

    const providerAccountId = await this.resolveDigisellerAccountId();
    if (!providerAccountId) {
      return {
        ok: false, dry_run: dto.dry_run ?? false, processed: 0,
        summary: { applied: 0, would_apply: 0, unchanged: 0, errored: 1 },
        results: [{ transactionId: '', invoiceId: '', invoiceState: 0, change: 'unchanged', error: 'Digiseller provider account not found' }],
      };
    }

    const targets: Array<{ transactionId?: string; invoiceId?: string }> = [];

    if (dto.transaction_id) {
      targets.push({ transactionId: dto.transaction_id.trim() });
    } else if (dto.invoice_id) {
      targets.push({ invoiceId: dto.invoice_id.trim() });
    } else {
      const limit = clampLimit(dto.limit);
      const rows = await this.db.query<{ id: string }>(
        'transactions',
        {
          select: 'id',
          eq: [['payment_provider', 'digiseller'], ['type', 'marketplace_sale']],
          order: { column: 'created_at', ascending: true },
          limit,
        },
      );
      for (const row of rows ?? []) targets.push({ transactionId: row.id });
    }

    if (targets.length === 0) {
      return {
        ok: true, dry_run: dto.dry_run ?? false, processed: 0,
        summary: { applied: 0, would_apply: 0, unchanged: 0, errored: 0 },
        results: [],
      };
    }

    const summary: Record<ReconcileChange | 'errored', number> = {
      applied: 0, would_apply: 0, unchanged: 0, errored: 0,
    };
    const results: ReconcileResultItem[] = [];

    for (const target of targets) {
      try {
        const r = await this.reconcileSingleTransaction(
          providerAccountId, target, dto.dry_run ?? false,
        );
        summary[r.change] += 1;
        results.push(r);
      } catch (err) {
        summary.errored += 1;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('Digiseller reconcile failed for target', { ...target, error: msg });
        results.push({
          transactionId: target.transactionId ?? '',
          invoiceId: target.invoiceId ?? '',
          invoiceState: 0,
          change: 'unchanged',
          error: msg,
        });
      }
    }

    return {
      ok: summary.errored === 0,
      dry_run: dto.dry_run ?? false,
      processed: targets.length,
      summary,
      results,
    };
  }

  // ─── Single transaction reconciliation ──────────────────────────────

  private async reconcileSingleTransaction(
    providerAccountId: string,
    target: { transactionId?: string; invoiceId?: string },
    dryRun: boolean,
  ): Promise<ReconcileResultItem> {
    const tx = await this.loadTransaction(target);
    if (!tx) throw new Error('Transaction not found');

    const invoice = String(tx.provider_charge_id ?? '').trim();
    if (!invoice) throw new Error('Transaction has no provider_charge_id (Digiseller invoice id)');

    const info = await this.fetchOrderInfo(providerAccountId, invoice);

    const meta = (tx.metadata ?? {}) as Record<string, unknown>;
    const before = {
      feeCents: typeof meta.fee_cents === 'number' ? meta.fee_cents : null,
      profitCents: typeof meta.seller_profit_cents === 'number' ? meta.seller_profit_cents : null,
    };

    const saleAmountCents = typeof tx.amount === 'number' ? tx.amount : Number(tx.amount);
    if (!Number.isFinite(saleAmountCents) || saleAmountCents <= 0) {
      return {
        transactionId: tx.id, invoiceId: invoice, invoiceState: info.invoiceState,
        change: 'unchanged', skippedReason: 'missing_sale_amount', before,
        info: { invoiceState: info.invoiceState, lockState: info.lockState, nativeCurrency: info.nativeCurrencyCode },
      };
    }

    const derived = this.deriveProfitFromOrderInfo(saleAmountCents, info);
    if (!derived) {
      return {
        transactionId: tx.id, invoiceId: invoice, invoiceState: info.invoiceState,
        change: 'unchanged',
        skippedReason: info.invoiceState !== DIGISELLER_INVOICE_STATE.PAID ? 'still_pending' : 'profit_unavailable',
        before,
        info: { invoiceState: info.invoiceState, lockState: info.lockState, nativeCurrency: info.nativeCurrencyCode },
      };
    }

    if (
      before.feeCents === derived.feeCents &&
      before.profitCents === derived.profitCents
    ) {
      return {
        transactionId: tx.id, invoiceId: invoice, invoiceState: info.invoiceState,
        change: 'unchanged', skippedReason: 'no_change', before, after: derived,
        info: { invoiceState: info.invoiceState, lockState: info.lockState, nativeCurrency: info.nativeCurrencyCode },
      };
    }

    if (dryRun) {
      return {
        transactionId: tx.id, invoiceId: invoice, invoiceState: info.invoiceState,
        change: 'would_apply', before, after: derived,
        info: { invoiceState: info.invoiceState, lockState: info.lockState, nativeCurrency: info.nativeCurrencyCode },
      };
    }

    const keyCount = typeof meta.key_count === 'number' && meta.key_count > 0 ? meta.key_count : 1;
    const perUnitGross = Math.max(1, Math.round(saleAmountCents / keyCount));

    const nextMeta: Record<string, unknown> = {
      ...meta,
      fee_cents: derived.feeCents,
      seller_profit_cents: derived.profitCents,
      gross_cents: saleAmountCents,
      unit_price_cents: perUnitGross,
      provider_fee_aggregate_cents: derived.feeCents,
      digiseller_reconciled_at: new Date().toISOString(),
      digiseller_invoice_state: info.invoiceState,
      digiseller_lock_state: info.lockState,
      digiseller_fee_ratio: derived.ratio,
    };

    await this.db.update('transactions', { id: tx.id }, {
      amount: saleAmountCents,
      metadata: nextMeta,
    });

    if (tx.order_id) {
      await this.db.update('orders', { id: tx.order_id }, {
        total_amount: saleAmountCents,
        subtotal_cents: saleAmountCents,
        unit_price: perUnitGross,
        net_amount: derived.profitCents,
        provider_fee: derived.feeCents,
      }).catch((err) => {
        logger.warn('Failed to mirror reconciled amounts to order', {
          orderId: tx.order_id, error: err instanceof Error ? err.message : String(err),
        });
      });

      await this.db.update('order_items', { order_id: tx.order_id }, {
        unit_price: perUnitGross,
        total_price: saleAmountCents,
      }).catch((err) => {
        logger.warn('Failed to update order_items after Digiseller reconcile', {
          orderId: tx.order_id, error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    logger.info('Digiseller transaction reconciled', {
      transactionId: tx.id, invoice, saleAmountCents,
      feeCents: derived.feeCents, profitCents: derived.profitCents,
    });

    return {
      transactionId: tx.id, invoiceId: invoice, invoiceState: info.invoiceState,
      change: 'applied', before, after: derived,
      info: { invoiceState: info.invoiceState, lockState: info.lockState, nativeCurrency: info.nativeCurrencyCode },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private deriveProfitFromOrderInfo(
    saleAmountCents: number,
    info: DigisellerOrderInfo,
  ): { feeCents: number; profitCents: number; ratio: number } | null {
    if (saleAmountCents <= 0) return null;
    if (info.invoiceState !== DIGISELLER_INVOICE_STATE.PAID) return null;
    if (info.profitNative == null) return null;
    if (info.amountNative <= 0) return null;
    if (info.profitNative < 0 || info.profitNative > info.amountNative) return null;

    const ratio = info.profitNative / info.amountNative;
    const profitCents = Math.round(saleAmountCents * ratio);
    const feeCents = Math.max(0, saleAmountCents - profitCents);
    return { feeCents, profitCents, ratio };
  }

  private async loadTransaction(
    target: { transactionId?: string; invoiceId?: string },
  ): Promise<{
    id: string;
    order_id: string | null;
    amount: number;
    currency: string;
    provider_charge_id: string | null;
    metadata: Record<string, unknown>;
  } | null> {
    if (target.transactionId) {
      return this.db.queryOne('transactions', {
        select: 'id, order_id, amount, currency, provider_charge_id, metadata',
        eq: [['id', target.transactionId], ['payment_provider', 'digiseller'], ['type', 'marketplace_sale']],
        single: true,
      });
    }
    if (target.invoiceId) {
      return this.db.queryOne('transactions', {
        select: 'id, order_id, amount, currency, provider_charge_id, metadata',
        eq: [['provider_charge_id', target.invoiceId], ['payment_provider', 'digiseller'], ['type', 'marketplace_sale']],
        single: true,
      });
    }
    return null;
  }

  private async resolveDigisellerAccountId(): Promise<string | null> {
    const account = await this.db.queryOne<{ id: string }>('provider_accounts', {
      select: 'id',
      eq: [['provider_code', 'digiseller']],
      single: true,
    }).catch(() => null);
    return account?.id ?? null;
  }

  private async resolveDigisellerAuth(
    providerAccountId: string,
  ): Promise<{ token: string; baseUrl: string }> {
    const account = await this.db.queryOne<{
      api_profile: Record<string, unknown> | null;
      provider_secrets_ref: Record<string, string> | null;
      cached_token: { accessToken: string; expiresAt: number } | null;
    }>('provider_accounts', {
      select: 'api_profile, provider_secrets_ref, cached_token',
      eq: [['id', providerAccountId]],
      single: true,
    });

    if (!account) throw new Error(`Digiseller provider account ${providerAccountId} not found`);

    const profile = (account.api_profile ?? {}) as Record<string, string>;
    const baseUrl = profile['base_url'] ?? 'https://api.digiseller.com';

    if (account.cached_token?.accessToken && account.cached_token.expiresAt > Date.now() + 5 * 60 * 1000) {
      return { token: account.cached_token.accessToken, baseUrl };
    }

    const secrets = (account.provider_secrets_ref ?? {}) as Record<string, string>;
    const sellerId = secrets['DIGISELLER_SELLER_ID'];
    const apiKey = secrets['DIGISELLER_API_KEY'];
    if (!sellerId || !apiKey) {
      throw new Error('Digiseller secrets missing (DIGISELLER_SELLER_ID / DIGISELLER_API_KEY)');
    }

    const tokenEndpoint = profile['token_endpoint'] ?? `${baseUrl}/api/apilogin`;
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = createHash('sha256').update(apiKey + String(timestamp)).digest('hex');

    const resp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ seller_id: Number(sellerId), timestamp, sign }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`Digiseller token exchange failed: ${resp.status}`);
    }

    const json = await resp.json() as { retval: number; token?: string; valid_thru?: string };
    if (json.retval !== 0 || !json.token) {
      throw new Error(`Digiseller apilogin error: retval=${json.retval}`);
    }

    const expiresAt = json.valid_thru
      ? new Date(json.valid_thru).getTime()
      : Date.now() + 120 * 60 * 1000;

    await this.db.update('provider_accounts', { id: providerAccountId }, {
      cached_token: { accessToken: json.token, expiresAt },
    }).catch(() => {});

    return { token: json.token, baseUrl };
  }
}
