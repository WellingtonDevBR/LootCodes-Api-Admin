import { describe, expect, it, beforeEach } from 'vitest';
import { ExpirePriceMatchClaimsUseCase } from '../src/core/use-cases/price-match/expire-price-match-claims.use-case.js';
import type { IAdminPriceMatchRepository } from '../src/core/ports/admin-price-match-repository.port.js';
import type { ExpirePriceMatchClaimsResult } from '../src/core/use-cases/price-match/price-match.types.js';

// ─── Fake ─────────────────────────────────────────────────────────────

function makeRepo(expiredCount = 0): IAdminPriceMatchRepository & {
  expireCallCount: number;
} {
  let expireCallCount = 0;

  const fake: IAdminPriceMatchRepository & { expireCallCount: number } = {
    get expireCallCount() {
      return expireCallCount;
    },
    async expireStaleClaims(): Promise<ExpirePriceMatchClaimsResult> {
      expireCallCount += 1;
      return { expiredCount };
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
    processPriceDropRefunds: async () => ({ grantedCount: 0 }),
  };

  return fake;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('ExpirePriceMatchClaimsUseCase', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo(3);
  });

  it('returns the expiredCount from the repository', async () => {
    const uc = new ExpirePriceMatchClaimsUseCase(repo);

    const result = await uc.execute();

    expect(result.expiredCount).toBe(3);
  });

  it('returns zero when no claims have expired', async () => {
    const zeroRepo = makeRepo(0);
    const uc = new ExpirePriceMatchClaimsUseCase(zeroRepo);

    const result = await uc.execute();

    expect(result.expiredCount).toBe(0);
  });

  it('delegates exactly once to expireStaleClaims', async () => {
    const uc = new ExpirePriceMatchClaimsUseCase(repo);

    await uc.execute();

    expect(repo.expireCallCount).toBe(1);
  });
});
