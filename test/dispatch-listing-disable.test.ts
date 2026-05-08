import { describe, expect, it, beforeEach } from 'vitest';
import { dispatchListingDisable } from '../src/infra/seller/dispatch-listing-disable.js';
import type {
  IMarketplaceAdapterRegistry,
  ISellerListingAdapter,
  ISellerDeclaredStockAdapter,
  CreateListingResult,
  CreateListingParams,
  UpdateListingParams,
  UpdateListingResult,
  ListingStatusResult,
  DeclareStockResult,
  KeyProvisionParams,
  KeyProvisionResult,
} from '../src/core/ports/marketplace-adapter.port.js';

interface DeactivateCall {
  readonly providerCode: string;
  readonly externalListingId: string;
}
interface DeclareStockCall {
  readonly providerCode: string;
  readonly externalListingId: string;
  readonly quantity: number;
}

class StubListingAdapter implements ISellerListingAdapter {
  readonly deactivateCalls: DeactivateCall[] = [];

  constructor(private readonly providerCode: string, private readonly succeeds = true) {}

  async createListing(_params: CreateListingParams): Promise<CreateListingResult> {
    return { externalListingId: '', status: 'active' };
  }
  async updateListing(_params: UpdateListingParams): Promise<UpdateListingResult> {
    return { success: true };
  }
  async deactivateListing(externalListingId: string): Promise<{ success: boolean }> {
    this.deactivateCalls.push({ providerCode: this.providerCode, externalListingId });
    return { success: this.succeeds };
  }
  async getListingStatus(externalListingId: string): Promise<ListingStatusResult> {
    return { status: 'active', externalListingId };
  }
}

class StubDeclaredStockAdapter implements ISellerDeclaredStockAdapter {
  readonly declareCalls: DeclareStockCall[] = [];
  constructor(private readonly providerCode: string, private readonly succeeds = true) {}

  async declareStock(externalListingId: string, quantity: number): Promise<DeclareStockResult> {
    this.declareCalls.push({ providerCode: this.providerCode, externalListingId, quantity });
    return { success: this.succeeds, declaredQuantity: quantity };
  }
  async provisionKeys(_params: KeyProvisionParams): Promise<KeyProvisionResult> {
    return { success: true, provisioned: 0 };
  }
  async cancelReservation(): Promise<{ success: boolean }> {
    return { success: true };
  }
}

class StubRegistry implements IMarketplaceAdapterRegistry {
  constructor(
    private readonly listingByCode: Map<string, ISellerListingAdapter> = new Map(),
    private readonly declaredByCode: Map<string, ISellerDeclaredStockAdapter> = new Map(),
  ) {}
  registerAdapter(): void { /* unused */ }
  getListingAdapter(providerCode: string): ISellerListingAdapter | null {
    return this.listingByCode.get(providerCode) ?? null;
  }
  getKeyUploadAdapter() { return null; }
  getDeclaredStockAdapter(providerCode: string): ISellerDeclaredStockAdapter | null {
    return this.declaredByCode.get(providerCode) ?? null;
  }
  getStockSyncAdapter() { return null; }
  getPricingAdapter() { return null; }
  getCompetitionAdapter() { return null; }
  getCallbackSetupAdapter() { return null; }
  getBatchPriceAdapter() { return null; }
  getBatchDeclaredStockAdapter() { return null; }
  getGlobalStockAdapter() { return null; }
  getProductSearchAdapter() { return null; }
  hasCapability() { return false; }
  getSupportedProviders(): string[] { return []; }
}

describe('dispatchListingDisable', () => {
  let kinguinListing: StubListingAdapter;
  let kinguinDeclared: StubDeclaredStockAdapter;
  let enebaDeclared: StubDeclaredStockAdapter;
  let g2aDeclared: StubDeclaredStockAdapter;
  let gamivoDeclared: StubDeclaredStockAdapter;
  let digisellerDeclared: StubDeclaredStockAdapter;
  let registry: StubRegistry;

  beforeEach(() => {
    kinguinListing = new StubListingAdapter('kinguin');
    kinguinDeclared = new StubDeclaredStockAdapter('kinguin');
    enebaDeclared = new StubDeclaredStockAdapter('eneba');
    g2aDeclared = new StubDeclaredStockAdapter('g2a');
    gamivoDeclared = new StubDeclaredStockAdapter('gamivo');
    digisellerDeclared = new StubDeclaredStockAdapter('digiseller');
    registry = new StubRegistry(
      new Map([['kinguin', kinguinListing]]),
      new Map([
        ['kinguin', kinguinDeclared],
        ['eneba', enebaDeclared],
        ['g2a', g2aDeclared],
        ['gamivo', gamivoDeclared],
        ['digiseller', digisellerDeclared],
      ]),
    );
  });

  it('Kinguin: calls deactivateListing — NOT declareStock(0)', async () => {
    const r = await dispatchListingDisable(registry, 'kinguin', 'offer-123');

    expect(r.success).toBe(true);
    expect(r.action).toBe('deactivate_listing');
    expect(kinguinListing.deactivateCalls).toEqual([
      { providerCode: 'kinguin', externalListingId: 'offer-123' },
    ]);
    expect(kinguinDeclared.declareCalls).toHaveLength(0);
  });

  it('Eneba: calls declareStock(id, 0) (adapter then maps qty=0 → declaredStock=null)', async () => {
    const r = await dispatchListingDisable(registry, 'eneba', 'auction-eneba-1');

    expect(r.success).toBe(true);
    expect(r.action).toBe('declare_stock_zero');
    expect(enebaDeclared.declareCalls).toEqual([
      { providerCode: 'eneba', externalListingId: 'auction-eneba-1', quantity: 0 },
    ]);
  });

  it('G2A: calls declareStock(id, 0)', async () => {
    const r = await dispatchListingDisable(registry, 'g2a', 'g2a-offer-1');

    expect(r.success).toBe(true);
    expect(r.action).toBe('declare_stock_zero');
    expect(g2aDeclared.declareCalls).toEqual([
      { providerCode: 'g2a', externalListingId: 'g2a-offer-1', quantity: 0 },
    ]);
  });

  it('Gamivo: calls declareStock(id, 0)', async () => {
    const r = await dispatchListingDisable(registry, 'gamivo', 'gamivo-offer-1');

    expect(r.success).toBe(true);
    expect(r.action).toBe('declare_stock_zero');
    expect(gamivoDeclared.declareCalls).toEqual([
      { providerCode: 'gamivo', externalListingId: 'gamivo-offer-1', quantity: 0 },
    ]);
  });

  it('Digiseller: calls declareStock(id, 0)', async () => {
    const r = await dispatchListingDisable(registry, 'digiseller', 'product-1');

    expect(r.success).toBe(true);
    expect(r.action).toBe('declare_stock_zero');
    expect(digisellerDeclared.declareCalls).toEqual([
      { providerCode: 'digiseller', externalListingId: 'product-1', quantity: 0 },
    ]);
  });

  it('returns success=false with explanatory error when Kinguin listing adapter is missing', async () => {
    const empty = new StubRegistry(); // no kinguin adapter at all
    const r = await dispatchListingDisable(empty, 'kinguin', 'offer-123');

    expect(r.success).toBe(false);
    expect(r.action).toBe('deactivate_listing');
    expect(r.error).toMatch(/Kinguin/);
  });

  it('returns success=false when no declared-stock adapter for non-Kinguin provider', async () => {
    const empty = new StubRegistry();
    const r = await dispatchListingDisable(empty, 'eneba', 'auction-1');

    expect(r.success).toBe(false);
    expect(r.action).toBe('declare_stock_zero');
    expect(r.error).toMatch(/eneba/);
  });

  it('case-insensitive provider code matching (KINGUIN works the same as kinguin)', async () => {
    const r = await dispatchListingDisable(registry, 'KINGUIN', 'offer-123');

    expect(r.success).toBe(true);
    expect(r.action).toBe('deactivate_listing');
    expect(kinguinListing.deactivateCalls).toHaveLength(1);
  });
});
