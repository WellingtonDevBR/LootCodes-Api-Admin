import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  bambooQuoteMock: vi.fn(async () => ({
    price_cents: 2500,
    currency: 'USD',
    available_quantity: 50,
    provider_metadata: {},
  })),
  approuteRefreshMock: vi.fn(async () => undefined),
}));

vi.mock('../src/infra/marketplace/resolve-provider-secrets.js', () => ({
  resolveProviderSecrets: vi.fn(async () => ({
    BAMBOO_CLIENT_ID: 'cid',
    BAMBOO_CLIENT_SECRET: 'csecret',
  })),
}));

vi.mock('../src/infra/procurement/bamboo-manual-buyer.js', () => ({
  createBambooManualBuyer: vi.fn(() => ({ quote: hoisted.bambooQuoteMock })),
}));

vi.mock('../src/infra/procurement/approute-variant-offer-quote-refresh.js', () => ({
  refreshAppRouteOfferSnapshotsForVariant: hoisted.approuteRefreshMock,
}));

import type { IDatabase } from '../src/core/ports/database.port.js';
import { BuyerOfferSnapshotSyncService } from '../src/infra/procurement/buyer-offer-snapshot-sync.service.js';

function makeBambooOffer(overrides: Partial<{
  id: string;
  provider_account_id: string;
  external_offer_id: string | null;
  currency: string | null;
  last_price_cents: number | null;
  available_quantity: number | null;
}> = {}) {
  return {
    id: 'offer-1',
    provider_account_id: 'acc-bamboo',
    external_offer_id: '12345',
    currency: 'USD',
    external_parent_product_id: null,
    last_price_cents: 1000,
    available_quantity: 10,
    ...overrides,
  };
}

function makeBambooAccount(overrides: Partial<{
  id: string;
  provider_code: string;
  is_enabled: boolean;
  health_status: string;
}> = {}) {
  return {
    id: 'acc-bamboo',
    provider_code: 'bamboo',
    api_profile: { account_id: 42 },
    is_enabled: true,
    health_status: 'healthy',
    ...overrides,
  };
}

function buildDb(offers: unknown[], accounts: unknown[]): { db: IDatabase; update: ReturnType<typeof vi.fn> } {
  const update = vi.fn().mockResolvedValue([]);
  const db = {
    queryAll: vi.fn()
      .mockResolvedValueOnce(offers)
      .mockResolvedValueOnce(accounts),
    update,
  } as unknown as IDatabase;
  return { db, update };
}

function buildService(db: IDatabase): BuyerOfferSnapshotSyncService {
  // Instantiate directly without DI container for unit tests.
  const svc = new BuyerOfferSnapshotSyncService(db as never);
  return svc;
}

describe('BuyerOfferSnapshotSyncService.syncAll', () => {
  beforeEach(() => {
    hoisted.bambooQuoteMock.mockClear();
    hoisted.approuteRefreshMock.mockClear();
  });

  it('returns zeros immediately when there are no active offers', async () => {
    const db = {
      queryAll: vi.fn().mockResolvedValueOnce([]),
    } as unknown as IDatabase;

    const result = await buildService(db).syncAll('req-empty');

    expect(result.scanned).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('calls Bamboo quote and updates provider_variant_offers for a valid Bamboo offer', async () => {
    const offer = makeBambooOffer();
    const account = makeBambooAccount();
    const { db, update } = buildDb([offer], [account]);

    const result = await buildService(db).syncAll('req-bamboo');

    expect(hoisted.bambooQuoteMock).toHaveBeenCalledWith('12345', 'USD');
    expect(update).toHaveBeenCalledWith(
      'provider_variant_offers',
      { id: 'offer-1' },
      expect.objectContaining({
        last_price_cents: 2500,
        available_quantity: 50,
        currency: 'USD',
      }),
    );
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('updates last_checked_at and updated_at on every successful Bamboo update', async () => {
    const offer = makeBambooOffer();
    const account = makeBambooAccount();
    const { db, update } = buildDb([offer], [account]);

    await buildService(db).syncAll('req-timestamps');

    const payload = update.mock.calls[0]?.[2];
    expect(typeof payload?.last_checked_at).toBe('string');
    expect(typeof payload?.updated_at).toBe('string');
  });

  it('counts Bamboo offer as failed when the quote call throws', async () => {
    hoisted.bambooQuoteMock.mockRejectedValueOnce(new Error('quota exceeded'));

    const offer = makeBambooOffer();
    const account = makeBambooAccount();
    const { db, update } = buildDb([offer], [account]);

    const result = await buildService(db).syncAll('req-fail');

    expect(update).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('skips a Bamboo account when secrets cannot be resolved and counts as failed', async () => {
    const { resolveProviderSecrets } = await import('../src/infra/marketplace/resolve-provider-secrets.js');
    vi.mocked(resolveProviderSecrets).mockRejectedValueOnce(new Error('vault error'));

    const offer = makeBambooOffer();
    const account = makeBambooAccount();
    const { db, update } = buildDb([offer], [account]);

    const result = await buildService(db).syncAll('req-no-secrets');

    expect(update).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('skips disabled Bamboo accounts', async () => {
    const offer = makeBambooOffer();
    const account = makeBambooAccount({ is_enabled: false });
    const { db, update } = buildDb([offer], [account]);

    const result = await buildService(db).syncAll('req-disabled');

    expect(hoisted.bambooQuoteMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('skips unhealthy Bamboo accounts', async () => {
    const offer = makeBambooOffer();
    const account = makeBambooAccount({ health_status: 'degraded' });
    const { db, update } = buildDb([offer], [account]);

    const result = await buildService(db).syncAll('req-unhealthy');

    expect(hoisted.bambooQuoteMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('skips Bamboo offers with no external_offer_id', async () => {
    const offer = makeBambooOffer({ external_offer_id: null });
    const account = makeBambooAccount();
    const { db } = buildDb([offer], [account]);

    const result = await buildService(db).syncAll('req-no-ext-id');

    expect(hoisted.bambooQuoteMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });

  it('delegates AppRoute offers to refreshAppRouteOfferSnapshotsForVariant', async () => {
    const approuteOffer = {
      id: 'offer-ar',
      provider_account_id: 'acc-ar',
      external_offer_id: 'den-1',
      external_parent_product_id: 'svc-1',
      currency: 'USD',
      last_price_cents: 1000,
      available_quantity: 5,
    };
    const approuteAccount = {
      id: 'acc-ar',
      provider_code: 'approute',
      api_profile: { base_url: 'https://x.example/api/v1' },
      is_enabled: true,
      health_status: 'healthy',
    };

    // Simulate AppRoute mutation in place (what the real function does on success).
    hoisted.approuteRefreshMock.mockImplementationOnce(async (
      _db: unknown,
      offers: Array<{ last_price_cents: number | null }>,
    ) => {
      offers[0]!.last_price_cents = 1500;
    });

    const { db } = buildDb([approuteOffer], [approuteAccount]);

    const result = await buildService(db).syncAll('req-approute');

    expect(hoisted.approuteRefreshMock).toHaveBeenCalledOnce();
    expect(hoisted.bambooQuoteMock).not.toHaveBeenCalled();
    // Mutation detected: price changed from 1000 → 1500 → counts as updated.
    expect(result.updated).toBe(1);
    expect(result.scanned).toBe(1);
  });

  it('counts an AppRoute offer as not-updated when the refresh does not mutate it', async () => {
    const approuteOffer = {
      id: 'offer-ar-2',
      provider_account_id: 'acc-ar',
      external_offer_id: 'den-2',
      external_parent_product_id: null,
      currency: 'USD',
      last_price_cents: 900,
      available_quantity: null,
    };
    const approuteAccount = {
      id: 'acc-ar',
      provider_code: 'approute',
      api_profile: { base_url: 'https://x.example/api/v1' },
      is_enabled: true,
      health_status: 'healthy',
    };

    // No mutation — function returned without updating (e.g. parent id not found).
    hoisted.approuteRefreshMock.mockResolvedValueOnce(undefined);

    const { db } = buildDb([approuteOffer], [approuteAccount]);

    const result = await buildService(db).syncAll('req-approute-no-update');

    expect(result.updated).toBe(0);
    expect(result.scanned).toBe(1);
  });

  it('processes both Bamboo and AppRoute offers in the same run', async () => {
    const bambooOffer = makeBambooOffer({ id: 'offer-b', provider_account_id: 'acc-b' });
    const approuteOffer = {
      id: 'offer-ar',
      provider_account_id: 'acc-ar',
      external_offer_id: 'den-x',
      external_parent_product_id: 'svc-x',
      currency: 'USD',
      last_price_cents: 300,
      available_quantity: 1,
    };

    const bambooAccount = makeBambooAccount({ id: 'acc-b' });
    const approuteAccount = {
      id: 'acc-ar',
      provider_code: 'approute',
      api_profile: { base_url: 'https://x.example/api/v1' },
      is_enabled: true,
      health_status: 'healthy',
    };

    hoisted.approuteRefreshMock.mockImplementationOnce(async (
      _db: unknown,
      offers: Array<{ last_price_cents: number | null }>,
    ) => {
      offers[0]!.last_price_cents = 400;
    });

    const { db, update } = buildDb([bambooOffer, approuteOffer], [bambooAccount, approuteAccount]);

    const result = await buildService(db).syncAll('req-both');

    // Bamboo: 1 update via db.update
    expect(update).toHaveBeenCalledOnce();
    // AppRoute: delegated to refreshAppRouteOfferSnapshotsForVariant
    expect(hoisted.approuteRefreshMock).toHaveBeenCalledOnce();
    // Both counted as updated
    expect(result.scanned).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('skips offers for unsupported provider codes', async () => {
    const enebaSeller = {
      id: 'offer-eneba',
      provider_account_id: 'acc-eneba',
      external_offer_id: 'prod-1',
      external_parent_product_id: null,
      currency: 'EUR',
      last_price_cents: 1000,
      available_quantity: 5,
    };
    const enebaAccount = {
      id: 'acc-eneba',
      provider_code: 'eneba',
      api_profile: {},
      is_enabled: true,
      health_status: 'healthy',
    };
    const { db } = buildDb([enebaSeller], [enebaAccount]);

    const result = await buildService(db).syncAll('req-unsupported');

    expect(hoisted.bambooQuoteMock).not.toHaveBeenCalled();
    expect(hoisted.approuteRefreshMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.updated).toBe(0);
  });
});
