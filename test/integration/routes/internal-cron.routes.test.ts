import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { TOKENS } from '../../../src/di/tokens.js';
import { buildTestApp, type TestApp } from '../../helpers/test-app.js';
import type { IBuyerOfferSnapshotSyncService } from '../../../src/core/ports/buyer-offer-snapshot-sync.port.js';

const VALID_SECRET = 'test-internal-secret';

interface MockBuyerCatalogSync {
  syncAll: ReturnType<typeof vi.fn>;
}

describe('Internal cron routes — POST /internal/cron/sync-buyer-catalog', () => {
  let testApp: TestApp;
  let syncService: MockBuyerCatalogSync;

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET = VALID_SECRET;

    syncService = {
      syncAll: vi.fn().mockResolvedValue({
        scanned: 10,
        updated: 8,
        failed: 1,
        skipped: 1,
        durationMs: 120,
      }),
    };
    container.register(TOKENS.BuyerOfferSnapshotSyncService, { useValue: syncService as IBuyerOfferSnapshotSyncService });

    testApp = await buildTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(() => {
    syncService.syncAll.mockClear();
  });

  it('returns 401 without x-internal-secret header', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/internal/cron/sync-buyer-catalog',
    });
    expect(res.statusCode).toBe(401);
    expect(syncService.syncAll).not.toHaveBeenCalled();
  });

  it('returns 202 accepted immediately and fires syncAll in background', async () => {
    const res = await testApp.app.inject({
      method: 'POST',
      url: '/internal/cron/sync-buyer-catalog',
      headers: { 'x-internal-secret': VALID_SECRET },
    });

    expect(res.statusCode).toBe(202);
    expect(syncService.syncAll).toHaveBeenCalledOnce();
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(typeof body.request_id).toBe('string');
  });

  it('returns 202 immediately even when syncAll rejects (error logged in background)', async () => {
    syncService.syncAll.mockRejectedValueOnce(new Error('network timeout'));

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/internal/cron/sync-buyer-catalog',
      headers: { 'x-internal-secret': VALID_SECRET },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().accepted).toBe(true);
    expect(syncService.syncAll).toHaveBeenCalledOnce();
  });
});
