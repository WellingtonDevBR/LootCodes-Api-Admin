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
import type {
  IBuyerOfferSnapshotSyncService,
  BuyerOfferSnapshotSyncResult,
} from '../src/core/ports/buyer-offer-snapshot-sync.port.js';
import type { ExpireReservationsUseCase } from '../src/core/use-cases/seller/expire-reservations.use-case.js';
import { ReconcileSellerListingsUseCase } from '../src/core/use-cases/seller/reconcile-seller-listings.use-case.js';
import type { ReconcilePhase } from '../src/core/use-cases/seller/reconcile-seller-listings.types.js';
import type { SyncSellerListingPausedAlertsUseCase } from '../src/core/use-cases/seller/sync-seller-listing-paused-alerts.use-case.js';
import type { SyncSellerListingPausedAlertsResult } from '../src/core/use-cases/alerts/alerts.types.js';

/** All seven phases in canonical order. */
const ALL_PHASES: ReconcilePhase[] = [
  'expire-reservations',
  'sync-buyer-catalog',
  'cost-basis',
  'pricing',
  'declared-stock',
  'remote-stock',
  'paused-listing-alerts',
];

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

function emptyPausedAlertsResult(): SyncSellerListingPausedAlertsResult {
  return { alertsCreated: 0, alertsResolved: 0, pausedListingCount: 0 };
}

function emptyBuyerCatalogSyncResult(): BuyerOfferSnapshotSyncResult {
  return { scanned: 0, updated: 0, failed: 0, skipped: 0, durationMs: 0 };
}

interface FakeSetup {
  readonly tracker: CallTracker;
  readonly platformSettings: IPlatformSettingsPort;
  readonly autoPricing: ISellerAutoPricingService;
  readonly declaredStock: IProcurementDeclaredStockReconcileService;
  readonly stockSync: ISellerStockSyncService;
  readonly buyerCatalogSync: IBuyerOfferSnapshotSyncService;
  readonly expireReservations: Pick<ExpireReservationsUseCase, 'execute'>;
  readonly syncPausedAlerts: Pick<SyncSellerListingPausedAlertsUseCase, 'execute'>;
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
    buyerCatalogSync: {
      syncAll: vi.fn().mockImplementation(async () => record('sync-buyer-catalog', emptyBuyerCatalogSyncResult())),
    },
    expireReservations: {
      execute: vi.fn().mockImplementation(async () => record('expire-reservations', emptyExpireResult())),
    },
    syncPausedAlerts: {
      execute: vi.fn().mockImplementation(async () => record('paused-listing-alerts', emptyPausedAlertsResult())),
    },
  };
}

function build(s: FakeSetup): ReconcileSellerListingsUseCase {
  return new ReconcileSellerListingsUseCase(
    s.platformSettings,
    s.autoPricing,
    s.declaredStock,
    s.stockSync,
    s.buyerCatalogSync,
    s.expireReservations as unknown as ExpireReservationsUseCase,
    s.syncPausedAlerts as unknown as SyncSellerListingPausedAlertsUseCase,
  );
}

describe('ReconcileSellerListingsUseCase', () => {
  it("runs all seven phases in canonical order when fulfillment_mode is 'auto'", async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-1', {});

    expect(s.tracker.calls).toEqual(ALL_PHASES);
    expect(result.fulfillment_mode).toBe('auto');
    expect(result.request_id).toBe('req-1');
    for (const phase of s.tracker.calls) {
      expect(result.phases[phase].ran).toBe(true);
      expect(result.phases[phase].error).toBeUndefined();
    }
  });

  it("sync-buyer-catalog runs before declared-stock in the canonical order", async () => {
    const s = setup();
    const uc = build(s);

    await uc.execute('req-order', {});

    const syncIdx = s.tracker.calls.indexOf('sync-buyer-catalog');
    const declaredIdx = s.tracker.calls.indexOf('declared-stock');
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeLessThan(declaredIdx);
  });

  it("does not pause seller maintenance when fulfillment_mode is 'hold_new_cards'", async () => {
    const s = setup({ mode: 'hold_new_cards' });
    const uc = build(s);

    const result = await uc.execute('req-2', {});

    expect(s.tracker.calls).toHaveLength(ALL_PHASES.length);
    expect(result.fulfillment_mode).toBe('hold_new_cards');
  });

  it("skips every phase with skipped_reason='global_hold' when fulfillment_mode is 'hold_all'", async () => {
    const s = setup({ mode: 'hold_all' });
    const uc = build(s);

    const result = await uc.execute('req-3', {});

    expect(s.tracker.calls).toEqual([]);
    expect(result.fulfillment_mode).toBe('hold_all');
    for (const phase of ALL_PHASES) {
      expect(result.phases[phase].ran).toBe(false);
      expect(result.phases[phase].skipped_reason).toBe('global_hold');
    }
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
    expect(result.phases['sync-buyer-catalog'].skipped_reason).toBe('phase_filter');
    expect(result.phases['declared-stock'].skipped_reason).toBe('phase_filter');
    expect(result.phases['remote-stock'].skipped_reason).toBe('phase_filter');
  });

  it('sync-buyer-catalog can be run in isolation via phases filter', async () => {
    const s = setup();
    const uc = build(s);

    const result = await uc.execute('req-sync-only', { phases: ['sync-buyer-catalog'] });

    expect(s.tracker.calls).toEqual(['sync-buyer-catalog']);
    expect(result.phases['sync-buyer-catalog'].ran).toBe(true);
    expect(result.phases['sync-buyer-catalog'].error).toBeUndefined();
    expect(s.buyerCatalogSync.syncAll).toHaveBeenCalledWith('req-sync-only');
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
    expect(result.phases['sync-buyer-catalog'].ran).toBe(true);
    expect(result.phases['sync-buyer-catalog'].error).toBeUndefined();
    expect(result.phases['declared-stock'].ran).toBe(true);
    expect(result.phases['declared-stock'].error).toBeUndefined();
    expect(result.phases['paused-listing-alerts'].ran).toBe(true);
  });

  it('sync-buyer-catalog failure is isolated — declared-stock still runs', async () => {
    const s = setup({ throwOnPhase: 'sync-buyer-catalog' });
    const uc = build(s);

    const result = await uc.execute('req-sync-fail', {});

    expect(result.phases['sync-buyer-catalog'].ran).toBe(true);
    expect(result.phases['sync-buyer-catalog'].error).toMatch(/fake failure on sync-buyer-catalog/);
    expect(result.phases['declared-stock'].ran).toBe(true);
    expect(result.phases['declared-stock'].error).toBeUndefined();
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
