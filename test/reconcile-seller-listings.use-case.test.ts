import { describe, expect, it, vi } from 'vitest';
import type {
  FulfillmentMode,
  IPlatformSettingsPort,
} from '../src/core/ports/platform-settings.port.js';
import type {
  ISellerAutoPricingService,
  ISellerStockSyncService,
  RefreshCostBasesResult,
  RefreshPricesResult,
  RefreshStockResult,
} from '../src/core/ports/seller-pricing.port.js';
import type {
  IProcurementDeclaredStockReconcileService,
  ProcurementDeclaredStockReconcileDto,
  ProcurementDeclaredStockReconcileResult,
} from '../src/core/ports/procurement-declared-stock-reconcile.port.js';
import type { ExpireReservationsUseCase } from '../src/core/use-cases/seller/expire-reservations.use-case.js';
import { ReconcileSellerListingsUseCase } from '../src/core/use-cases/seller/reconcile-seller-listings.use-case.js';
import type { ReconcilePhase } from '../src/core/use-cases/seller/reconcile-seller-listings.types.js';

interface CallTracker {
  readonly calls: ReconcilePhase[];
}

function buildPlatformSettings(mode: FulfillmentMode): IPlatformSettingsPort {
  return { getFulfillmentMode: vi.fn().mockResolvedValue(mode) };
}

function emptyExpireResult() {
  return { expired: 0 };
}

function emptyCostBasisResult(): RefreshCostBasesResult {
  return { listingsProcessed: 0, costBasisUpdated: 0, errors: 0 };
}

function emptyPricesResult(): RefreshPricesResult {
  return {
    listingsProcessed: 0,
    pricesUpdated: 0,
    pricesSkippedRateLimit: 0,
    pricesSkippedIntelligence: 0,
    pricesSkippedOscillation: 0,
    paidPriceChanges: 0,
    estimatedFeeCents: 0,
    costBasisUpdated: 0,
    decisionsRecorded: 0,
    errors: 0,
    providers: 0,
  };
}

function emptyStockResult(): RefreshStockResult {
  return { listingsProcessed: 0, stockUpdated: 0, errors: 0 };
}

function emptyDeclaredStockResult(dryRun = false): ProcurementDeclaredStockReconcileResult {
  return { dry_run: dryRun, scanned: 0, updated: 0, skipped: 0, failures: [] };
}

interface FakeSetup {
  readonly tracker: CallTracker;
  readonly platformSettings: IPlatformSettingsPort;
  readonly autoPricing: ISellerAutoPricingService;
  readonly declaredStock: IProcurementDeclaredStockReconcileService;
  readonly stockSync: ISellerStockSyncService;
  readonly expireReservations: Pick<ExpireReservationsUseCase, 'execute'>;
}

interface SetupOptions {
  readonly mode?: FulfillmentMode;
  readonly throwOnPhase?: ReconcilePhase;
  readonly captureDeclaredStockDto?: { dto?: ProcurementDeclaredStockReconcileDto };
}

function setup(options: SetupOptions = {}): FakeSetup {
  const tracker: CallTracker = { calls: [] };
  const mode = options.mode ?? 'auto';

  const record = <T>(phase: ReconcilePhase, result: T): T => {
    tracker.calls.push(phase);
    if (options.throwOnPhase === phase) {
      throw new Error(`fake failure on ${phase}`);
    }
    return result;
  };

  return {
    tracker,
    platformSettings: buildPlatformSettings(mode),
    autoPricing: {
      refreshAllCostBases: vi.fn().mockImplementation(async () => record('cost-basis', emptyCostBasisResult())),
      refreshAllPrices: vi.fn().mockImplementation(async () => record('pricing', emptyPricesResult())),
    },
    declaredStock: {
      execute: vi.fn().mockImplementation(async (_requestId: string, dto: ProcurementDeclaredStockReconcileDto) => {
        if (options.captureDeclaredStockDto) options.captureDeclaredStockDto.dto = dto;
        return record('declared-stock', emptyDeclaredStockResult(dto.dry_run === true));
      }),
    },
    stockSync: {
      refreshAllStock: vi.fn().mockImplementation(async () => record('remote-stock', emptyStockResult())),
    },
    expireReservations: {
      execute: vi.fn().mockImplementation(async () => record('expire-reservations', emptyExpireResult())),
    },
  };
}

function build(s: FakeSetup): ReconcileSellerListingsUseCase {
  return new ReconcileSellerListingsUseCase(
    s.platformSettings,
    s.autoPricing,
    s.declaredStock,
    s.stockSync,
    s.expireReservations as unknown as ExpireReservationsUseCase,
  );
}

describe('ReconcileSellerListingsUseCase', () => {
  it("runs all five phases in canonical order when fulfillment_mode is 'auto'", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-1', {});

    expect(s.tracker.calls).toEqual([
      'expire-reservations',
      'cost-basis',
      'pricing',
      'declared-stock',
      'remote-stock',
    ]);
    expect(result.fulfillment_mode).toBe('auto');
    expect(result.request_id).toBe('req-1');
    for (const phase of s.tracker.calls) {
      expect(result.phases[phase].ran).toBe(true);
      expect(result.phases[phase].error).toBeUndefined();
    }
  });

  it("does not pause seller maintenance when fulfillment_mode is 'hold_new_cards'", async () => {
    const s = setup({ mode: 'hold_new_cards' });
    const uc = build(s);

    const result = await uc.execute('req-2', {});

    expect(s.tracker.calls).toHaveLength(5);
    expect(result.fulfillment_mode).toBe('hold_new_cards');
  });

  it("skips every phase with skipped_reason='global_hold' when fulfillment_mode is 'hold_all'", async () => {
    const s = setup({ mode: 'hold_all' });
    const uc = build(s);

    const result = await uc.execute('req-3', {});

    expect(s.tracker.calls).toEqual([]);
    expect(result.fulfillment_mode).toBe('hold_all');
    for (const phase of [
      'expire-reservations',
      'cost-basis',
      'pricing',
      'declared-stock',
      'remote-stock',
    ] as ReconcilePhase[]) {
      expect(result.phases[phase].ran).toBe(false);
      expect(result.phases[phase].skipped_reason).toBe('global_hold');
    }
  });

  it("runs no phases when 'phases' filter is an explicit empty array (no fallback to all)", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-empty', { phases: [] });

    expect(s.tracker.calls).toEqual([]);
    for (const phase of [
      'expire-reservations',
      'cost-basis',
      'pricing',
      'declared-stock',
      'remote-stock',
    ] as ReconcilePhase[]) {
      expect(result.phases[phase].ran).toBe(false);
      expect(result.phases[phase].skipped_reason).toBe('phase_filter');
    }
  });

  it("runs only the requested phases when 'phases' filter is provided", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-4', { phases: ['cost-basis', 'pricing'] });

    expect(s.tracker.calls).toEqual(['cost-basis', 'pricing']);
    expect(result.phases['cost-basis'].ran).toBe(true);
    expect(result.phases['pricing'].ran).toBe(true);
    expect(result.phases['expire-reservations'].ran).toBe(false);
    expect(result.phases['expire-reservations'].skipped_reason).toBe('phase_filter');
    expect(result.phases['declared-stock'].skipped_reason).toBe('phase_filter');
    expect(result.phases['remote-stock'].skipped_reason).toBe('phase_filter');
  });

  it('propagates dry_run, variant_ids, and batch_limit to the declared-stock phase', async () => {
    const captured: { dto?: ProcurementDeclaredStockReconcileDto } = {};
    const s = setup({ captureDeclaredStockDto: captured });
    const uc = build(s);

    await uc.execute('req-5', {
      dry_run: true,
      variant_ids: ['11111111-1111-1111-1111-111111111111'],
      batch_limit: 42,
    });

    expect(captured.dto).toBeDefined();
    expect(captured.dto?.dry_run).toBe(true);
    expect(captured.dto?.variant_ids).toEqual(['11111111-1111-1111-1111-111111111111']);
    expect(captured.dto?.batch_limit).toBe(42);
  });

  it('continues to the next phase on per-phase failure and records the error string', async () => {
    const s = setup({ throwOnPhase: 'pricing' });
    const uc = build(s);

    const result = await uc.execute('req-6', {});

    expect(s.tracker.calls).toEqual([
      'expire-reservations',
      'cost-basis',
      'pricing',
      'declared-stock',
      'remote-stock',
    ]);
    expect(result.phases['pricing'].ran).toBe(true);
    expect(result.phases['pricing'].error).toMatch(/fake failure on pricing/);
    expect(result.phases['declared-stock'].ran).toBe(true);
    expect(result.phases['declared-stock'].error).toBeUndefined();
  });

  it('records duration_ms for every phase outcome and a total_duration_ms on the result', async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-7', {});

    expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);
    for (const phase of [
      'expire-reservations',
      'cost-basis',
      'pricing',
      'declared-stock',
      'remote-stock',
    ] as ReconcilePhase[]) {
      expect(result.phases[phase].duration_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses cron requestId as admin_id for ExpireReservationsUseCase', async () => {
    const s = setup();
    const uc = build(s);

    await uc.execute('cron-req-id', {});

    expect(s.expireReservations.execute).toHaveBeenCalledWith({
      admin_id: 'cron-req-id',
    });
  });
});
