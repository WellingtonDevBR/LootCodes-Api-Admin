import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  BuyerWalletSnapshotter,
  type BuyerWalletProviderProbe,
} from '../src/infra/procurement/buyer/buyer-wallet-snapshotter.js';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { getSpendableCentsFromSnapshot } from '../src/core/ports/buyer-wallet-snapshot.port.js';

class StubDb implements Partial<IDatabase> {
  constructor(
    private readonly accounts: ReadonlyArray<{
      id: string;
      provider_code: string | null;
      is_enabled: boolean | null;
      supports_seller: boolean | null;
    }>,
  ) {}
  query = vi.fn(async (table: string) => {
    if (table !== 'provider_accounts') return [];
    return [...this.accounts];
  });
}

class StubProbe implements BuyerWalletProviderProbe {
  constructor(
    readonly providerCode: string,
    private readonly perAccount: Map<string, ReadonlyMap<string, number>>,
  ) {}
  async fetch(providerAccountId: string): Promise<ReadonlyMap<string, number>> {
    const map = this.perAccount.get(providerAccountId);
    if (!map) throw new Error(`unexpected account ${providerAccountId}`);
    return map;
  }
}

class FailingProbe implements BuyerWalletProviderProbe {
  constructor(readonly providerCode: string) {}
  async fetch(): Promise<ReadonlyMap<string, number>> {
    throw new Error('vendor API down');
  }
}

describe('BuyerWalletSnapshotter', () => {
  let db: StubDb;

  beforeEach(() => {
    db = new StubDb([
      { id: 'acct-bamboo', provider_code: 'bamboo', is_enabled: true, supports_seller: false },
      { id: 'acct-approute', provider_code: 'approute', is_enabled: true, supports_seller: false },
      // sell-only account — must be skipped
      { id: 'acct-eneba', provider_code: 'eneba', is_enabled: true, supports_seller: true },
      // disabled — must be skipped
      { id: 'acct-bamboo-old', provider_code: 'bamboo', is_enabled: false, supports_seller: false },
    ]);
  });

  it('combines Bamboo + AppRoute wallets keyed by provider_account_id', async () => {
    const bambooProbe = new StubProbe(
      'bamboo',
      new Map([
        ['acct-bamboo', new Map([['USD', 50_000], ['EUR', 30_000]])],
      ]),
    );
    const approuteProbe = new StubProbe(
      'approute',
      new Map([
        ['acct-approute', new Map([['EUR', 12_000]])],
      ]),
    );

    const snapshotter = new BuyerWalletSnapshotter(db as unknown as IDatabase, [
      bambooProbe,
      approuteProbe,
    ]);

    const snap = await snapshotter.snapshot();

    expect(snap.size).toBe(2);
    expect(getSpendableCentsFromSnapshot(snap, 'acct-bamboo', 'USD')).toBe(50_000);
    expect(getSpendableCentsFromSnapshot(snap, 'acct-bamboo', 'EUR')).toBe(30_000);
    expect(getSpendableCentsFromSnapshot(snap, 'acct-approute', 'EUR')).toBe(12_000);
    // Currency we don't have credit in
    expect(getSpendableCentsFromSnapshot(snap, 'acct-approute', 'USD')).toBe(0);
    // Account that should not be probed
    expect(getSpendableCentsFromSnapshot(snap, 'acct-eneba', 'USD')).toBe(0);
  });

  it('skips disabled and sell-only accounts when querying providers', async () => {
    const bambooProbe = new StubProbe(
      'bamboo',
      new Map([
        ['acct-bamboo', new Map([['USD', 1_000]])],
      ]),
    );

    const snapshotter = new BuyerWalletSnapshotter(db as unknown as IDatabase, [bambooProbe]);
    const snap = await snapshotter.snapshot();

    expect(snap.has('acct-bamboo')).toBe(true);
    expect(snap.has('acct-bamboo-old')).toBe(false);
    expect(snap.has('acct-eneba')).toBe(false);
  });

  it('tolerates probe failure: failed provider becomes empty, others still populate', async () => {
    const bambooProbe = new FailingProbe('bamboo');
    const approuteProbe = new StubProbe(
      'approute',
      new Map([
        ['acct-approute', new Map([['EUR', 5_000]])],
      ]),
    );

    const snapshotter = new BuyerWalletSnapshotter(db as unknown as IDatabase, [
      bambooProbe,
      approuteProbe,
    ]);

    const snap = await snapshotter.snapshot();

    // Bamboo present but empty (no credit)
    expect(snap.get('acct-bamboo')?.size ?? 0).toBe(0);
    expect(getSpendableCentsFromSnapshot(snap, 'acct-bamboo', 'USD')).toBe(0);
    // AppRoute populated
    expect(getSpendableCentsFromSnapshot(snap, 'acct-approute', 'EUR')).toBe(5_000);
  });

  it('skips providers with no probe wired', async () => {
    // Only bamboo probe; AppRoute account in DB has no probe → silently skipped
    const bambooProbe = new StubProbe(
      'bamboo',
      new Map([
        ['acct-bamboo', new Map([['USD', 1_000]])],
      ]),
    );
    const snapshotter = new BuyerWalletSnapshotter(db as unknown as IDatabase, [bambooProbe]);

    const snap = await snapshotter.snapshot();

    expect(snap.has('acct-bamboo')).toBe(true);
    expect(snap.has('acct-approute')).toBe(false);
  });

  it('returns empty snapshot when DB query fails', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));
    const snapshotter = new BuyerWalletSnapshotter(db as unknown as IDatabase, []);

    const snap = await snapshotter.snapshot();

    expect(snap.size).toBe(0);
  });

  it('normalizes currency codes to upper-case ISO when reading the snapshot', async () => {
    const bambooProbe = new StubProbe(
      'bamboo',
      new Map([
        // probe returns lowercase — snapshotter MUST normalize
        ['acct-bamboo', new Map([['usd', 1_500]])],
      ]),
    );
    const snapshotter = new BuyerWalletSnapshotter(db as unknown as IDatabase, [bambooProbe]);

    const snap = await snapshotter.snapshot();

    expect(getSpendableCentsFromSnapshot(snap, 'acct-bamboo', 'USD')).toBe(1_500);
    expect(getSpendableCentsFromSnapshot(snap, 'acct-bamboo', 'usd')).toBe(1_500);
  });
});
