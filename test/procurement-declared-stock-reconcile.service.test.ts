/**
 * Integration test for `ProcurementDeclaredStockReconcileService`.
 *
 * Verifies the two structural invariants from the credit-gated declared-stock
 * plan that cannot be checked by pure unit tests on the selector alone:
 *
 *   1. The wallet snapshotter is invoked EXACTLY ONCE per `execute()` call,
 *      regardless of how many listings the run processes — i.e. we never
 *      fan out N×M live wallet calls.
 *
 *   2. The per-marketplace "stop selling" dispatch routes correctly:
 *        - Kinguin → `ISellerListingAdapter.deactivateListing`
 *        - Eneba / G2A / Gamivo / Digiseller → `ISellerDeclaredStockAdapter.declareStock(id, 0)`
 *
 *   3. When a listing has a credited buyer, `declareStock(id, qty)` is called
 *      on the marketplace adapter (not the disable path).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { ProcurementDeclaredStockReconcileService } from '../src/infra/seller/procurement-declared-stock-reconcile.service.js';
import type { IDatabase, QueryOptions, PaginatedResult } from '../src/core/ports/database.port.js';
import type {
  IMarketplaceAdapterRegistry,
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  ISellerPricingAdapter,
  CreateListingResult,
  CreateListingParams,
  UpdateListingParams,
  UpdateListingResult,
  ListingStatusResult,
  DeclareStockResult,
  KeyProvisionParams,
  KeyProvisionResult,
  PricingContext,
  SellerPayoutResult,
} from '../src/core/ports/marketplace-adapter.port.js';
import type { IBuyerWalletSnapshotter, WalletSnapshot } from '../src/core/ports/buyer-wallet-snapshot.port.js';
import type { IProcurementFxConverter } from '../src/core/ports/procurement-fx-converter.port.js';
import { CreditAwareDeclaredStockSelectorUseCase } from '../src/core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';

// ─── Stub adapters ───────────────────────────────────────────────────

class StubListingAdapter implements ISellerListingAdapter {
  readonly deactivateCalls: string[] = [];
  constructor(private readonly succeeds = true) {}
  async createListing(_p: CreateListingParams): Promise<CreateListingResult> {
    return { externalListingId: '', status: 'active' };
  }
  async updateListing(_p: UpdateListingParams): Promise<UpdateListingResult> {
    return { success: true };
  }
  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    this.deactivateCalls.push(externalListingId);
    return { success: this.succeeds };
  }
  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    return { status: 'active', externalListingId };
  }
}

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

class StubPricingAdapter implements ISellerPricingAdapter {
  readonly calls: PricingContext[] = [];
  constructor(
    private readonly handler: (ctx: PricingContext) => SellerPayoutResult | Promise<SellerPayoutResult>,
  ) {}
  async calculateNetPayout(ctx: PricingContext): Promise<SellerPayoutResult> {
    this.calls.push(ctx);
    return this.handler(ctx);
  }
}

class StubRegistry implements IMarketplaceAdapterRegistry {
  constructor(
    readonly listingByCode: Map<string, ISellerListingAdapter> = new Map(),
    readonly declaredByCode: Map<string, ISellerDeclaredStockAdapter> = new Map(),
    readonly pricingByCode: Map<string, ISellerPricingAdapter> = new Map(),
  ) {}
  registerAdapter(): void { /* unused */ }
  getListingAdapter(c: string) { return this.listingByCode.get(c) ?? null; }
  getKeyUploadAdapter() { return null; }
  getDeclaredStockAdapter(c: string) { return this.declaredByCode.get(c) ?? null; }
  getStockSyncAdapter() { return null; }
  getPricingAdapter(c: string) { return this.pricingByCode.get(c) ?? null; }
  getCompetitionAdapter() { return null; }
  getCallbackSetupAdapter() { return null; }
  getBatchPriceAdapter() { return null; }
  getBatchDeclaredStockAdapter() { return null; }
  getGlobalStockAdapter() { return null; }
  getProductSearchAdapter() { return null; }
  hasCapability() { return false; }
  getSupportedProviders(): string[] { return []; }
}

class CountingWalletSnapshotter implements IBuyerWalletSnapshotter {
  callCount = 0;
  constructor(private readonly result: WalletSnapshot) {}
  async snapshot(): Promise<WalletSnapshot> {
    this.callCount++;
    return this.result;
  }
}

class IdentityFxConverter implements IProcurementFxConverter {
  async toUsdCents(cents: number, _from: string): Promise<number | null> {
    return cents;
  }
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

interface ProviderVariantOfferFixture {
  id: string;
  variant_id: string;
  provider_account_id: string;
  currency: string;
  last_price_cents: number;
  available_quantity: number;
  prioritize_quote_sync: boolean;
  is_active: boolean;
}

interface BuyerProviderAccountFixture {
  id: string;
  provider_code: string;
  is_enabled: boolean;
  supports_seller: boolean;
}

class FakeDb implements IDatabase {
  readonly listings: SellerListingFixture[] = [];
  readonly providerAccounts: ProviderAccountFixture[] = [];
  readonly buyerAccounts: BuyerProviderAccountFixture[] = [];
  readonly offers: ProviderVariantOfferFixture[] = [];
  readonly internalStockByVariant = new Map<string, number>();
  readonly updates: Array<{ table: string; filter: Record<string, unknown>; data: Record<string, unknown> }> = [];

  async query<T = unknown>(table: string, options?: QueryOptions): Promise<T[]> {
    if (table === 'seller_listings') {
      return this.listings.filter((l) => {
        for (const [k, v] of options?.eq ?? []) {
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
      const select = options?.select ?? '';
      // load-procurement-offer-supply.ts queries: id, provider_code, is_enabled, supports_seller
      if (select.includes('is_enabled')) {
        return this.buyerAccounts as unknown as T[];
      }
      // reconcile loads: id, provider_code, seller_config
      if (options?.in) {
        const wanted = new Set<string>();
        for (const [k, vs] of options.in) {
          if (k === 'id') for (const v of vs) wanted.add(String(v));
        }
        return this.providerAccounts.filter((p) => wanted.has(p.id)) as unknown as T[];
      }
      return this.providerAccounts as unknown as T[];
    }
    if (table === 'provider_variant_offers') {
      return this.offers.filter((o) => {
        if (!o.is_active) return false;
        if (options?.in) {
          for (const [k, vs] of options.in) {
            if (!vs.includes((o as unknown as Record<string, unknown>)[k])) return false;
          }
        }
        return true;
      }) as unknown as T[];
    }
    return [];
  }

  async queryAll<T = unknown>(table: string, options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    return this.query<T>(table, options);
  }

  async queryOne<T = unknown>(_t: string, _o?: QueryOptions): Promise<T | null> {
    return null;
  }

  async queryPaginated<T = unknown>(_t: string, _o?: QueryOptions): Promise<PaginatedResult<T>> {
    return { data: [], total: 0 };
  }

  async insert<T = unknown>(_t: string, _d: Record<string, unknown>): Promise<T> {
    return {} as T;
  }
  async insertMany(): Promise<number> { return 0; }

  async update<T = unknown>(table: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T[]> {
    this.updates.push({ table, filter, data });
    return [];
  }

  async upsert<T = unknown>(_t: string, _d: Record<string, unknown>): Promise<T> {
    return {} as T;
  }
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

// ─── Helpers ─────────────────────────────────────────────────────────

function makeListing(over: Partial<SellerListingFixture>): SellerListingFixture {
  return {
    id: 'listing-1',
    variant_id: 'variant-1',
    provider_account_id: 'acct-eneba',
    external_listing_id: 'ext-1',
    external_product_id: null,
    listing_type: 'declared_stock',
    status: 'active',
    declared_stock: 5,
    auto_sync_stock_follows_provider: true,
    auto_sync_stock: true,
    currency: 'USD',
    price_cents: 1500,
    min_price_cents: 800,
    pricing_overrides: null,
    ...over,
  };
}

function makeAccount(over: Partial<ProviderAccountFixture>): ProviderAccountFixture {
  return {
    id: 'acct-eneba',
    provider_code: 'eneba',
    seller_config: { commission_rate_percent: 10, min_profit_margin_pct: 5 },
    ...over,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('ProcurementDeclaredStockReconcileService — credit-gated flow', () => {
  let db: FakeDb;
  let snapshotter: CountingWalletSnapshotter;
  let kinguinListing: StubListingAdapter;
  let kinguinDeclared: StubDeclaredStockAdapter;
  let enebaDeclared: StubDeclaredStockAdapter;
  let g2aDeclared: StubDeclaredStockAdapter;
  let gamivoDeclared: StubDeclaredStockAdapter;
  let digisellerDeclared: StubDeclaredStockAdapter;
  let registry: StubRegistry;
  let service: ProcurementDeclaredStockReconcileService;

  beforeEach(() => {
    db = new FakeDb();
    snapshotter = new CountingWalletSnapshotter(new Map());

    kinguinListing = new StubListingAdapter();
    kinguinDeclared = new StubDeclaredStockAdapter();
    enebaDeclared = new StubDeclaredStockAdapter();
    g2aDeclared = new StubDeclaredStockAdapter();
    gamivoDeclared = new StubDeclaredStockAdapter();
    digisellerDeclared = new StubDeclaredStockAdapter();

    registry = new StubRegistry(
      new Map([['kinguin', kinguinListing]]),
      new Map<string, ISellerDeclaredStockAdapter>([
        ['kinguin', kinguinDeclared],
        ['eneba', enebaDeclared],
        ['g2a', g2aDeclared],
        ['gamivo', gamivoDeclared],
        ['digiseller', digisellerDeclared],
      ]),
    );

    const fx = new IdentityFxConverter();
    const selector = new CreditAwareDeclaredStockSelectorUseCase(fx);
    service = new ProcurementDeclaredStockReconcileService(db, registry, snapshotter, fx, selector);
  });

  it('snapshots the wallet exactly once per run regardless of how many listings are processed', async () => {
    db.providerAccounts.push(
      makeAccount({ id: 'acct-eneba', provider_code: 'eneba' }),
      makeAccount({ id: 'acct-g2a', provider_code: 'g2a' }),
      makeAccount({ id: 'acct-gamivo', provider_code: 'gamivo' }),
    );

    db.listings.push(
      makeListing({ id: 'l1', variant_id: 'v1', provider_account_id: 'acct-eneba', external_listing_id: 'eneba-1' }),
      makeListing({ id: 'l2', variant_id: 'v2', provider_account_id: 'acct-g2a', external_listing_id: 'g2a-1' }),
      makeListing({ id: 'l3', variant_id: 'v3', provider_account_id: 'acct-gamivo', external_listing_id: 'gam-1' }),
    );

    const result = await service.execute('req-1', {});

    expect(snapshotter.callCount).toBe(1);
    expect(result.scanned).toBe(3);
  });

  it('routes Kinguin disable through deactivateListing — never declareStock(0)', async () => {
    db.providerAccounts.push(makeAccount({ id: 'acct-kinguin', provider_code: 'kinguin' }));
    db.listings.push(
      makeListing({
        id: 'l-kin', variant_id: 'v-kin', provider_account_id: 'acct-kinguin',
        external_listing_id: 'kin-1',
      }),
    );
    // No offers → no_offer disable.

    await service.execute('req-2', {});

    expect(kinguinListing.deactivateCalls).toEqual(['kin-1']);
    expect(kinguinDeclared.calls).toHaveLength(0);
  });

  it.each([
    ['eneba', () => enebaDeclared],
    ['g2a', () => g2aDeclared],
    ['gamivo', () => gamivoDeclared],
    ['digiseller', () => digisellerDeclared],
  ])('routes %s disable through declareStock(id, 0)', async (code, getAdapter) => {
    db.providerAccounts.push(makeAccount({ id: `acct-${code}`, provider_code: code }));
    db.listings.push(
      makeListing({
        id: `l-${code}`, variant_id: `v-${code}`, provider_account_id: `acct-${code}`,
        external_listing_id: `${code}-ext`,
      }),
    );

    await service.execute(`req-${code}`, {});

    expect(getAdapter().calls).toEqual([{ externalListingId: `${code}-ext`, quantity: 0 }]);
  });

  it('declares stock from credited buyer when wallet has credit and offer is economic', async () => {
    db.providerAccounts.push(makeAccount({ id: 'acct-eneba', provider_code: 'eneba' }));
    db.buyerAccounts.push({
      id: 'acct-bamboo', provider_code: 'bamboo', is_enabled: true, supports_seller: false,
    });

    db.listings.push(
      makeListing({
        id: 'l-d',
        variant_id: 'v-d',
        provider_account_id: 'acct-eneba',
        external_listing_id: 'eneba-deal',
        price_cents: 2000,
        currency: 'USD',
      }),
    );

    db.offers.push({
      id: 'offer-1',
      variant_id: 'v-d',
      provider_account_id: 'acct-bamboo',
      currency: 'USD',
      last_price_cents: 800,
      available_quantity: 10,
      prioritize_quote_sync: false,
      is_active: true,
    });

    snapshotter = new CountingWalletSnapshotter(
      new Map([['acct-bamboo', new Map([['USD', 100_000]])]]),
    );
    const fx = new IdentityFxConverter();
    const selector = new CreditAwareDeclaredStockSelectorUseCase(fx);
    service = new ProcurementDeclaredStockReconcileService(db, registry, snapshotter, fx, selector);

    const result = await service.execute('req-3', {});

    expect(result.updated).toBe(1);
    expect(enebaDeclared.calls).toHaveLength(1);
    expect(enebaDeclared.calls[0].externalListingId).toBe('eneba-deal');
    expect(enebaDeclared.calls[0].quantity).toBeGreaterThan(0);
  });

  it('persists `error_message=no_offer` on the listing when no buyer-capable offers exist', async () => {
    db.providerAccounts.push(makeAccount({ id: 'acct-eneba', provider_code: 'eneba' }));
    db.listings.push(
      makeListing({ id: 'l-no-offer', variant_id: 'v-x', external_listing_id: 'eneba-x' }),
    );

    await service.execute('req-4', {});

    const errorUpdates = db.updates.filter(
      (u) => u.table === 'seller_listings'
        && u.filter.id === 'l-no-offer'
        && u.data.error_message === 'no_offer',
    );
    expect(errorUpdates).toHaveLength(1);
    expect(errorUpdates[0].data.declared_stock).toBe(0);
  });

  /**
   * The marketplace's own fee calculator (Eneba `S_calculatePrice`, G2A
   * `/v3/pricing/simulations`, etc.) is the authoritative answer for what
   * the seller actually receives after fees. The reconcile service MUST
   * consult the live calculator when an `ISellerPricingAdapter` is registered
   * for the provider, and feed the result into the selector via
   * `netPayoutUsdCents` — bypassing the manual `commission_rate_percent +
   * fixed_fee_cents` config.
   */
  it('calls the live marketplace pricing adapter and uses its netPayout to gate the selector', async () => {
    db.providerAccounts.push(
      makeAccount({
        id: 'acct-eneba',
        provider_code: 'eneba',
        // Stale config — selector would let buyer through if this were used
        seller_config: {
          commission_rate_percent: 0,
          fixed_fee_cents: 0,
          min_profit_margin_pct: 1,
        },
      }),
    );
    db.buyerAccounts.push({
      id: 'acct-bamboo', provider_code: 'bamboo', is_enabled: true, supports_seller: false,
    });

    db.listings.push(
      makeListing({
        id: 'l-mc',
        variant_id: 'v-mc',
        provider_account_id: 'acct-eneba',
        external_listing_id: 'eneba-mc',
        external_product_id: '78086f2a-d485-11ee-aead-b2de3de418b4', // Eneba product UUID
        currency: 'USD',
        price_cents: 1_786, // $17.86 ≈ €15.18
      }),
    );

    db.offers.push({
      id: 'offer-bamboo',
      variant_id: 'v-mc',
      provider_account_id: 'acct-bamboo',
      currency: 'USD',
      last_price_cents: 1_700, // would pass stale ceiling, fails authoritative
      available_quantity: 10,
      prioritize_quote_sync: false,
      is_active: true,
    });

    snapshotter = new CountingWalletSnapshotter(
      new Map([['acct-bamboo', new Map([['USD', 1_000_000]])]]),
    );

    // Eneba's S_calculatePrice for €15.18 returns priceWithoutCommission=€14.02.
    // In USD-cents (identity FX): netPayoutCents=1_649.
    const enebaPricing = new StubPricingAdapter(() => ({
      grossPriceCents: 1_786,
      feeCents: 137,
      netPayoutCents: 1_649,
    }));
    registry = new StubRegistry(
      new Map(),
      new Map<string, ISellerDeclaredStockAdapter>([['eneba', enebaDeclared]]),
      new Map<string, ISellerPricingAdapter>([['eneba', enebaPricing]]),
    );

    const fx = new IdentityFxConverter();
    const selector = new CreditAwareDeclaredStockSelectorUseCase(fx);
    service = new ProcurementDeclaredStockReconcileService(db, registry, snapshotter, fx, selector);

    await service.execute('req-pricing-eneba', {});

    expect(enebaPricing.calls).toHaveLength(1);
    expect(enebaPricing.calls[0]).toMatchObject({
      priceCents: 1_786,
      currency: 'USD',
      externalListingId: 'eneba-mc',
      externalProductId: '78086f2a-d485-11ee-aead-b2de3de418b4',
    });

    // Buyer at $17 breaks the authoritative ceiling 1_649*0.99=1_632 →
    // selector returns 'uneconomic' → reconcile dispatches declareStock(id, 0).
    expect(enebaDeclared.calls).toEqual([{ externalListingId: 'eneba-mc', quantity: 0 }]);
  });

  it('falls back to manual config math when no pricing adapter is registered (e.g. Digiseller)', async () => {
    db.providerAccounts.push(
      makeAccount({
        id: 'acct-digiseller',
        provider_code: 'digiseller',
        seller_config: {
          commission_rate_percent: 6,
          fixed_fee_cents: 0,
          min_profit_margin_pct: 1,
        },
      }),
    );
    db.buyerAccounts.push({
      id: 'acct-bamboo', provider_code: 'bamboo', is_enabled: true, supports_seller: false,
    });

    db.listings.push(
      makeListing({
        id: 'l-ds',
        variant_id: 'v-ds',
        provider_account_id: 'acct-digiseller',
        external_listing_id: 'ds-1',
        currency: 'USD',
        price_cents: 1_786,
      }),
    );
    db.offers.push({
      id: 'offer-ds-bamboo',
      variant_id: 'v-ds',
      provider_account_id: 'acct-bamboo',
      currency: 'USD',
      last_price_cents: 1_500, // economic under 6%/1% ceiling
      available_quantity: 5,
      prioritize_quote_sync: false,
      is_active: true,
    });

    snapshotter = new CountingWalletSnapshotter(
      new Map([['acct-bamboo', new Map([['USD', 1_000_000]])]]),
    );
    // No pricing adapter registered for digiseller — registry default returns null.
    const fx = new IdentityFxConverter();
    const selector = new CreditAwareDeclaredStockSelectorUseCase(fx);
    service = new ProcurementDeclaredStockReconcileService(db, registry, snapshotter, fx, selector);

    await service.execute('req-ds', {});

    // Selector ran on manual config; buyer at $15 cleared the ceiling.
    expect(digisellerDeclared.calls).toHaveLength(1);
    expect(digisellerDeclared.calls[0].quantity).toBeGreaterThan(0);
  });

  it('falls back to manual config math when the live pricing call throws', async () => {
    db.providerAccounts.push(
      makeAccount({
        id: 'acct-eneba',
        provider_code: 'eneba',
        seller_config: {
          commission_rate_percent: 6,
          fixed_fee_cents: 0,
          min_profit_margin_pct: 1,
        },
      }),
    );
    db.buyerAccounts.push({
      id: 'acct-bamboo', provider_code: 'bamboo', is_enabled: true, supports_seller: false,
    });

    db.listings.push(
      makeListing({
        id: 'l-fail',
        variant_id: 'v-fail',
        provider_account_id: 'acct-eneba',
        external_listing_id: 'eneba-fail',
        external_product_id: 'product-uuid',
        currency: 'USD',
        price_cents: 1_786,
      }),
    );
    db.offers.push({
      id: 'offer-fail-bamboo',
      variant_id: 'v-fail',
      provider_account_id: 'acct-bamboo',
      currency: 'USD',
      last_price_cents: 1_500,
      available_quantity: 5,
      prioritize_quote_sync: false,
      is_active: true,
    });

    snapshotter = new CountingWalletSnapshotter(
      new Map([['acct-bamboo', new Map([['USD', 1_000_000]])]]),
    );
    const enebaPricing = new StubPricingAdapter(() => {
      throw new Error('Eneba GraphQL error: Too Many Requests');
    });
    registry = new StubRegistry(
      new Map(),
      new Map<string, ISellerDeclaredStockAdapter>([['eneba', enebaDeclared]]),
      new Map<string, ISellerPricingAdapter>([['eneba', enebaPricing]]),
    );
    const fx = new IdentityFxConverter();
    const selector = new CreditAwareDeclaredStockSelectorUseCase(fx);
    service = new ProcurementDeclaredStockReconcileService(db, registry, snapshotter, fx, selector);

    await service.execute('req-fail', {});

    expect(enebaPricing.calls).toHaveLength(1);
    // Manual config kicked in: 1786*0.94*0.99 = 1662 → buyer at 1500 cleared.
    expect(enebaDeclared.calls).toHaveLength(1);
    expect(enebaDeclared.calls[0].quantity).toBeGreaterThan(0);
  });
});
