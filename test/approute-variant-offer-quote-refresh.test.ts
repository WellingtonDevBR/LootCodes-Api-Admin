import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getMock: vi.fn(),
}));

vi.mock('../src/infra/marketplace/resolve-provider-secrets.js', () => ({
  resolveProviderSecrets: vi.fn(async () => ({ APPROUTE_API_KEY: 'secret' })),
}));

vi.mock('../src/infra/marketplace/approute/create-app-route-http-client.js', () => ({
  createAppRouteMarketplaceHttpClient: vi.fn(() => ({
    get: hoisted.getMock,
    post: vi.fn(),
  })),
}));

import type { IDatabase } from '../src/core/ports/database.port.js';
import { refreshAppRouteOfferSnapshotsForVariant } from '../src/infra/procurement/approute-variant-offer-quote-refresh.js';

describe('refreshAppRouteOfferSnapshotsForVariant', () => {
  beforeEach(() => {
    hoisted.getMock.mockReset();
  });

  it('calls GET services/{parentId} and persists quote fields on the linked offer', async () => {
    hoisted.getMock.mockResolvedValue({
      status: 'SUCCESS',
      statusCode: 0,
      data: {
        id: 'svc-1',
        name: 'Steam',
        items: [{ id: 'den-a', price: 11.5, currency: 'USD', inStock: 4 }],
      },
    });

    const update = vi.fn().mockResolvedValue([]);
    const db = { update } as unknown as IDatabase;

    const offers = [
      {
        id: 'of-1',
        provider_account_id: 'acc-ar',
        external_offer_id: 'den-a',
        external_parent_product_id: 'svc-1',
        currency: 'USD',
        last_price_cents: 1,
        available_quantity: null as number | null,
      },
    ];

    const accountsById = new Map([
      [
        'acc-ar',
        {
          id: 'acc-ar',
          provider_code: 'approute',
          api_profile: { base_url: 'https://x.example/api/v1' },
        },
      ],
    ]);

    await refreshAppRouteOfferSnapshotsForVariant(db, offers, accountsById, {});

    expect(hoisted.getMock).toHaveBeenCalledWith('services/svc-1');
    expect(update).toHaveBeenCalledWith(
      'provider_variant_offers',
      { id: 'of-1' },
      expect.objectContaining({
        last_price_cents: 1150,
        available_quantity: 4,
        currency: 'USD',
      }),
    );
    expect(offers[0]?.last_price_cents).toBe(1150);
    expect(offers[0]?.available_quantity).toBe(4);
  });

  it('resolves parent id from provider_product_catalog when the offer row lacks it', async () => {
    hoisted.getMock.mockResolvedValue({
      status: 'SUCCESS',
      statusCode: 0,
      data: {
        id: 'svc-cat',
        items: [{ id: 'den-x', price: 2, currency: 'USD', inStock: true }],
      },
    });

    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'provider_product_catalog') {
        return [{ external_parent_product_id: 'svc-cat', slug: null }];
      }
      return [];
    });
    const update = vi.fn().mockResolvedValue([]);
    const db = { query, update } as unknown as IDatabase;

    const offers = [
      {
        id: 'of-2',
        provider_account_id: 'acc-ar',
        external_offer_id: 'den-x',
        external_parent_product_id: null as string | null,
        currency: 'USD',
        last_price_cents: 0,
        available_quantity: null as number | null,
      },
    ];

    const accountsById = new Map([
      [
        'acc-ar',
        {
          id: 'acc-ar',
          provider_code: 'approute',
          api_profile: { base_url: 'https://x.example/api/v1' },
        },
      ],
    ]);

    await refreshAppRouteOfferSnapshotsForVariant(db, offers, accountsById, {});

    expect(query).toHaveBeenCalledWith(
      'provider_product_catalog',
      expect.objectContaining({
        filter: { provider_account_id: 'acc-ar', external_product_id: 'den-x' },
      }),
    );
    expect(hoisted.getMock).toHaveBeenCalledWith('services/svc-cat');
    expect(update).toHaveBeenCalledWith(
      'provider_variant_offers',
      { id: 'of-2' },
      expect.objectContaining({
        external_parent_product_id: 'svc-cat',
        last_price_cents: 200,
        available_quantity: 1,
      }),
    );
    expect(offers[0]?.external_parent_product_id).toBe('svc-cat');
  });

  it('returns early when provider_code filter excludes approute', async () => {
    const update = vi.fn();
    const db = { update } as unknown as IDatabase;

    await refreshAppRouteOfferSnapshotsForVariant(
      db,
      [
        {
          id: 'x',
          provider_account_id: 'acc-ar',
          external_offer_id: 'd',
          external_parent_product_id: 'p',
          currency: 'USD',
          last_price_cents: 1,
          available_quantity: 1,
        },
      ],
      new Map([
        ['acc-ar', { id: 'acc-ar', provider_code: 'approute', api_profile: {} }],
      ]),
      { providerCodeFilter: 'bamboo' },
    );

    expect(hoisted.getMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
