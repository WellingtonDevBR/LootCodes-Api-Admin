import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { IAdminAlertsRepository } from '../src/core/ports/admin-alerts-repository.port.js';
import { SyncSellerListingPausedAlertsUseCase } from '../src/core/use-cases/seller/sync-seller-listing-paused-alerts.use-case.js';

function buildRepo(
  result = { alertsCreated: 0, alertsResolved: 0, pausedListingCount: 0 },
): IAdminAlertsRepository {
  return {
    listAlerts: vi.fn(),
    dismissAlert: vi.fn(),
    dismissAllAlerts: vi.fn(),
    dismissAllByFilter: vi.fn(),
    syncSellerListingPausedAlerts: vi.fn().mockResolvedValue(result),
  };
}

describe('SyncSellerListingPausedAlertsUseCase', () => {
  it('returns the repository sync result unchanged', async () => {
    const repo = buildRepo({ alertsCreated: 3, alertsResolved: 1, pausedListingCount: 4 });
    const uc = new SyncSellerListingPausedAlertsUseCase(repo);

    const out = await uc.execute();

    expect(out).toEqual({ alertsCreated: 3, alertsResolved: 1, pausedListingCount: 4 });
    expect(repo.syncSellerListingPausedAlerts).toHaveBeenCalledOnce();
  });
});
