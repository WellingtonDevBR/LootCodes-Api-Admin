import { describe, expect, it, vi } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { SupabaseAdminInventoryRepository } from '../src/infra/inventory/supabase-admin-inventory.repository.js';

// ---------------------------------------------------------------------------
// Minimal in-memory stub for IDatabase.
// queryAll returns rows from the fixture map, optionally filtered by eq[].
// batchedQuery is called via queryAll on sub-tables with in[] conditions.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface DbFixtures {
  product_variants: Row[];
  products: Row[];
  product_regions: Row[];
  product_keys_available: Row[];     // key_state = available
  product_keys_sold: Row[];          // is_used = true
  variant_platforms: Row[];
  provider_variant_offers: Row[];
  provider_accounts: Row[];
  seller_listings: Row[];
  product_platforms: Row[];
}

function makeDb(fixtures: DbFixtures): IDatabase {
  const filterVariants = (opts?: Record<string, unknown>): Row[] => {
    let rows: Row[] = [...fixtures.product_variants];
    const eqFilters: Array<[string, unknown]> = (opts?.eq as Array<[string, unknown]>) ?? [];
    const inFilters: Array<[string, unknown[]]> = (opts?.in as Array<[string, unknown[]]>) ?? [];
    for (const [col, vals] of inFilters) {
      rows = rows.filter(r => (vals as unknown[]).includes(r[col]));
    }
    for (const [col, val] of eqFilters) {
      rows = rows.filter(r => r[col] === val);
    }
    const rawOr = opts?.or as string | undefined;
    if (rawOr && typeof rawOr === 'string') {
      const skuMatch = rawOr.match(/sku\.ilike\.([^,]+)/);
      const pattern = skuMatch?.[1]?.toLowerCase() ?? '';
      const pidMatch = rawOr.match(/product_id\.in\.\(([^)]*)\)/);
      const inRaw = pidMatch?.[1] ?? '';
      const quotedIds = inRaw.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) ?? [];
      rows = rows.filter((r) => {
        const sku = String(r.sku ?? '').toLowerCase();
        const matchSku = pattern.length > 0 && sku.includes(pattern.replace(/%/g, ''));
        const matchPid = quotedIds.length > 0 && quotedIds.includes(String(r.product_id));
        return matchSku || matchPid;
      });
    }
    rows.sort((a, b) => {
      const ac = String(a.created_at ?? '');
      const bc = String(b.created_at ?? '');
      return bc.localeCompare(ac);
    });
    return rows;
  };

  const db = {
    queryAll: vi.fn((table: string, opts?: Record<string, unknown>) => {
      const eqFilters: Array<[string, unknown]> = (opts?.eq as Array<[string, unknown]>) ?? [];
      const inFilters: Array<[string, unknown[]]> = (opts?.in as Array<[string, unknown[]]>) ?? [];

      let rows: Row[];
      if (table === 'product_variants') rows = fixtures.product_variants;
      else if (table === 'products') rows = fixtures.products;
      else if (table === 'product_regions') rows = fixtures.product_regions;
      else if (table === 'variant_platforms') rows = fixtures.variant_platforms;
      else if (table === 'provider_accounts') rows = fixtures.provider_accounts;
      else if (table === 'product_platforms') rows = fixtures.product_platforms;
      else if (table === 'seller_listings') rows = fixtures.seller_listings;
      else if (table === 'provider_variant_offers') rows = fixtures.provider_variant_offers;
      else if (table === 'product_keys') {
        const keyStateFilter = eqFilters.find(([k]) => k === 'key_state');
        const isUsedFilter = eqFilters.find(([k]) => k === 'is_used');
        if (keyStateFilter?.[1] === 'available') rows = fixtures.product_keys_available;
        else if (isUsedFilter?.[1] === true) rows = fixtures.product_keys_sold;
        else rows = [...fixtures.product_keys_available, ...fixtures.product_keys_sold];
      } else {
        rows = [];
      }

      for (const [col, vals] of inFilters) {
        rows = rows.filter(r => (vals as unknown[]).includes(r[col]));
      }
      for (const [col, val] of eqFilters) {
        if (col !== 'key_state' && col !== 'is_used') {
          rows = rows.filter(r => r[col] === val);
        }
      }

      return Promise.resolve(rows);
    }),

    queryPaginated: vi.fn((table: string, opts?: Record<string, unknown>) => {
      if (table === 'product_variants') {
        const all = filterVariants(opts);
        const total = all.length;
        const range = opts?.range as [number, number] | undefined;
        let data = all;
        if (range) {
          const [from, to] = range;
          data = all.slice(from, to + 1);
        }
        return Promise.resolve({ data, total });
      }
      return Promise.resolve({ data: [], total: 0 });
    }),

    // query is used for product_platforms lookup in catalog
    query: vi.fn((table: string, opts?: Record<string, unknown>) => {
      const inFilters: Array<[string, unknown[]]> = (opts?.in as Array<[string, unknown[]]>) ?? [];
      const ilikeFilters: Array<[string, string]> = (opts?.ilike as Array<[string, string]>) ?? [];
      let rows: Row[];
      if (table === 'product_platforms') rows = fixtures.product_platforms;
      else if (table === 'provider_accounts') rows = fixtures.provider_accounts;
      else if (table === 'products') rows = fixtures.products;
      else rows = [];
      for (const [col, vals] of inFilters) {
        rows = rows.filter(r => (vals as unknown[]).includes(r[col]));
      }
      for (const [col, pat] of ilikeFilters) {
        const needle = pat.replace(/%/g, '').toLowerCase();
        rows = rows.filter((r) => {
          const v = String(r[col] ?? '').toLowerCase();
          return v.includes(needle);
        });
      }
      const lim = opts?.limit as number | undefined;
      if (typeof lim === 'number' && lim > 0) rows = rows.slice(0, lim);
      return Promise.resolve(rows);
    }),
  };

  // Attach all other IDatabase methods as no-op stubs to satisfy the interface
  return {
    ...db,
    queryOne: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue({}),
    insertMany: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue({}),
    upsertMany: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(0),
    rpc: vi.fn().mockResolvedValue({}),
    invokeFunction: vi.fn().mockResolvedValue({}),
    invokeInternalFunction: vi.fn().mockResolvedValue({}),
  } as unknown as IDatabase;
}

// ---------------------------------------------------------------------------
// Base fixtures — one variant with 5 physical keys and 50 declared stock on
// an active seller listing.  The declared stock MUST NOT inflate stock_available.
// ---------------------------------------------------------------------------

const VARIANT_ID = 'var-1';
const PRODUCT_ID = 'prod-1';
const REGION_ID  = 'reg-1';
const PA_ID_SUPPLIER = 'pa-supplier-1';   // buy provider (supports_purchase, not supports_seller)
const PA_ID_SELLER   = 'pa-seller-1';     // sell provider (supports_seller)

function baseFixtures(): DbFixtures {
  return {
    product_variants: [{
      id: VARIANT_ID,
      sku: 'SKU-001',
      price_usd: 3000,          // $30.00 retail — should NOT be used for stock value
      is_active: true,
      product_id: PRODUCT_ID,
      region_id: REGION_ID,
      default_cost_cents: null,
      default_cost_currency: null,
      face_value: 'Standard',
    }],
    products: [{ id: PRODUCT_ID, name: 'Test Game', category: 'AAA Games' }],
    product_regions: [{ id: REGION_ID, name: 'Global', code: 'GLOBAL' }],
    product_keys_available: [
      { variant_id: VARIANT_ID },
      { variant_id: VARIANT_ID },
      { variant_id: VARIANT_ID },
      { variant_id: VARIANT_ID },
      { variant_id: VARIANT_ID },
    ],
    product_keys_sold: [],
    variant_platforms: [],
    provider_variant_offers: [],
    provider_accounts: [
      { id: PA_ID_SUPPLIER, display_name: 'BuyProvider', supports_seller: false },
      { id: PA_ID_SELLER,   display_name: 'SellChannel', supports_seller: true },
    ],
    seller_listings: [{
      variant_id: VARIANT_ID,
      declared_stock: 50,        // 50 declared — must NOT count as owned stock
      provider_account_id: PA_ID_SELLER,
      status: 'active',
    }],
    product_platforms: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupabaseAdminInventoryRepository.getInventoryCatalog', () => {
  it('stock_available counts only physical keys, ignoring declared stock', async () => {
    const db = makeDb(baseFixtures());
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row).toBeDefined();
    // 5 physical keys, 50 declared stock → must report 5, never 50
    expect(row!.stock_available).toBe(5);
  });

  it('stock_available is 0 when the variant has only declared stock and no physical keys', async () => {
    const fixtures = baseFixtures();
    fixtures.product_keys_available = [];         // zero physical keys

    const db = makeDb(fixtures);
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row).toBeDefined();
    expect(row!.stock_available).toBe(0);
  });

  it('best_provider_cost_cents is the cheapest last_price_cents from active buy-provider offers', async () => {
    const fixtures = baseFixtures();
    fixtures.provider_variant_offers = [
      { variant_id: VARIANT_ID, provider_account_id: PA_ID_SUPPLIER, is_active: true,  last_price_cents: 1500, currency: 'USD' },
      { variant_id: VARIANT_ID, provider_account_id: 'pa-supplier-2', is_active: true,  last_price_cents: 1200, currency: 'USD' },
      { variant_id: VARIANT_ID, provider_account_id: 'pa-supplier-3', is_active: false, last_price_cents:  900, currency: 'USD' }, // inactive — must be excluded
    ];
    fixtures.provider_accounts = [
      ...fixtures.provider_accounts,
      { id: 'pa-supplier-2', display_name: 'CheaperProvider', supports_seller: false },
      { id: 'pa-supplier-3', display_name: 'InactiveProvider', supports_seller: false },
    ];

    const db = makeDb(fixtures);
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row).toBeDefined();
    // Cheapest ACTIVE offer is 1200 (pa-supplier-2); inactive 900 ignored
    expect(row!.best_provider_cost_cents).toBe(1200);
    expect(row!.best_provider_cost_currency).toBe('USD');
  });

  it('best_provider_cost_cents is null when no offers have a price', async () => {
    const fixtures = baseFixtures();
    fixtures.provider_variant_offers = [
      { variant_id: VARIANT_ID, provider_account_id: PA_ID_SUPPLIER, is_active: true, last_price_cents: null, currency: 'USD' },
    ];

    const db = makeDb(fixtures);
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row).toBeDefined();
    expect(row!.best_provider_cost_cents).toBeNull();
    expect(row!.best_provider_cost_currency).toBeNull();
  });

  it('total_declared_stock sums declared_stock across all active seller listings', async () => {
    const fixtures = baseFixtures();
    // Two active listings with declared stock for the same variant
    fixtures.seller_listings = [
      { variant_id: VARIANT_ID, declared_stock: 20, provider_account_id: PA_ID_SELLER,   status: 'active' },
      { variant_id: VARIANT_ID, declared_stock: 30, provider_account_id: 'pa-seller-2', status: 'active' },
    ];

    const db = makeDb(fixtures);
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row).toBeDefined();
    expect(row!.total_declared_stock).toBe(50); // 20 + 30
  });

  it('total_declared_stock is 0 when there are no seller listings', async () => {
    const fixtures = baseFixtures();
    fixtures.seller_listings = [];

    const db = makeDb(fixtures);
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row!.total_declared_stock).toBe(0);
  });

  it('best_provider_cost_cents is null when there are no provider offers at all', async () => {
    const fixtures = baseFixtures();
    fixtures.provider_variant_offers = [];

    const db = makeDb(fixtures);
    const repo = new SupabaseAdminInventoryRepository(db);

    const result = await repo.getInventoryCatalog({ limit: 100, offset: 0 });

    const row = result.rows.find(r => r.variant_id === VARIANT_ID);
    expect(row!.best_provider_cost_cents).toBeNull();
  });
});
