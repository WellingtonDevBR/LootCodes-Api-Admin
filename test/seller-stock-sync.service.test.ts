/**
 * Unit tests for `SellerStockSyncService.refreshOneListing`.
 *
 * Backs the manual "Sync Stock Now" button in the CRM. The previous
 * implementation in `SupabaseAdminSellerRepository.syncSellerStock`
 * had two bugs:
 *
 *   1. It counted only the variant's OWN keys, ignoring linked
 *      `variant_inventory_sources` (so a consumer variant with 0 own keys
 *      and 34 source keys was wrongly persisted as 0).
 *   2. It updated `seller_listings.declared_stock` in the DB but did NOT
 *      push the new quantity to the marketplace adapter, so Gamivo (and
 *      every other provider) never saw the change.
 *
 * These tests pin both invariants so the bug cannot regress.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { SellerStockSyncService } from '../src/infra/seller/pricing/seller-stock-sync.service.js';
import type { IDatabase, QueryOptions, PaginatedResult } from '../src/core/ports/database.port.js';
import type {
  IMarketplaceAdapterRegistry,
  ISellerDeclaredStockAdapter,
  ISellerListingAdapter,
  CreateListingParams,
  CreateListingResult,
  UpdateListingParams,
  UpdateListingResult,
  ListingStatusResult,
  DeclareStockResult,
  KeyProvisionParams,
  KeyProvisionResult,
} from '../src/core/ports/marketplace-adapter.port.js';
import type { IBuyerWalletSnapshotter, WalletSnapshot } from '../src/core/ports/buyer-wallet-snapshot.port.js';
import type { IProcurementFxConverter } from '../src/core/ports/procurement-fx-converter.port.js';
import { CreditAwareDeclaredStockSelectorUseCase } from '../src/core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';

// ─── Stubs ───────────────────────────────────────────────────────────

class StubDeclaredStockAdapter implements ISellerDeclaredStockAdapter {
  readonly calls: Array<{ externalListingId: string; quantity: number }> = [];
  constructor(private readonly succeeds = true) {}
  async declareStock(externalListingId: string, quantity: number): Promise<DeclareStockResult> {
    this.calls.push({ externalListingId, quantity });
    return { success: this.succeeds, declaredQuantity: quantity };
  }
  async provisionKeys(_p: KeyProvisionParams): Promise<KeyProvisionResult> {
    return { success: true, provisioned: 0 };
  }
  async cancelReservation(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

class StubListingAdapter implements ISellerListingAdapter {
  async createListing(_p: CreateListingParams): Promise<CreateListingResult> {
    return { externalListingId: '', status: 'active' };
  }
  async updateListing(_p: UpdateListingParams): Promise<UpdateListingResult> {
    return { success: true };
  }
  async deactivateListing(_id: string): Promise<{ success: boolean }> {
    return { success: true };
  }
  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    return { status: 'active', externalListingId };
  }
}

class StubRegistry implements IMarketplaceAdapterRegistry {
  constructor(
    readonly declared = new Map<string, ISellerDeclaredStockAdapter>(),
    readonly listing = new Map<string, ISellerListingAdapter>(),
  ) {}
  registerAdapter(): void { /* unused */ }
  getListingAdapter(c: string) { return this.listing.get(c) ?? null; }
  getKeyUploadAdapter() { return null; }
  getDeclaredStockAdapter(c: string) { return this.declared.get(c) ?? null; }
  getStockSyncAdapter() { return null; }
  getPricingAdapter() { return null; }
  getCompetitionAdapter() { return null; }
  getCallbackSetupAdapter() { return null; }
  getBatchPriceAdapter() { return null; }
  getBatchDeclaredStockAdapter() { return null; }
  getGlobalStockAdapter() { return null; }
  getProductSearchAdapter() { return null; }
  getKeyReconcileAdapter() { return null; }
  hasCapability() { return false; }
  getSupportedProviders(): string[] { return []; }
}

class NullSnapshotter implements IBuyerWalletSnapshotter {
  async snapshot(): Promise<WalletSnapshot> { return new Map(); }
}

class IdentityFxConverter implements IProcurementFxConverter {
  async toUsdCents(cents: number): Promise<number | null> { return cents; }
}

// ─── Fake DB ─────────────────────────────────────────────────────────

interface SellerListingFixture {
  id: string;
  variant_id: string;
  provider_account_id: string;
  external_listing_id: string;
  external_product_id: string | null;
  listing_type: string;
  status: string;
  declared_stock: number;
  auto_sync_stock_follows_provider: boolean;
  auto_sync_stock: boolean;
  currency: string;
  price_cents: number;
  min_price_cents: number;
  pricing_overrides: Record<string, unknown> | null;
}

interface ProviderAccountFixture {
  id: string;
  provider_code: string;
  seller_config: Record<string, unknown>;
}

class FakeDb implements IDatabase {
  readonly listings: SellerListingFixture[] = [];
  readonly providerAccounts: ProviderAccountFixture[] = [];
  readonly internalStockByVariant = new Map<string, number>();
  readonly updates: Array<{ table: string; filter: Record<string, unknown>; data: Record<string, unknown> }> = [];

  async query<T = unknown>(table: string, options?: QueryOptions): Promise<T[]> {
    if (table === 'seller_listings') {
      return this.listings.filter((l) => {
        for (const [k, v] of options?.eq ?? []) {
          if ((l as unknown as Record<string, unknown>)[k] !== v) return false;
        }
        for (const [k, v] of Object.entries(options?.filter ?? {})) {
          if ((l as unknown as Record<string, unknown>)[k] !== v) return false;
        }
        if (options?.in) {
          for (const [k, vs] of options.in) {
            if (!vs.includes((l as unknown as Record<string, unknown>)[k])) return false;
          }
        }
        return true;
      }) as unknown as T[];
    }
    if (table === 'provider_accounts') {
      if (options?.in) {
        const wanted = new Set<string>();
        for (const [k, vs] of options.in) {
          if (k === 'id') for (const v of vs) wanted.add(String(v));
        }
        return this.providerAccounts.filter((p) => wanted.has(p.id)) as unknown as T[];
      }
      return this.providerAccounts as unknown as T[];
    }
    return [];
  }

  async queryAll<T = unknown>(table: string, options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    return this.query<T>(table, options);
  }

  async queryOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    const rows = await this.query<T>(table, options);
    return rows[0] ?? null;
  }

  async queryPaginated<T = unknown>(_t: string): Promise<PaginatedResult<T>> {
    return { data: [], total: 0 };
  }
  async insert<T = unknown>(): Promise<T> { return {} as T; }
  async insertMany(): Promise<number> { return 0; }
  async update<T = unknown>(table: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T[]> {
    this.updates.push({ table, filter, data });
    const matched = this.listings.filter((l) => {
      for (const [k, v] of Object.entries(filter)) {
        if ((l as unknown as Record<string, unknown>)[k] !== v) return false;
      }
      return true;
    });
    for (const row of matched) {
      Object.assign(row as unknown as Record<string, unknown>, data);
    }
    return matched as unknown as T[];
  }
  async upsert<T = unknown>(): Promise<T> { return {} as T; }
  async upsertMany(): Promise<void> { /* noop */ }
  async delete(): Promise<number> { return 0; }
  async rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<T> {
    if (fn === 'get_batch_available_keys_count') {
      const variantIds = (params?.variant_uuids as string[] | undefined) ?? [];
      const out = variantIds.map((vid) => ({
        variant_id: vid,
        available_count: this.internalStockByVariant.get(vid) ?? 0,
      }));
      return out as unknown as T;
    }
    return null as unknown as T;
  }
  async invokeFunction<T = unknown>(): Promise<T> { return null as unknown as T; }
  async invokeInternalFunction<T = unknown>(): Promise<T> { return null as unknown as T; }
}

function makeListing(over: Partial<SellerListingFixture> = {}): SellerListingFixture {
  return {
    id: 'listing-gamivo-minecraft',
    variant_id: 'variant-minecraft',
    provider_account_id: 'acct-gamivo',
    external_listing_id: '3413543',
    external_product_id: '162234',
    listing_type: 'declared_stock',
    status: 'active',
    declared_stock: 0,
    auto_sync_stock_follows_provider: false,
    auto_sync_stock: true,
    currency: 'EUR',
    price_cents: 1593,
    min_price_cents: 0,
    pricing_overrides: null,
    ...over,
  };
}

function makeAccount(over: Partial<ProviderAccountFixture> = {}): ProviderAccountFixture {
  return {
    id: 'acct-gamivo',
    provider_code: 'gamivo',
    seller_config: { commission_rate_percent: 8, min_profit_margin_pct: 5, default_currency: 'EUR' },
    ...over,
  };
}

describe('SellerStockSyncService.refreshOneListing — manual sync from CRM "Sync Stock Now"', () => {
  let db: FakeDb;
  let snapshotter: NullSnapshotter;
  let registry: StubRegistry;
  let gamivoDeclared: StubDeclaredStockAdapter;
  let service: SellerStockSyncService;

  beforeEach(() => {
    db = new FakeDb();
    snapshotter = new NullSnapshotter();
    gamivoDeclared = new StubDeclaredStockAdapter();
    registry = new StubRegistry(
      new Map([['gamivo', gamivoDeclared]]),
      new Map([['gamivo', new StubListingAdapter()]]),
    );
    const fx = new IdentityFxConverter();
    const selector = new CreditAwareDeclaredStockSelectorUseCase();
    service = new SellerStockSyncService(db, registry, snapshotter, fx, selector);
  });

  it('pushes inventory-source-aware key count to the marketplace and persists declared_stock', async () => {
    db.providerAccounts.push(makeAccount());
    db.listings.push(makeListing());
    // 0 own keys + 34 source keys → RPC returns 34
    db.internalStockByVariant.set('variant-minecraft', 34);

    const result = await service.refreshOneListing('req-1', 'listing-gamivo-minecraft');

    expect(gamivoDeclared.calls).toEqual([
      { externalListingId: '3413543', quantity: 34 },
    ]);
    expect(result.listingsProcessed).toBe(1);
    expect(result.stockUpdated).toBe(1);
    expect(result.errors).toBe(0);

    const persisted = db.updates.find(
      (u) => u.table === 'seller_listings' && u.filter.id === 'listing-gamivo-minecraft',
    );
    expect(persisted?.data.declared_stock).toBe(34);
  });

  it('does not call the marketplace adapter when declared_stock already matches internal stock', async () => {
    db.providerAccounts.push(makeAccount());
    db.listings.push(makeListing({ declared_stock: 34 }));
    db.internalStockByVariant.set('variant-minecraft', 34);

    const result = await service.refreshOneListing('req-2', 'listing-gamivo-minecraft');

    expect(gamivoDeclared.calls).toHaveLength(0);
    expect(result.listingsProcessed).toBe(1);
    expect(result.stockUpdated).toBe(0);
  });

  it('returns 0 listingsProcessed when the listing id does not exist', async () => {
    const result = await service.refreshOneListing('req-3', 'missing-listing-id');

    expect(result).toEqual({ listingsProcessed: 0, stockUpdated: 0, errors: 0 });
    expect(gamivoDeclared.calls).toHaveLength(0);
  });

  it('returns 0 listingsProcessed when the listing has auto_sync_stock=false', async () => {
    db.providerAccounts.push(makeAccount());
    db.listings.push(makeListing({ auto_sync_stock: false }));
    db.internalStockByVariant.set('variant-minecraft', 34);

    const result = await service.refreshOneListing('req-4', 'listing-gamivo-minecraft');

    expect(result.listingsProcessed).toBe(0);
    expect(gamivoDeclared.calls).toHaveLength(0);
  });
});
