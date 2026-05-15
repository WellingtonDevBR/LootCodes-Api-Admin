import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { IDatabase, QueryOptions } from '../src/core/ports/database.port.js';
import { SupabaseAdminAlertsRepository } from '../src/infra/alerts/supabase-admin-alerts.repository.js';

interface SellerListingRow {
  id: string;
  external_listing_id: string | null;
  price_cents: number;
  cost_basis_cents: number;
  currency: string;
  provider_account_id: string;
  variant_id: string;
  updated_at: string;
  auto_sync_price: boolean;
  status: string;
}

interface DecisionRow {
  seller_listing_id: string;
  action: string;
  reason_code: string;
  decided_at: string;
}

interface AdminAlertRow {
  id: string;
  alert_type: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  is_resolved: boolean;
  resolved_at: string | null;
}

class FakeDb implements Partial<IDatabase> {
  readonly listings: SellerListingRow[];
  readonly decisions: DecisionRow[];
  readonly alerts: AdminAlertRow[];
  readonly providerAccounts: { id: string; provider_code: string }[];
  private nextAlertId = 1;

  constructor(opts: {
    listings?: SellerListingRow[];
    decisions?: DecisionRow[];
    alerts?: AdminAlertRow[];
    providerAccounts?: { id: string; provider_code: string }[];
  } = {}) {
    this.listings = (opts.listings ?? []).map((r) => ({ ...r }));
    this.decisions = (opts.decisions ?? []).map((r) => ({ ...r }));
    this.alerts = (opts.alerts ?? []).map((r) => ({ ...r }));
    this.providerAccounts = (opts.providerAccounts ?? []).map((r) => ({ ...r }));
  }

  async queryAll<T = unknown>(table: string, options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    if (table === 'seller_listings') {
      const eq = options?.eq ?? [];
      const lt = options?.lt ?? [];
      const inFilter = options?.in?.find(([col]) => col === 'id');
      const idsAllowed = inFilter ? new Set(inFilter[1] as string[]) : null;
      return this.listings.filter((row) =>
        eq.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] === val)
        && lt.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] as string < (val as string))
        && (!idsAllowed || idsAllowed.has(row.id)),
      ) as unknown as T[];
    }
    if (table === 'seller_pricing_decisions') {
      const eq = options?.eq ?? [];
      const gte = options?.gte ?? [];
      const rows = this.decisions.filter((row) =>
        eq.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] === val)
        && gte.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] as string >= (val as string)),
      );
      const orderCol = options?.order?.column;
      if (orderCol) {
        rows.sort((a, b) => {
          const av = (a as unknown as Record<string, unknown>)[orderCol] as string;
          const bv = (b as unknown as Record<string, unknown>)[orderCol] as string;
          return options.order?.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      return rows as unknown as T[];
    }
    if (table === 'admin_alerts') {
      const eq = options?.eq ?? [];
      return this.alerts.filter((row) =>
        eq.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] === val),
      ) as unknown as T[];
    }
    if (table === 'provider_accounts') {
      const inFilter = options?.in?.find(([col]) => col === 'id');
      if (!inFilter) return [] as unknown as T[];
      const ids = new Set(inFilter[1] as string[]);
      return this.providerAccounts.filter((a) => ids.has(a.id)) as unknown as T[];
    }
    throw new Error(`unexpected queryAll table ${table}`);
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    if (table !== 'admin_alerts') throw new Error(`unexpected insert table ${table}`);
    const row: AdminAlertRow = {
      id: `alert-${this.nextAlertId++}`,
      alert_type: data.alert_type as string,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      is_read: false,
      is_resolved: false,
      resolved_at: null,
    };
    this.alerts.push(row);
    return row as unknown as T;
  }

  async update<T = unknown>(table: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T[]> {
    if (table !== 'admin_alerts') throw new Error(`unexpected update table ${table}`);
    const updated: AdminAlertRow[] = [];
    for (const alert of this.alerts) {
      if (alert.id === filter.id) {
        if (data.is_resolved !== undefined) alert.is_resolved = data.is_resolved as boolean;
        if (data.resolved_at !== undefined) alert.resolved_at = data.resolved_at as string | null;
        if (data.is_read !== undefined) alert.is_read = data.is_read as boolean;
        updated.push(alert);
      }
    }
    return updated as unknown as T[];
  }
}

describe('SupabaseAdminAlertsRepository.syncSellerListingPricingFrozenAlerts', () => {
  const sixHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const justNow = new Date().toISOString();

  it('creates an alert for a listing priced below cost basis for >1h', async () => {
    const db = new FakeDb({
      listings: [
        {
          id: 'L1', external_listing_id: 'ext-1',
          price_cents: 800, cost_basis_cents: 1000, currency: 'EUR',
          provider_account_id: 'PA1', variant_id: 'V1',
          updated_at: twoHoursAgo, auto_sync_price: true, status: 'active',
        },
      ],
      providerAccounts: [{ id: 'PA1', provider_code: 'eneba' }],
    });
    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const out = await repo.syncSellerListingPricingFrozenAlerts();

    expect(out.alertsCreated).toBe(1);
    expect(out.frozenListingCount).toBe(1);
    expect(db.alerts[0].alert_type).toBe('seller_listing_pricing_frozen');
    expect(db.alerts[0].metadata.listingId).toBe('L1');
    expect(db.alerts[0].metadata.reason).toBe('below_cost');
  });

  it('creates an alert for a listing whose latest pricing decision is budget_exhausted >6h ago', async () => {
    const db = new FakeDb({
      listings: [
        {
          id: 'L1', external_listing_id: 'ext-1',
          price_cents: 1200, cost_basis_cents: 1000, currency: 'EUR',
          provider_account_id: 'PA1', variant_id: 'V1',
          updated_at: justNow, auto_sync_price: true, status: 'active',
        },
      ],
      decisions: [
        { seller_listing_id: 'L1', action: 'skipped', reason_code: 'budget_exhausted', decided_at: sixHoursAgo },
      ],
      providerAccounts: [{ id: 'PA1', provider_code: 'eneba' }],
    });
    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const out = await repo.syncSellerListingPricingFrozenAlerts();

    expect(out.alertsCreated).toBe(1);
    expect(db.alerts[0].metadata.reason).toBe('budget_exhausted');
  });

  it('does NOT create an alert when latest decision is pushed (listing recovered)', async () => {
    const db = new FakeDb({
      listings: [
        {
          id: 'L1', external_listing_id: 'ext-1',
          price_cents: 1200, cost_basis_cents: 1000, currency: 'EUR',
          provider_account_id: 'PA1', variant_id: 'V1',
          updated_at: justNow, auto_sync_price: true, status: 'active',
        },
      ],
      decisions: [
        { seller_listing_id: 'L1', action: 'pushed', reason_code: 'floor_correction', decided_at: justNow },
        { seller_listing_id: 'L1', action: 'skipped', reason_code: 'budget_exhausted', decided_at: sixHoursAgo },
      ],
      providerAccounts: [{ id: 'PA1', provider_code: 'eneba' }],
    });
    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const out = await repo.syncSellerListingPricingFrozenAlerts();

    expect(out.alertsCreated).toBe(0);
    expect(out.frozenListingCount).toBe(0);
  });

  it('auto-resolves an existing open alert when the listing recovers', async () => {
    const db = new FakeDb({
      listings: [
        {
          id: 'L1', external_listing_id: 'ext-1',
          price_cents: 1200, cost_basis_cents: 1000, currency: 'EUR',
          provider_account_id: 'PA1', variant_id: 'V1',
          updated_at: justNow, auto_sync_price: true, status: 'active',
        },
      ],
      alerts: [
        {
          id: 'A1', alert_type: 'seller_listing_pricing_frozen',
          metadata: { listingId: 'L1' }, is_read: false, is_resolved: false, resolved_at: null,
        },
      ],
      providerAccounts: [{ id: 'PA1', provider_code: 'eneba' }],
    });
    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const out = await repo.syncSellerListingPricingFrozenAlerts();

    expect(out.alertsResolved).toBe(1);
    expect(db.alerts[0].is_resolved).toBe(true);
    expect(db.alerts[0].resolved_at).not.toBeNull();
  });
});
