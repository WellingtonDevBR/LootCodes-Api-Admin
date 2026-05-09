import { describe, expect, it, beforeEach } from 'vitest';
import { ProcessPriceDropRefundsUseCase } from '../src/core/use-cases/price-match/process-price-drop-refunds.use-case.js';
import type { IAdminPriceMatchRepository } from '../src/core/ports/admin-price-match-repository.port.js';
import type { ProcessPriceDropRefundsResult } from '../src/core/use-cases/price-match/price-match.types.js';

// ─── Fake ─────────────────────────────────────────────────────────────

function makeRepo(grantedCount = 0): IAdminPriceMatchRepository & {
  processCallCount: number;
} {
  let processCallCount = 0;

  const fake: IAdminPriceMatchRepository & { processCallCount: number } = {
    get processCallCount() {
      return processCallCount;
    },
    async processPriceDropRefunds(): Promise<ProcessPriceDropRefundsResult> {
      processCallCount += 1;
      return { grantedCount };
    },
    // unused stubs
    listClaims: async () => ({ entries: [], total: 0 }),
    getClaimDetail: async () => null,
    getClaimConfidence: async () => null,
    getScreenshotUrl: async () => ({ url: null }),
    approvePriceMatch: async () => ({ success: false }),
    rejectPriceMatch: async () => ({ success: false }),
    previewDiscount: async () => ({}),
    listRetailers: async () => [],
    createRetailer: async () => null,
    updateRetailer: async () => false,
    listBlockedDomains: async () => [],
    createBlockedDomain: async () => null,
    updateBlockedDomain: async () => false,
    getConfig: async () => ({ config: null }),
    updateConfig: async () => false,
    expireStaleClaims: async () => ({ expiredCount: 0 }),
  };

  return fake;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('ProcessPriceDropRefundsUseCase', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo(5);
  });

  it('returns the grantedCount from the repository', async () => {
    const uc = new ProcessPriceDropRefundsUseCase(repo);

    const result = await uc.execute();

    expect(result.grantedCount).toBe(5);
  });

  it('returns zero when no refunds were granted', async () => {
    const zeroRepo = makeRepo(0);
    const uc = new ProcessPriceDropRefundsUseCase(zeroRepo);

    const result = await uc.execute();

    expect(result.grantedCount).toBe(0);
  });

  it('delegates exactly once to processPriceDropRefunds', async () => {
    const uc = new ProcessPriceDropRefundsUseCase(repo);

    await uc.execute();

    expect(repo.processCallCount).toBe(1);
  });
});
