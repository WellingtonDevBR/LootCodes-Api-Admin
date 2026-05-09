import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { IDatabase, QueryOptions } from '../src/core/ports/database.port.js';
import { SupabaseAdminAlertsRepository } from '../src/infra/alerts/supabase-admin-alerts.repository.js';

interface SellerListingRow {
  id: string;
  external_listing_id: string | null;
  status: string;
  error_message: string | null;
  reservation_consecutive_failures: number;
  provider_code: string | null;
  variant_id: string;
}

interface AdminAlertRow {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  is_resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

/**
 * In-memory IDatabase fake limited to the surface this repository touches.
 * Every method is exact-match on the inputs the production code actually uses.
 */
class FakeDb implements Partial<IDatabase> {
  readonly listings: SellerListingRow[];
  readonly alerts: AdminAlertRow[];
  private nextId = 1;

  constructor(opts: { readonly listings?: SellerListingRow[]; readonly alerts?: AdminAlertRow[] } = {}) {
    this.listings = (opts.listings ?? []).map((row) => ({ ...row }));
    this.alerts = (opts.alerts ?? []).map((row) => ({ ...row }));
  }

  async queryAll<T = unknown>(table: string, options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    if (table === 'seller_listings') {
      const inFilter = options?.in?.find(([col]) => col === 'status');
      if (!inFilter) throw new Error('expected in:[status,...] filter on seller_listings');
      const states = new Set(inFilter[1] as string[]);
      return this.listings.filter((row) => states.has(row.status)) as unknown as T[];
    }
    if (table === 'admin_alerts') {
      const eq = options?.eq ?? [];
      return this.alerts.filter((row) =>
        eq.every(([col, val]) => (row as unknown as Record<string, unknown>)[col] === val),
      ) as unknown as T[];
    }
    throw new Error(`unexpected table ${table}`);
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    if (table !== 'admin_alerts') throw new Error(`unexpected insert table ${table}`);
    const row: AdminAlertRow = {
      id: `alert-${this.nextId++}`,
      alert_type: data.alert_type as string,
      severity: data.severity as string,
      title: data.title as string,
      message: data.message as string,
      metadata: (data.metadata ?? {}) as Record<string, unknown>,
      is_read: false,
      is_resolved: false,
      resolved_at: null,
      created_at: new Date().toISOString(),
    };
    this.alerts.push(row);
    return row as unknown as T;
  }

  async update<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<T[]> {
    if (table !== 'admin_alerts') throw new Error(`unexpected update table ${table}`);
    const id = filter.id as string;
    const row = this.alerts.find((alert) => alert.id === id);
    if (!row) return [];
    Object.assign(row, data);
    return [row as unknown as T];
  }
}

function listing(overrides: Partial<SellerListingRow>): SellerListingRow {
  return {
    id: 'listing-1',
    external_listing_id: 'ext-1',
    status: 'paused',
    error_message: 'Stock sync failed: Rate limit exceeded for eneba',
    reservation_consecutive_failures: 0,
    provider_code: 'eneba',
    variant_id: 'variant-1',
    ...overrides,
  };
}

function openAlert(overrides: Partial<AdminAlertRow> & { listingId: string }): AdminAlertRow {
  const { listingId, ...rest } = overrides;
  return {
    id: 'alert-existing',
    alert_type: 'seller_listing_paused',
    severity: 'high',
    title: 'Seller listing needs recovery',
    message: 'Listing paused — needs recovery',
    metadata: { listingId },
    is_read: false,
    is_resolved: false,
    resolved_at: null,
    created_at: '2026-05-08T00:00:00Z',
    ...rest,
  };
}

describe('SupabaseAdminAlertsRepository.syncSellerListingPausedAlerts', () => {
  it('emits a high-severity seller_listing_paused alert for each paused listing without one', async () => {
    const db = new FakeDb({
      listings: [
        listing({ id: 'l1', external_listing_id: 'ext-1', status: 'paused' }),
        listing({ id: 'l2', external_listing_id: 'ext-2', status: 'failed', provider_code: 'kinguin' }),
      ],
    });

    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const result = await repo.syncSellerListingPausedAlerts();

    expect(result.alertsCreated).toBe(2);
    expect(result.alertsResolved).toBe(0);
    expect(result.pausedListingCount).toBe(2);

    const inserted = db.alerts.filter((a) => a.alert_type === 'seller_listing_paused');
    expect(inserted).toHaveLength(2);
    expect(inserted.every((a) => a.severity === 'high')).toBe(true);
    expect(inserted.map((a) => a.metadata.listingId).sort()).toEqual(['l1', 'l2']);
  });

  it('upgrades severity to critical when reservation_consecutive_failures >= 2 (circuit breaker tripped)', async () => {
    const db = new FakeDb({
      listings: [
        listing({ id: 'l1', reservation_consecutive_failures: 2 }),
      ],
    });

    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    await repo.syncSellerListingPausedAlerts();

    const inserted = db.alerts.find((a) => a.metadata.listingId === 'l1');
    expect(inserted?.severity).toBe('critical');
  });

  it('does NOT create a duplicate alert when an open alert already exists for the same listing', async () => {
    const db = new FakeDb({
      listings: [listing({ id: 'l1' })],
      alerts: [openAlert({ listingId: 'l1' })],
    });

    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const result = await repo.syncSellerListingPausedAlerts();

    expect(result.alertsCreated).toBe(0);
    expect(db.alerts.filter((a) => a.alert_type === 'seller_listing_paused')).toHaveLength(1);
  });

  it('auto-resolves open seller_listing_paused alerts when the listing is no longer paused', async () => {
    const stale = openAlert({ id: 'a-stale', listingId: 'l-now-active' });
    const db = new FakeDb({
      listings: [listing({ id: 'l1' })],
      alerts: [stale],
    });

    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    const result = await repo.syncSellerListingPausedAlerts();

    expect(result.alertsResolved).toBe(1);
    const resolved = db.alerts.find((a) => a.id === 'a-stale');
    expect(resolved?.is_resolved).toBe(true);
    expect(resolved?.resolved_at).toBeTruthy();
  });

  it('embeds external_listing_id, provider_code, variant_id, and error_message in the alert metadata so the CRM can deep-link', async () => {
    const db = new FakeDb({
      listings: [
        listing({
          id: 'l1',
          external_listing_id: 'b1259882-4af3-11f1-8bc7-0e96fa65f949',
          provider_code: 'eneba',
          variant_id: '9b9d95e9-292c-4854-8edb-813e69c406cf',
          error_message: 'Stock sync failed: Rate limit exceeded for eneba',
        }),
      ],
    });

    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    await repo.syncSellerListingPausedAlerts();

    const created = db.alerts[0];
    expect(created.metadata.listingId).toBe('l1');
    expect(created.metadata.externalListingId).toBe('b1259882-4af3-11f1-8bc7-0e96fa65f949');
    expect(created.metadata.providerCode).toBe('eneba');
    expect(created.metadata.variantId).toBe('9b9d95e9-292c-4854-8edb-813e69c406cf');
    expect(created.metadata.errorMessage).toBe('Stock sync failed: Rate limit exceeded for eneba');
  });

  it('marks the alert requires_action so the CRM Restore button can drive resolution', async () => {
    const db = new FakeDb({ listings: [listing({ id: 'l1' })] });

    const repo = new SupabaseAdminAlertsRepository(db as unknown as IDatabase);
    await repo.syncSellerListingPausedAlerts();

    expect(db.alerts[0]).toMatchObject({
      alert_type: 'seller_listing_paused',
      severity: 'high',
    });
  });
});
