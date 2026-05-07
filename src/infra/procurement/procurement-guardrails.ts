/**
 * Procurement guardrails for admin manual purchase — mirrors Edge `_shared` helpers.
 */
import type { IDatabase } from '../../core/ports/database.port.js';

export interface ProviderProcurementConfig {
  readonly auto_buy_enabled: boolean;
  readonly max_cost_per_item_cents: number | null;
  readonly daily_spend_limit_cents: number | null;
  readonly min_jit_margin_cents: number;
}

const DEFAULT_CONFIG: ProviderProcurementConfig = {
  auto_buy_enabled: false,
  max_cost_per_item_cents: null,
  daily_spend_limit_cents: null,
  min_jit_margin_cents: 0,
};

function parseConfigFromRaw(raw: Record<string, unknown>): ProviderProcurementConfig {
  return {
    auto_buy_enabled: raw.auto_buy_enabled === true,
    max_cost_per_item_cents:
      typeof raw.max_cost_per_item_cents === 'number' ? raw.max_cost_per_item_cents : null,
    daily_spend_limit_cents:
      typeof raw.daily_spend_limit_cents === 'number' ? raw.daily_spend_limit_cents : null,
    min_jit_margin_cents:
      typeof raw.min_jit_margin_cents === 'number' ? raw.min_jit_margin_cents : 0,
  };
}

export async function getProviderProcurementConfig(db: IDatabase): Promise<ProviderProcurementConfig> {
  try {
    const rows = await db.query<{ value: unknown }>('platform_settings', {
      select: 'value',
      eq: [['key', 'provider_procurement_config']],
      limit: 1,
    });
    const row = rows[0];
    if (!row?.value || typeof row.value !== 'object' || row.value === null || Array.isArray(row.value)) {
      return DEFAULT_CONFIG;
    }
    return parseConfigFromRaw(row.value as Record<string, unknown>);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function getDailyProcurementSpendCents(db: IDatabase): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  try {
    const rows = await db.query<{ amount: number | string | null }>('transactions', {
      select: 'amount',
      eq: [
        ['type', 'purchase'],
        ['direction', 'debit'],
      ],
      gte: [['created_at', todayStart.toISOString()]],
    });

    return rows.reduce((sum, row) => {
      const n = typeof row.amount === 'number' ? row.amount : Number(row.amount);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
  } catch {
    return 0;
  }
}

export interface VariantSalesBlockStatus {
  readonly blocked: boolean;
  readonly reason: string | null;
  readonly blockedAt: string | null;
}

export async function getVariantSalesBlockStatus(
  db: IDatabase,
  variantId: string,
): Promise<VariantSalesBlockStatus> {
  try {
    const row = await db.queryOne<{
      sales_blocked_at: string | null;
      sales_blocked_reason: string | null;
    }>('product_variants', {
      select: 'sales_blocked_at, sales_blocked_reason',
      filter: { id: variantId },
    });

    if (!row) {
      return { blocked: false, reason: null, blockedAt: null };
    }

    const blockedAt = row.sales_blocked_at ?? null;
    return {
      blocked: blockedAt !== null,
      reason: row.sales_blocked_reason ?? null,
      blockedAt,
    };
  } catch {
    return { blocked: false, reason: null, blockedAt: null };
  }
}
