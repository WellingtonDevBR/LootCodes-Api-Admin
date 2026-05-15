/**
 * Shared stubs used by every Gamivo webhook handler test.
 *
 * Each stub implements the matching port end-to-end (no `unknown as` coercion)
 * so a future port-method addition fails the test compile rather than silently
 * being ignored at runtime. Keep these stubs tight: only what the Gamivo
 * handlers actually call should grow real behavior; everything else stays
 * a noop returning a sane default.
 */
import { vi } from 'vitest';
import type {
  IDatabase,
  QueryOptions,
  PaginatedResult,
} from '../../src/core/ports/database.port.js';
import type {
  ISellerKeyOperationsPort,
  ClaimKeysParams,
  ClaimKeysResult,
  ProvisionResult,
  DecryptPendingResult,
  DecryptedKey,
  CompleteProvisionParams,
  PostProvisionReturnParams,
} from '../../src/core/ports/seller-key-operations.port.js';
import type {
  ISellerDomainEventPort,
  EmitSellerEventParams,
  EmitInventoryStockChangedParams,
} from '../../src/core/ports/seller-domain-event.port.js';
import type {
  IListingHealthPort,
  CallbackType,
} from '../../src/core/ports/seller-listing-health.port.js';
import type {
  IVariantUnavailabilityPort,
  PropagationResult,
  UnavailabilityReason,
} from '../../src/core/ports/variant-unavailability.port.js';

// ─── Database stub ──────────────────────────────────────────────────

/**
 * Per-table query/response routing. The Gamivo handlers issue ~6 distinct
 * `queryOne`/`query` calls and a couple of `update`/`insert`/`rpc` calls;
 * this stub matches by table name and returns a fresh value every call.
 *
 * Override behavior with `setQueryOne(table, fn)` etc. — `fn` receives the
 * full `QueryOptions` so tests can branch on `.eq` filters when a single
 * table is queried multiple ways.
 */
export class TableStubDatabase implements IDatabase {
  private queryOneHandlers = new Map<string, (opts: QueryOptions | undefined) => unknown | null>();
  private queryHandlers = new Map<string, (opts: QueryOptions | undefined) => unknown[]>();
  private updateLog: Array<{ table: string; filter: Record<string, unknown>; data: Record<string, unknown> }> = [];
  private insertLog: Array<{ table: string; data: Record<string, unknown> }> = [];

  setQueryOne<T>(table: string, fn: (opts: QueryOptions | undefined) => T | null): this {
    this.queryOneHandlers.set(table, fn as (opts: QueryOptions | undefined) => unknown | null);
    return this;
  }

  setQuery<T>(table: string, fn: (opts: QueryOptions | undefined) => T[]): this {
    this.queryHandlers.set(table, fn as (opts: QueryOptions | undefined) => unknown[]);
    return this;
  }

  get updates(): ReadonlyArray<{ table: string; filter: Record<string, unknown>; data: Record<string, unknown> }> {
    return this.updateLog;
  }

  get inserts(): ReadonlyArray<{ table: string; data: Record<string, unknown> }> {
    return this.insertLog;
  }

  async query<T = unknown>(table: string, options?: QueryOptions): Promise<T[]> {
    const handler = this.queryHandlers.get(table);
    return ((handler ? handler(options) : []) as T[]);
  }

  async queryAll<T = unknown>(table: string, options?: Omit<QueryOptions, 'range' | 'limit'>): Promise<T[]> {
    return this.query<T>(table, options as QueryOptions);
  }

  async queryOne<T = unknown>(table: string, options?: QueryOptions): Promise<T | null> {
    const handler = this.queryOneHandlers.get(table);
    return ((handler ? handler(options) : null) as T | null);
  }

  async queryPaginated<T = unknown>(table: string, options?: QueryOptions): Promise<PaginatedResult<T>> {
    const data = await this.query<T>(table, options);
    return { data, total: data.length };
  }

  async insert<T = unknown>(table: string, data: Record<string, unknown>): Promise<T> {
    this.insertLog.push({ table, data });
    return data as T;
  }

  async insertMany(_table: string, rows: Record<string, unknown>[]): Promise<number> {
    return rows.length;
  }

  async update<T = unknown>(
    table: string,
    filter: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<T[]> {
    this.updateLog.push({ table, filter, data });
    return [data as T];
  }

  async updateIn<T = unknown>(
    _table: string,
    _column: string,
    _values: unknown[],
    data: Record<string, unknown>,
  ): Promise<T[]> {
    return [data as T];
  }

  async upsert<T = unknown>(_table: string, data: Record<string, unknown>): Promise<T> {
    return data as T;
  }

  async upsertMany(): Promise<void> { /* noop */ }

  async delete(): Promise<number> { return 0; }

  async rpc<T = unknown>(): Promise<T> { return null as T; }

  async invokeFunction<T = unknown>(): Promise<T> { return null as T; }

  async invokeInternalFunction<T = unknown>(): Promise<T> { return null as T; }
}

// ─── Key operations stub ────────────────────────────────────────────

/**
 * Spy-driven key operations stub. Every method records its calls so tests
 * can assert exact invocation order and arguments. Each method's return
 * value is configured per-test via the public `mock<Method>` helper.
 */
export class StubKeyOps implements ISellerKeyOperationsPort {
  claimKeysForReservation = vi.fn<(p: ClaimKeysParams) => Promise<ClaimKeysResult>>();
  provisionFromPendingKeys = vi.fn<(reservationId: string) => Promise<ProvisionResult>>();
  decryptPendingWithoutFinalize = vi.fn<(reservationId: string) => Promise<DecryptPendingResult>>();
  finalizeProvisions = vi.fn<(reservationId: string, keyIds: string[], provisionIds: string[]) => Promise<void>>();
  decryptDeliveredProvisionKeys = vi.fn<(reservationId: string) => Promise<{ decryptedKeys: DecryptedKey[] }>>();
  completeProvisionOrchestration = vi.fn<(p: CompleteProvisionParams) => Promise<void>>();
  releaseReservationKeys = vi.fn<(reservationId: string, target: 'cancelled' | 'expired' | 'failed') => Promise<number>>();
  handlePostProvisionReturn = vi.fn<(p: PostProvisionReturnParams) => Promise<number>>();

  constructor() {
    // Sane defaults so tests that only care about a subset of methods
    // don't trip over `undefined.then` from missing `mockResolvedValue`.
    this.provisionFromPendingKeys.mockResolvedValue({ keyIds: [], decryptedKeys: [] });
    this.decryptPendingWithoutFinalize.mockResolvedValue({ keyIds: [], provisionIds: [], decryptedKeys: [], keyFormats: [] });
    this.finalizeProvisions.mockResolvedValue();
    this.decryptDeliveredProvisionKeys.mockResolvedValue({ decryptedKeys: [] });
    this.completeProvisionOrchestration.mockResolvedValue();
    this.releaseReservationKeys.mockResolvedValue(0);
    this.handlePostProvisionReturn.mockResolvedValue(0);
  }
}

// ─── Domain event stub ──────────────────────────────────────────────

export class StubEvents implements ISellerDomainEventPort {
  sellerEvents: EmitSellerEventParams[] = [];
  stockChanged: EmitInventoryStockChangedParams[] = [];

  async emitSellerEvent(params: EmitSellerEventParams): Promise<boolean> {
    this.sellerEvents.push(params);
    return true;
  }

  async emitInventoryStockChanged(params: EmitInventoryStockChangedParams): Promise<void> {
    this.stockChanged.push(params);
  }
}

// ─── Listing health stub ────────────────────────────────────────────

export class StubHealth implements IListingHealthPort {
  calls: Array<{ id: string; type: CallbackType; success: boolean; reason?: string }> = [];

  async updateHealthCounters(
    externalListingId: string,
    callbackType: CallbackType,
    success: boolean,
    failureReason?: string,
  ): Promise<void> {
    this.calls.push({ id: externalListingId, type: callbackType, success, reason: failureReason });
  }
}

// ─── Variant unavailability stub ────────────────────────────────────

export class StubUnavailability implements IVariantUnavailabilityPort {
  calls: Array<{ variantId: string; reason: UnavailabilityReason }> = [];

  async propagateVariantUnavailable(
    variantId: string,
    reason: UnavailabilityReason,
  ): Promise<PropagationResult> {
    this.calls.push({ variantId, reason });
    return { updated: 0, failed: 0, skipped: 0 };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Wait for any work scheduled with `setImmediate` (background event emit,
 * health-counter writes, stock-changed dispatch) to drain before assertions.
 */
export function flushSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
