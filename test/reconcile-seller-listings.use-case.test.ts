import { describe, expect, it, vi } from 'vitest';
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
import type {
  EnebaKeyReconcileResult,
  IEnebaKeyReconcileService,
} from '../src/core/ports/eneba-key-reconcile.port.js';
import type { ExpireReservationsUseCase } from '../src/core/use-cases/seller/expire-reservations.use-case.js';
import { ReconcileSellerListingsUseCase } from '../src/core/use-cases/seller/reconcile-seller-listings.use-case.js';
import type { ReconcilePhase } from '../src/core/use-cases/seller/reconcile-seller-listings.types.js';
import type { SyncSellerListingPausedAlertsUseCase } from '../src/core/use-cases/seller/sync-seller-listing-paused-alerts.use-case.js';
import type { SyncSellerListingPricingFrozenAlertsUseCase } from '../src/core/use-cases/seller/sync-seller-listing-pricing-frozen-alerts.use-case.js';
import type {
  SyncSellerListingPausedAlertsResult,
  SyncSellerListingPricingFrozenAlertsResult,
} from '../src/core/use-cases/alerts/alerts.types.js';

/** All phases in canonical order. `sync-buyer-catalog` is owned by its own
 *  standalone cron route and is intentionally NOT a phase here. */
const ALL_PHASES: ReconcilePhase[] = [
  'expire-reservations',
  'cost-basis',
  'pricing',
  'declared-stock',
  'remote-stock',
  'eneba-key-reconcile',
  'paused-listing-alerts',
  'pricing-frozen-alerts',
];

interface CallTracker {
  readonly calls: ReconcilePhase[];
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

function emptyEnebaKeyReconcileResult(): EnebaKeyReconcileResult {
  return {
    listings_checked: 0,
    reported_keys_found: 0,
    reported_keys_marked_faulty: 0,
    orphaned_provisions_found: 0,
    orphaned_provisions_restocked: 0,
  };
}

function emptyPausedAlertsResult(): SyncSellerListingPausedAlertsResult {
  return { alertsCreated: 0, alertsResolved: 0, pausedListingCount: 0 };
}

function emptyPricingFrozenAlertsResult(): SyncSellerListingPricingFrozenAlertsResult {
  return { alertsCreated: 0, alertsResolved: 0, frozenListingCount: 0 };
}

interface FakeSetup {
  readonly tracker: CallTracker;
  readonly autoPricing: ISellerAutoPricingService;
  readonly declaredStock: IProcurementDeclaredStockReconcileService;
  readonly stockSync: ISellerStockSyncService;
  readonly enebaKeyReconcile: Pick<IEnebaKeyReconcileService, 'execute'>;
  readonly expireReservations: Pick<ExpireReservationsUseCase, 'execute'>;
  readonly syncPausedAlerts: Pick<SyncSellerListingPausedAlertsUseCase, 'execute'>;
  readonly syncPricingFrozenAlerts: Pick<SyncSellerListingPricingFrozenAlertsUseCase, 'execute'>;
}

interface SetupOptions {
  readonly throwOnPhase?: ReconcilePhase;
  readonly captureDeclaredStockDto?: { dto?: ProcurementDeclaredStockReconcileDto };
}

function setup(options: SetupOptions = {}): FakeSetup {
  const tracker: CallTracker = { calls: [] };

  const record = <T>(phase: ReconcilePhase, result: T): T => {
    tracker.calls.push(phase);
    if (options.throwOnPhase === phase) {
      throw new Error(`fake failure on ${phase}`);
    }
    return result;
  };

  return {
    tracker,
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
    enebaKeyReconcile: {
      execute: vi.fn().mockImplementation(async () => record('eneba-key-reconcile', emptyEnebaKeyReconcileResult())),
    },
    expireReservations: {
      execute: vi.fn().mockImplementation(async () => record('expire-reservations', emptyExpireResult())),
    },
    syncPausedAlerts: {
      execute: vi.fn().mockImplementation(async () => record('paused-listing-alerts', emptyPausedAlertsResult())),
    },
    syncPricingFrozenAlerts: {
      execute: vi.fn().mockImplementation(async () => record('pricing-frozen-alerts', emptyPricingFrozenAlertsResult())),
    },
  };
}

function build(s: FakeSetup): ReconcileSellerListingsUseCase {
  return new ReconcileSellerListingsUseCase(
    s.autoPricing,
    s.declaredStock,
    s.stockSync,
    s.enebaKeyReconcile as unknown as IEnebaKeyReconcileService,
    s.expireReservations as unknown as ExpireReservationsUseCase,
    s.syncPausedAlerts as unknown as SyncSellerListingPausedAlertsUseCase,
    s.syncPricingFrozenAlerts as unknown as SyncSellerListingPricingFrozenAlertsUseCase,
  );
}

describe('ReconcileSellerListingsUseCase', () => {
  it('runs every phase in canonical order on a default invocation', async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-1', {});

    expect(s.tracker.calls).toEqual(ALL_PHASES);
    expect(result.request_id).toBe('req-1');
    for (const phase of s.tracker.calls) {
      expect(result.phases[phase].ran).toBe(true);
      expect(result.phases[phase].error).toBeUndefined();
    }
  });

  it('does NOT consult fulfillment_mode — admin-marketplace maintenance is independent of user-facing fulfillment', async () => {
    // ReconcileSellerListingsUseCase no longer accepts an IPlatformSettingsPort. This
    // test guards against a regression that re-introduces the gate by asserting the
    // class still constructs (and runs) without one in the dependency graph.
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-no-fulfillment-gate', {});

    expect(s.tracker.calls).toEqual(ALL_PHASES);
    expect(result).not.toHaveProperty('fulfillment_mode');
  });

  it("does NOT include 'sync-buyer-catalog' as a phase — it lives on its own cron route", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-no-sync', {});

    expect(s.tracker.calls).not.toContain('sync-buyer-catalog' as ReconcilePhase);
    expect(result.phases).not.toHaveProperty('sync-buyer-catalog');
  });

  it("runs no phases when 'phases' filter is an explicit empty array (no fallback to all)", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-empty', { phases: [] });

    expect(s.tracker.calls).toEqual([]);
    for (const phase of ALL_PHASES) {
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

    expect(s.tracker.calls).toEqual(ALL_PHASES);
    expect(result.phases['pricing'].ran).toBe(true);
    expect(result.phases['pricing'].error).toMatch(/fake failure on pricing/);
    expect(result.phases['declared-stock'].ran).toBe(true);
    expect(result.phases['declared-stock'].error).toBeUndefined();
    expect(result.phases['paused-listing-alerts'].ran).toBe(true);
  });

  it('records duration_ms for every phase outcome and a total_duration_ms on the result', async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-7', {});

    expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);
    for (const phase of ALL_PHASES) {
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

  it("invokes the paused-listing-alerts phase exactly once per run", async () => {
    const s = setup();
    const uc = build(s);

    await uc.execute('req-paused-alerts', {});

    expect(s.syncPausedAlerts.execute).toHaveBeenCalledOnce();
  });

  it("includes 'paused-listing-alerts' in the result payload so cron logs surface alert sync metrics", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-cron-result', {});

    expect(result.phases['paused-listing-alerts'].ran).toBe(true);
    expect(result.phases['paused-listing-alerts'].result).toEqual({
      alertsCreated: 0,
      alertsResolved: 0,
      pausedListingCount: 0,
    });
  });
});
