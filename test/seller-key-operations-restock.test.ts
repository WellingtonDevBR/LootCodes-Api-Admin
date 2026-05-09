/**
 * Unit tests for SellerKeyOperationsService.handlePostProvisionReturn — specifically
 * the restock fan-out that releases provisioned keys back into available inventory
 * after a marketplace refund.
 *
 * Production incident (reservation 85cabf15-…): every per-key restock RPC threw
 * `42883: operator does not exist: key_state_enum = text`. Both `try` blocks
 * swallowed the error with bare `catch {}`, so the only thing in Sentry was
 * "Failed to restock key" — no error message, no clue. Result: 10 keys stranded
 * as `seller_provisioned` despite the marketplace refund.
 *
 * These tests pin down the contract:
 *  - Batch RPC is preferred and, when it succeeds, no per-key fan-out happens.
 *  - When the batch RPC throws, fall back to per-key calls.
 *  - When a per-key call throws, the underlying error message must reach the log
 *    (no silent swallow) so the next incident is debuggable.
 *  - Successful restock count must reflect the rows actually updated.
 */
import { describe, it, expect, beforeAll, vi, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { SellerKeyOperationsService } from '../src/infra/seller/seller-key-operations.service.js';
import type { IDatabase, QueryOptions, PaginatedResult } from '../src/core/ports/database.port.js';
import type { ISellerDomainEventPort } from '../src/core/ports/seller-domain-event.port.js';
import type { IKeyDecryptionPort } from '../src/core/ports/key-decryption.port.js';
import type { SellerJitProcurementService } from '../src/infra/seller/seller-jit-procurement.service.js';
import type { PostProvisionReturnParams } from '../src/core/ports/seller-key-operations.port.js';

beforeAll(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
  process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'test-secret';
  process.env.NODE_ENV = 'test';
  loadEnv();
});

// ─── Fakes ────────────────────────────────────────────────────────────

type RpcCall = { fn: string; params?: Record<string, unknown> };

interface RpcHandler {
  (params: Record<string, unknown> | undefined): Promise<unknown>;
}

class FakeDb implements IDatabase {
  rpcCalls: RpcCall[] = [];
  rpcHandlers = new Map<string, RpcHandler>();
  /** Rows returned for `seller_key_provisions` queries (delivered list + final fraction). */
  provisions: Array<{ id: string; product_key_id: string; status: string; created_at: string }> = [];
  /** Updates applied so we can assert the provision-status flip post-restock. */
  updateCalls: Array<{ table: string; filter: Record<string, unknown>; data: Record<string, unknown> }> = [];

  setRpc(fn: string, handler: RpcHandler): void {
    this.rpcHandlers.set(fn, handler);
  }

  async rpc<T = unknown>(fn: string, params?: Record<string, unknown>): Promise<T> {
    this.rpcCalls.push({ fn, params });
    const handler = this.rpcHandlers.get(fn);
    if (!handler) throw new Error(`Unexpected RPC: ${fn}`);
    return (await handler(params)) as T;
  }

  async query<T = unknown>(table: string, _options?: QueryOptions): Promise<T[]> {
    if (table === 'seller_key_provisions') {
      return this.provisions as unknown as T[];
    }
    if (table === 'transactions') return [] as T[];
    return [] as T[];
  }

  async queryAll<T = unknown>(_table: string, _options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    return [];
  }

  async queryOne<T = unknown>(_table: string, _options?: QueryOptions): Promise<T | null> {
    return null;
  }

  async queryPaginated<T = unknown>(_table: string, _options?: QueryOptions): Promise<PaginatedResult<T>> {
    return { data: [], total: 0 };
  }

  async insert<T = unknown>(_table: string, _data: Record<string, unknown>): Promise<T> {
    return {} as T;
  }

  async insertMany(_table: string, _rows: Record<string, unknown>[]): Promise<number> {
    return 0;
  }

  async update<T = unknown>(table: string, filter: Record<string, unknown>, data: Record<string, unknown>): Promise<T[]> {
    this.updateCalls.push({ table, filter, data });
    return [] as T[];
  }

  async upsert<T = unknown>(_table: string, _data: Record<string, unknown>, _onConflict?: string): Promise<T> {
    return {} as T;
  }

  async upsertMany(_table: string, _rows: Record<string, unknown>[], _onConflict: string): Promise<void> {}

  async delete(_table: string, _filter: Record<string, unknown>): Promise<number> {
    return 0;
  }

  async invokeFunction<T = unknown>(_fn: string, _body: Record<string, unknown>): Promise<T> {
    return {} as T;
  }

  async invokeInternalFunction<T = unknown>(_fn: string, _body: Record<string, unknown>): Promise<T> {
    return {} as T;
  }
}

class FakeSellerEvents implements ISellerDomainEventPort {
  emitted: Array<Record<string, unknown>> = [];
  async emitSellerEvent(event: Parameters<ISellerDomainEventPort['emitSellerEvent']>[0]): Promise<boolean> {
    this.emitted.push(event as unknown as Record<string, unknown>);
    return true;
  }
  async emitInventoryStockChanged(_payload: Parameters<ISellerDomainEventPort['emitInventoryStockChanged']>[0]): Promise<void> {}
}

const fakeKeyDecryption: IKeyDecryptionPort = {
  decryptKeysByIds: async () => [],
};

const fakeJitProcurement = {} as unknown as SellerJitProcurementService;

function makeProvisions(count: number): FakeDb['provisions'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `prov-${i + 1}`,
    product_key_id: `key-${i + 1}`,
    status: 'delivered',
    created_at: new Date(Date.UTC(2026, 4, 9, 1, 13, 49) + i).toISOString(),
  }));
}

function makeReturnParams(count: number): PostProvisionReturnParams {
  return {
    reservation: {
      id: '85cabf15-0bdc-44b4-a7f7-c6b83d830a85',
      seller_listing_id: 'listing-001',
      quantity: count,
    },
    providerCode: 'eneba',
    externalOrderId: 'eneba-order-001',
    reason: 'CANCEL',
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('SellerKeyOperationsService.handlePostProvisionReturn — restock contract', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('uses batch_restock_seller_keys when available and skips per-key fan-out', async () => {
    const db = new FakeDb();
    db.provisions = makeProvisions(3);

    db.setRpc('batch_restock_seller_keys', async (params) => {
      const ids = params?.p_key_ids as string[];
      return ids.map((id) => ({ id }));
    });

    const svc = new SellerKeyOperationsService(db, new FakeSellerEvents(), fakeKeyDecryption, fakeJitProcurement);

    const restocked = await svc.handlePostProvisionReturn(makeReturnParams(3));

    expect(restocked).toBe(3);
    expect(db.rpcCalls.filter((c) => c.fn === 'batch_restock_seller_keys')).toHaveLength(1);
    expect(db.rpcCalls.filter((c) => c.fn === 'restock_seller_key')).toHaveLength(0);
  });

  it('falls back to per-key restock_seller_key when the batch RPC throws', async () => {
    const db = new FakeDb();
    db.provisions = makeProvisions(2);

    db.setRpc('batch_restock_seller_keys', async () => {
      throw new Error('PGRST202 function batch_restock_seller_keys does not exist');
    });
    db.setRpc('restock_seller_key', async () => ({ success: true }));

    const svc = new SellerKeyOperationsService(db, new FakeSellerEvents(), fakeKeyDecryption, fakeJitProcurement);

    const restocked = await svc.handlePostProvisionReturn(makeReturnParams(2));

    expect(restocked).toBe(2);
    expect(db.rpcCalls.filter((c) => c.fn === 'restock_seller_key')).toHaveLength(2);
  });

  it('logs the underlying error message when a per-key restock throws (no silent swallow)', async () => {
    const db = new FakeDb();
    db.provisions = makeProvisions(1);

    db.setRpc('batch_restock_seller_keys', async () => {
      throw new Error('batch missing');
    });
    db.setRpc('restock_seller_key', async () => {
      throw new Error('operator does not exist: key_state_enum = text');
    });

    const svc = new SellerKeyOperationsService(db, new FakeSellerEvents(), fakeKeyDecryption, fakeJitProcurement);

    const restocked = await svc.handlePostProvisionReturn(makeReturnParams(1));

    expect(restocked).toBe(0);
    const loggedWarnings = warnSpy.mock.calls.flat().join(' ');
    expect(loggedWarnings).toMatch(/Failed to restock key/);
    expect(loggedWarnings).toMatch(/operator does not exist: key_state_enum = text/);
  });

  it('logs the batch failure cause when falling back (so we never silently lose context)', async () => {
    const db = new FakeDb();
    db.provisions = makeProvisions(1);

    db.setRpc('batch_restock_seller_keys', async () => {
      throw new Error('PGRST202 function not found');
    });
    db.setRpc('restock_seller_key', async () => ({ success: true }));

    const svc = new SellerKeyOperationsService(db, new FakeSellerEvents(), fakeKeyDecryption, fakeJitProcurement);

    await svc.handlePostProvisionReturn(makeReturnParams(1));

    const loggedWarnings = warnSpy.mock.calls.flat().join(' ');
    expect(loggedWarnings).toMatch(/PGRST202 function not found/);
  });

  it('flips delivered provisions to refunded after successful restock', async () => {
    const db = new FakeDb();
    db.provisions = makeProvisions(2);

    db.setRpc('batch_restock_seller_keys', async (params) => {
      const ids = params?.p_key_ids as string[];
      return ids.map((id) => ({ id }));
    });

    const svc = new SellerKeyOperationsService(db, new FakeSellerEvents(), fakeKeyDecryption, fakeJitProcurement);

    await svc.handlePostProvisionReturn(makeReturnParams(2));

    const flips = db.updateCalls.filter(
      (u) => u.table === 'seller_key_provisions' && u.data.status === 'refunded',
    );
    expect(flips).toHaveLength(2);
  });
});
