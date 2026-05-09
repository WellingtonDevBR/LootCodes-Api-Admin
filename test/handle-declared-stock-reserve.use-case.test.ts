/**
 * Regression suite for `HandleDeclaredStockReserveUseCase`.
 *
 * Pins the Sentry-noise behavior fixed for production issues
 * `LOOTCODES-API-R / -S / -T` — every "RESERVE returned success:false" path
 * that is a normal business outcome (paused listing, stock racing the cron,
 * no buyer-capable provider) must NOT page Sentry. Only `unexpected_error`
 * is allowed to escalate.
 *
 * The first test below replays the exact Eneba payload from the production
 * trace at 2026-05-08T23:34:17Z (auctionId `b1259882-4af3-11f1-8bc7-…`,
 * orderId `48a08932-4b36-11f1-…`) where the user-controlled marketplace
 * listing was in `status='paused'`. That request had previously emitted
 * three Sentry events for one expected event; after the fix it must emit
 * zero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { HandleDeclaredStockReserveUseCase } from '../src/core/use-cases/seller-webhook/eneba/handle-declared-stock-reserve.use-case.js';
import type {
  IDatabase,
  QueryOptions,
  PaginatedResult,
} from '../src/core/ports/database.port.js';
import type {
  ISellerKeyOperationsPort,
  ClaimKeysParams,
  ClaimKeysResult,
  ProvisionResult,
  DecryptPendingResult,
  DecryptedKey,
  CompleteProvisionParams,
  PostProvisionReturnParams,
} from '../src/core/ports/seller-key-operations.port.js';
import type {
  ISellerDomainEventPort,
  EmitSellerEventParams,
  EmitInventoryStockChangedParams,
} from '../src/core/ports/seller-domain-event.port.js';
import type {
  IListingHealthPort,
  CallbackType,
} from '../src/core/ports/seller-listing-health.port.js';
import type {
  IVariantUnavailabilityPort,
  PropagationResult,
  UnavailabilityReason,
} from '../src/core/ports/variant-unavailability.port.js';
import type {
  DeclaredStockReserveDto,
  EnebaAuctionPayload,
  ListingRow,
} from '../src/core/use-cases/seller-webhook/seller-webhook.types.js';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Stubs ───────────────────────────────────────────────────────────

class StubDatabase implements IDatabase {
  constructor(private readonly listing: ListingRow | null) {}

  async query<T = unknown>(table: string, _options?: QueryOptions): Promise<T[]> {
    if (table === 'seller_stock_reservations') return [] as T[];
    return [] as T[];
  }

  async queryOne<T = unknown>(table: string, _options?: QueryOptions): Promise<T | null> {
    if (table === 'seller_listings') return this.listing as unknown as T | null;
    if (table === 'product_variants') return { product_id: 'product-1' } as unknown as T;
    return null;
  }

  async queryAll<T = unknown>(_t: string, _o?: QueryOptions): Promise<T[]> { return []; }
  async queryPaginated<T = unknown>(_t: string, _o?: QueryOptions): Promise<PaginatedResult<T>> {
    return { data: [], total: 0 };
  }
  async insert<T = unknown>(_t: string, _d: Record<string, unknown>): Promise<T> { return {} as T; }
  async insertMany(): Promise<number> { return 0; }
  async update<T = unknown>(): Promise<T[]> { return []; }
  async upsert<T = unknown>(): Promise<T> { return {} as T; }
  async upsertMany(): Promise<void> { /* noop */ }
  async delete(): Promise<number> { return 0; }
  async rpc<T = unknown>(): Promise<T> { return null as T; }
  async invokeFunction<T = unknown>(): Promise<T> { return null as T; }
  async invokeInternalFunction<T = unknown>(): Promise<T> { return null as T; }
}

class StubKeyOps implements ISellerKeyOperationsPort {
  claimCalls: ClaimKeysParams[] = [];
  claimResult: ClaimKeysResult | Error = new Error('claim_and_reserve_atomic failed: INSUFFICIENT_STOCK: need 1, got 0');

  async claimKeysForReservation(params: ClaimKeysParams): Promise<ClaimKeysResult> {
    this.claimCalls.push(params);
    if (this.claimResult instanceof Error) throw this.claimResult;
    return this.claimResult;
  }
  async provisionFromPendingKeys(): Promise<ProvisionResult> {
    return { keyIds: [], decryptedKeys: [] };
  }
  async decryptPendingWithoutFinalize(): Promise<DecryptPendingResult> {
    return { keyIds: [], provisionIds: [], decryptedKeys: [], keyFormats: [] };
  }
  async finalizeProvisions(): Promise<void> { /* noop */ }
  async decryptDeliveredProvisionKeys(): Promise<{ decryptedKeys: DecryptedKey[] }> {
    return { decryptedKeys: [] };
  }
  async completeProvisionOrchestration(_p: CompleteProvisionParams): Promise<void> { /* noop */ }
  async releaseReservationKeys(): Promise<number> { return 0; }
  async handlePostProvisionReturn(_p: PostProvisionReturnParams): Promise<number> { return 0; }
}

class StubEvents implements ISellerDomainEventPort {
  sellerEvents: EmitSellerEventParams[] = [];
  stockChanged: EmitInventoryStockChangedParams[] = [];
  async emitSellerEvent(p: EmitSellerEventParams): Promise<boolean> {
    this.sellerEvents.push(p);
    return true;
  }
  async emitInventoryStockChanged(p: EmitInventoryStockChangedParams): Promise<void> {
    this.stockChanged.push(p);
  }
}

class StubHealth implements IListingHealthPort {
  calls: Array<{ id: string; type: CallbackType; success: boolean }> = [];
  async updateHealthCounters(id: string, type: CallbackType, success: boolean): Promise<void> {
    this.calls.push({ id, type, success });
  }
}

class StubUnavailability implements IVariantUnavailabilityPort {
  calls: Array<{ variantId: string; reason: UnavailabilityReason }> = [];
  async propagateVariantUnavailable(variantId: string, reason: UnavailabilityReason): Promise<PropagationResult> {
    this.calls.push({ variantId, reason });
    return { updated: 0, failed: 0, skipped: 0 };
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────

function makeListing(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'eb4e1b68-261a-4b7e-b5eb-968c8213661e',
    variant_id: '9b9d95e9-292c-4854-8edb-813e69c406cf',
    status: 'active',
    provider_account_id: '4c2da164-ce47-4713-a144-35a720567324',
    price_cents: 1518,
    currency: 'EUR',
    min_jit_margin_cents: null,
    external_listing_id: 'b1259882-4af3-11f1-8bc7-0e96fa65f949',
    listing_type: 'declared_stock',
    ...overrides,
  };
}

/**
 * Verbatim Eneba RESERVE payload from the production Sentry trace at
 * 2026-05-08T23:34:17Z, auctionId b1259882-4af3-11f1-8bc7-0e96fa65f949.
 */
function buildProductionReservePayload(): DeclaredStockReserveDto {
  const auction: EnebaAuctionPayload = {
    auctionId: 'b1259882-4af3-11f1-8bc7-0e96fa65f949',
    keyCount: 1,
    price: { amount: '1594', currency: 'EUR' },
    originalPrice: { amount: '1518', currency: 'EUR' },
    priceWithoutCommission: { amount: '1473', currency: 'EUR' },
    campaignFee: { amount: '76', currency: 'EUR' },
    substituteAuctionFee: undefined,
  };
  return {
    orderId: '48a08932-4b36-11f1-a998-dea618cb509d',
    originalOrderId: null,
    auctions: [auction],
    wholesale: false,
    providerCode: 'eneba',
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('HandleDeclaredStockReserveUseCase — Sentry-noise regressions', () => {
  const captureException = vi.mocked(Sentry.captureException);
  const captureMessage = vi.mocked(Sentry.captureMessage);

  beforeEach(() => {
    captureException.mockClear();
    captureMessage.mockClear();
  });

  it(
    'returns reason=listing_inactive WITHOUT paging Sentry when an Eneba RESERVE arrives '
      + 'for a listing with status="paused" (production payload b1259882…)',
    async () => {
      const listing = makeListing({ status: 'paused' });
      const db = new StubDatabase(listing);
      const keyOps = new StubKeyOps();
      const events = new StubEvents();
      const health = new StubHealth();
      const unavailability = new StubUnavailability();
      const useCase = new HandleDeclaredStockReserveUseCase(
        db, keyOps, events, health, unavailability,
      );

      const result = await useCase.execute(buildProductionReservePayload());

      expect(result).toEqual({
        success: false,
        orderId: '48a08932-4b36-11f1-a998-dea618cb509d',
        reason: 'listing_inactive',
      });
      expect(keyOps.claimCalls).toHaveLength(0);
      expect(unavailability.calls).toHaveLength(0);
      expect(captureException).not.toHaveBeenCalled();
      expect(captureMessage).not.toHaveBeenCalled();
    },
  );

  it('returns reason=out_of_stock WITHOUT paging Sentry when the claim raises INSUFFICIENT_STOCK', async () => {
    const db = new StubDatabase(makeListing({ status: 'active' }));
    const keyOps = new StubKeyOps();
    keyOps.claimResult = new Error(
      'RPC claim_and_reserve_atomic failed: INSUFFICIENT_STOCK: need 1, got 0',
    );
    const events = new StubEvents();
    const health = new StubHealth();
    const unavailability = new StubUnavailability();
    const useCase = new HandleDeclaredStockReserveUseCase(
      db, keyOps, events, health, unavailability,
    );

    const result = await useCase.execute(buildProductionReservePayload());

    expect(result.success).toBe(false);
    expect(result.reason).toBe('out_of_stock');
    expect(unavailability.calls).toEqual([
      { variantId: listingVariantId(), reason: 'jit_failed' },
    ]);
    expect(captureException).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('returns reason=unexpected_error AND pages Sentry when the claim raises something not stock-related', async () => {
    const db = new StubDatabase(makeListing({ status: 'active' }));
    const keyOps = new StubKeyOps();
    keyOps.claimResult = new Error('Database connection refused');
    const events = new StubEvents();
    const health = new StubHealth();
    const unavailability = new StubUnavailability();
    const useCase = new HandleDeclaredStockReserveUseCase(
      db, keyOps, events, health, unavailability,
    );

    const result = await useCase.execute(buildProductionReservePayload());

    expect(result.success).toBe(false);
    expect(result.reason).toBe('unexpected_error');
    // Real bug: must surface to Sentry as an exception.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('returns reason=no_auctions for malformed RESERVE with empty auctions[] (still pages Sentry as error)', async () => {
    const db = new StubDatabase(null);
    const keyOps = new StubKeyOps();
    const events = new StubEvents();
    const health = new StubHealth();
    const unavailability = new StubUnavailability();
    const useCase = new HandleDeclaredStockReserveUseCase(
      db, keyOps, events, health, unavailability,
    );

    const result = await useCase.execute({
      orderId: 'order-empty',
      originalOrderId: null,
      auctions: [],
      providerCode: 'eneba',
    });

    expect(result).toEqual({
      success: false,
      orderId: 'order-empty',
      reason: 'no_auctions',
    });
    // No auctions is a contract violation by the caller — keep Sentry visibility here.
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});

function listingVariantId(): string {
  return '9b9d95e9-292c-4854-8edb-813e69c406cf';
}
