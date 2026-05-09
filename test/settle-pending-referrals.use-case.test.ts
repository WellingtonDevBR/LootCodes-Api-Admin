import { describe, expect, it, beforeEach } from 'vitest';
import { SettlePendingReferralsUseCase } from '../src/core/use-cases/referrals/settle-pending-referrals.use-case.js';
import type { IAdminReferralRepository } from '../src/core/ports/admin-referral-repository.port.js';
import type { SettlePendingBatchResult } from '../src/core/use-cases/referrals/referral.types.js';

// ─── Fake ─────────────────────────────────────────────────────────────

function makeRepo(result: SettlePendingBatchResult): IAdminReferralRepository & {
  lastBatchSize: number | null;
  callCount: number;
} {
  let lastBatchSize: number | null = null;
  let callCount = 0;

  return {
    get lastBatchSize() {
      return lastBatchSize;
    },
    get callCount() {
      return callCount;
    },
    async settlePendingBatch(batchSize: number): Promise<SettlePendingBatchResult> {
      lastBatchSize = batchSize;
      callCount += 1;
      return result;
    },
    // unused stubs
    listReferrals: async () => ({ entries: [], next_cursor: null }),
    listLeaderboard: async () => ({ entries: [], days: 30, limit: 10 }),
    resolveDispute: async () => ({ ok: false, referrer_reversed_cents: 0, referee_reversed_cents: 0 }),
    invalidate: async () => ({ ok: false, referrer_reversed_cents: 0, referee_reversed_cents: 0 }),
    payPrizes: async () => ({ ok: false, period_key: '', granted_count: 0, granted_total_cents: 0 }),
  };
}

const defaultResult: SettlePendingBatchResult = {
  attempted: 10,
  settled: 8,
  stillPending: 1,
  errors: 1,
  minAgeHours: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────

describe('SettlePendingReferralsUseCase', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo(defaultResult);
  });

  it('returns the full batch result from the repository', async () => {
    const uc = new SettlePendingReferralsUseCase(repo);

    const result = await uc.execute({ batchSize: 100 });

    expect(result.attempted).toBe(10);
    expect(result.settled).toBe(8);
    expect(result.stillPending).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.minAgeHours).toBe(0);
  });

  it('passes the provided batchSize to the repository', async () => {
    const uc = new SettlePendingReferralsUseCase(repo);

    await uc.execute({ batchSize: 50 });

    expect(repo.lastBatchSize).toBe(50);
  });

  it('defaults batchSize to 200 when not provided', async () => {
    const uc = new SettlePendingReferralsUseCase(repo);

    await uc.execute({});

    expect(repo.lastBatchSize).toBe(200);
  });

  it('delegates exactly once to settlePendingBatch', async () => {
    const uc = new SettlePendingReferralsUseCase(repo);

    await uc.execute({ batchSize: 200 });

    expect(repo.callCount).toBe(1);
  });

  it('returns zero counts when the batch found nothing to settle', async () => {
    const emptyRepo = makeRepo({ attempted: 0, settled: 0, stillPending: 0, errors: 0, minAgeHours: 0 });
    const uc = new SettlePendingReferralsUseCase(emptyRepo);

    const result = await uc.execute({});

    expect(result.attempted).toBe(0);
    expect(result.settled).toBe(0);
  });
});
