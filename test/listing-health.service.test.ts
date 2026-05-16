import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'reflect-metadata';
import { ListingHealthService } from '../src/infra/seller/listing-health.service.js';
import type { IDatabase, QueryOptions } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';

interface SellerListingRow {
  id: string;
  external_listing_id: string;
  status: string;
  listing_type?: string;
  provider_account_id?: string;
  reservation_consecutive_failures: number;
  reservation_success_count: number;
  reservation_failure_count: number;
  provision_success_count: number;
  provision_failure_count: number;
  provider_metadata?: Record<string, unknown> | null;
}

interface AdminAlertRow {
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
}

class FakeDb implements Partial<IDatabase> {
  readonly listings: SellerListingRow[];
  readonly providers: Array<{ id: string; provider_code: string }> = [
    { id: 'pa-1', provider_code: 'eneba' },
  ];
  readonly alerts: AdminAlertRow[] = [];

  constructor(initial: SellerListingRow[]) {
    this.listings = initial.map((row) => ({ ...row }));
  }

  async queryOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    if (table === 'seller_listings') {
      const eq = options?.eq ?? [];
      const externalListingId = eq.find(([col]) => col === 'external_listing_id')?.[1];
      const match = this.listings.find((row) => row.external_listing_id === externalListingId);
      return (match as T | undefined) ?? null;
    }
    if (table === 'provider_accounts') {
      const eq = options?.eq ?? [];
      const id = eq.find(([col]) => col === 'id')?.[1];
      const match = this.providers.find((row) => row.id === id);
      return (match as T | undefined) ?? null;
    }
    throw new Error(`unexpected table ${table}`);
  }

  async update<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<T[]> {
    if (table !== 'seller_listings') {
      throw new Error(`unexpected update table ${table}`);
    }
    const id = filter.id as string;
    const row = this.listings.find((listing) => listing.id === id);
    if (!row) return [];
    Object.assign(row, data);
    return [row as T];
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    if (table !== 'admin_alerts') {
      throw new Error(`unexpected insert table ${table}`);
    }
    this.alerts.push(data as unknown as AdminAlertRow);
    return data as T;
  }
}

class FakeRegistry implements Partial<IMarketplaceAdapterRegistry> {
  readonly declareStockCalls: Array<{ providerCode: string; externalId: string; qty: number }> = [];

  getDeclaredStockAdapter(providerCode: string) {
    const calls = this.declareStockCalls;
    return {
      providerCode,
      async declareStock(externalListingId: string, quantity: number) {
        calls.push({ providerCode, externalId: externalListingId, qty: quantity });
        return { success: true, declaredQuantity: quantity };
      },
    } as unknown as ReturnType<IMarketplaceAdapterRegistry['getDeclaredStockAdapter']>;
  }
}

function makeListing(overrides: Partial<SellerListingRow> = {}): SellerListingRow {
  return {
    id: 'listing-1',
    external_listing_id: 'ext-1',
    status: 'active',
    listing_type: 'declared_stock',
    provider_account_id: 'pa-1',
    reservation_consecutive_failures: 0,
    reservation_success_count: 0,
    reservation_failure_count: 0,
    provision_success_count: 0,
    provision_failure_count: 0,
    provider_metadata: null,
    ...overrides,
  };
}

function makeService(db: FakeDb, registry?: FakeRegistry): ListingHealthService {
  return new ListingHealthService(
    db as unknown as IDatabase,
    (registry ?? new FakeRegistry()) as unknown as IMarketplaceAdapterRegistry,
  );
}

describe('ListingHealthService.updateHealthCounters — alert semantics', () => {
  let db: FakeDb;

  describe('successful operation in warning band', () => {
    beforeEach(() => {
      db = new FakeDb([
        makeListing({
          provision_success_count: 67,
          provision_failure_count: 2,
        }),
      ]);
    });

    it('does not create an admin alert on a successful provision when both prev and new ratio sit in the warning band', async () => {
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', true);

      expect(db.alerts).toEqual([]);
    });

    it('still increments the success counter even though no alert is created', async () => {
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', true);

      expect(db.listings[0].provision_success_count).toBe(68);
      expect(db.listings[0].provision_failure_count).toBe(2);
    });

    it('keeps the listing active when a successful op happens in the warning band', async () => {
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', true);

      expect(db.listings[0].status).toBe('active');
    });
  });

  describe('warning-band edge transitions', () => {
    it('creates exactly one warning alert when a failure first crosses into the warning band', async () => {
      // prev ratio = log(3)/log(2000) ≈ 0.144 (below warning 0.16)
      // new  ratio = log(4)/log(2000) ≈ 0.182 (warning band [0.16, 0.20))
      db = new FakeDb([
        makeListing({
          provision_success_count: 2000,
          provision_failure_count: 3,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', false);

      expect(db.alerts).toHaveLength(1);
      expect(db.alerts[0].alert_type).toBe('seller_health_threshold_warning');
      expect(db.alerts[0].severity).toBe('high');
    });

    it('does not create a second warning alert when a further failure stays inside the warning band', async () => {
      // prev ratio = log(5)/log(10000) ≈ 0.175 (warning band)
      // new  ratio = log(6)/log(10000) ≈ 0.195 (still warning band, < 0.20)
      db = new FakeDb([
        makeListing({
          provision_success_count: 10000,
          provision_failure_count: 5,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', false);

      expect(db.alerts).toEqual([]);
    });
  });

  describe('breach edge transitions', () => {
    it('creates exactly one critical alert and auto-pauses when a failure first crosses the threshold', async () => {
      db = new FakeDb([
        makeListing({
          provision_success_count: 10,
          provision_failure_count: 1,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', false);

      expect(db.listings[0].status).toBe('paused');
      expect(db.alerts).toHaveLength(1);
      expect(db.alerts[0].alert_type).toBe('seller_health_threshold_breached');
      expect(db.alerts[0].severity).toBe('critical');
    });

    it('does not re-emit a breach alert on a subsequent failure when both prev and new ratio sit above the threshold', async () => {
      db = new FakeDb([
        makeListing({
          status: 'paused',
          provision_success_count: 5,
          provision_failure_count: 3,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', false);

      expect(db.alerts).toEqual([]);
    });

    it('does not re-emit a breach alert on a successful op while the ratio remains above the threshold', async () => {
      db = new FakeDb([
        makeListing({
          status: 'paused',
          provision_success_count: 5,
          provision_failure_count: 3,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', true);

      expect(db.alerts).toEqual([]);
    });
  });

  describe('reservation circuit breaker', () => {
    it('pauses and alerts on the second consecutive reservation failure', async () => {
      db = new FakeDb([
        makeListing({
          reservation_consecutive_failures: 1,
          reservation_success_count: 50,
          reservation_failure_count: 1,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', false);

      expect(db.listings[0].status).toBe('paused');
      expect(db.alerts).toHaveLength(1);
      expect(db.alerts[0].alert_type).toBe('seller_reservation_circuit_tripped');
    });

    it('does not re-alert on the third consecutive reservation failure', async () => {
      db = new FakeDb([
        makeListing({
          status: 'paused',
          reservation_consecutive_failures: 2,
          reservation_success_count: 50,
          reservation_failure_count: 2,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', false);

      expect(db.alerts).toEqual([]);
    });

    it('does not emit an error log on the third consecutive reservation failure', async () => {
      db = new FakeDb([
        makeListing({
          status: 'paused',
          reservation_consecutive_failures: 2,
          reservation_success_count: 50,
          reservation_failure_count: 2,
        }),
      ]);
      const service = makeService(db);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        await service.updateHealthCounters('ext-1', 'reservation', false);

        const circuitErrors = consoleError.mock.calls.filter(([msg]) =>
          typeof msg === 'string' && msg.includes('Reservation circuit breaker'),
        );
        expect(circuitErrors).toEqual([]);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('resets the consecutive counter on a successful reservation', async () => {
      db = new FakeDb([
        makeListing({
          reservation_consecutive_failures: 1,
          reservation_success_count: 5,
          reservation_failure_count: 1,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', true);

      expect(db.listings[0].reservation_consecutive_failures).toBe(0);
    });
  });

  describe('out-of-stock circuit breaker', () => {
    it('does not increment reservation_consecutive_failures on out_of_stock (genuine-error counter stays clean)', async () => {
      db = new FakeDb([
        makeListing({
          reservation_consecutive_failures: 0,
          reservation_success_count: 100,
          reservation_failure_count: 0,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', false, 'out_of_stock');

      expect(db.listings[0].reservation_consecutive_failures).toBe(0);
      expect(db.listings[0].reservation_failure_count).toBe(0);
    });

    it('tracks consecutive out_of_stock failures in provider_metadata.healthMetrics', async () => {
      db = new FakeDb([makeListing()]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', false, 'out_of_stock');
      await service.updateHealthCounters('ext-1', 'reservation', false, 'out_of_stock');
      await service.updateHealthCounters('ext-1', 'reservation', false, 'out_of_stock');

      const meta = db.listings[0].provider_metadata as Record<string, unknown> | null;
      const health = meta?.healthMetrics as Record<string, unknown> | undefined;
      expect(health?.out_of_stock_consecutive_failures).toBe(3);
      expect(db.listings[0].status).toBe('active');
      expect(db.alerts).toEqual([]);
    });

    it('resets the OOS counter on a successful reservation', async () => {
      db = new FakeDb([
        makeListing({
          provider_metadata: { healthMetrics: { out_of_stock_consecutive_failures: 4 } },
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', true);

      const meta = db.listings[0].provider_metadata as Record<string, unknown> | null;
      const health = meta?.healthMetrics as Record<string, unknown> | undefined;
      expect(health?.out_of_stock_consecutive_failures).toBe(0);
    });

    it('auto-pauses, pushes declared_stock=0, and fires a critical admin alert on the 5th consecutive out_of_stock', async () => {
      db = new FakeDb([
        makeListing({
          provider_metadata: { healthMetrics: { out_of_stock_consecutive_failures: 4 } },
        }),
      ]);
      const registry = new FakeRegistry();
      const service = makeService(db, registry);

      await service.updateHealthCounters('ext-1', 'reservation', false, 'out_of_stock');

      expect(db.listings[0].status).toBe('paused');
      expect(db.listings[0].declared_stock).toBe(0);
      expect(db.listings[0].error_message).toContain('5 consecutive out_of_stock');
      expect(registry.declareStockCalls).toEqual([
        { providerCode: 'eneba', externalId: 'ext-1', qty: 0 },
      ]);
      expect(db.alerts).toHaveLength(1);
      expect(db.alerts[0].alert_type).toBe('seller_out_of_stock_circuit_tripped');
      expect(db.alerts[0].severity).toBe('critical');
    });

    it('does not re-emit the OOS alert on a 6th consecutive out_of_stock (already paused)', async () => {
      db = new FakeDb([
        makeListing({
          status: 'paused',
          provider_metadata: { healthMetrics: { out_of_stock_consecutive_failures: 5 } },
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'reservation', false, 'out_of_stock');

      expect(db.alerts).toEqual([]);
    });
  });

  describe('healthy operation', () => {
    it('produces no alerts when neither prev nor new ratio reach the warning band', async () => {
      db = new FakeDb([
        makeListing({
          provision_success_count: 200,
          provision_failure_count: 1,
        }),
      ]);
      const service = makeService(db);

      await service.updateHealthCounters('ext-1', 'provision', false);

      expect(db.alerts).toEqual([]);
    });

    it('does nothing when the listing is missing', async () => {
      db = new FakeDb([]);
      const service = makeService(db);

      await service.updateHealthCounters('missing-listing', 'provision', false);

      expect(db.alerts).toEqual([]);
    });
  });
});
