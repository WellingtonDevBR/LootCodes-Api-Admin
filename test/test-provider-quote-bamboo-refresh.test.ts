import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  quoteMock: vi.fn(async () => ({
    price_cents: 150,
    currency: 'EUR',
    available_quantity: 7,
  })),
}));

vi.mock('../src/infra/marketplace/resolve-provider-secrets.js', () => ({
  resolveProviderSecrets: vi.fn(async () => ({
    BAMBOO_CLIENT_ID: 'id',
    BAMBOO_CLIENT_SECRET: 'secret',
  })),
}));

vi.mock('../src/infra/procurement/bamboo-manual-buyer.js', () => ({
  createBambooManualBuyer: vi.fn(() => ({
    quote: hoisted.quoteMock,
  })),
}));

import type { IDatabase } from '../src/core/ports/database.port.js';
import type { IMarketplaceAdapterRegistry } from '../src/core/ports/marketplace-adapter.port.js';
import { SupabaseAdminProcurementRepository } from '../src/infra/procurement/supabase-admin-procurement.repository.js';

describe('SupabaseAdminProcurementRepository.testProviderQuote — Bamboo live refresh', () => {
  beforeEach(() => {
    hoisted.quoteMock.mockClear();
  });

  it('calls Bamboo catalog and persists quote onto linked rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'offer-1',
          provider_account_id: 'acc-bamboo',
          external_offer_id: '1299625',
          currency: 'USD',
          last_price_cents: 10,
          available_quantity: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'acc-bamboo',
          provider_code: 'bamboo',
          display_name: 'Bamboo',
          api_profile: { account_id: 42 },
        },
      ]);

    const update = vi.fn().mockResolvedValue([]);
    const db = { query, update } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.testProviderQuote({
      variant_id: 'var-1',
      admin_id: 'admin-1',
    });

    expect(hoisted.quoteMock).toHaveBeenCalledWith('1299625', 'USD');
    expect(update).toHaveBeenCalledWith(
      'provider_variant_offers',
      { id: 'offer-1' },
      expect.objectContaining({
        last_price_cents: 150,
        available_quantity: 7,
        currency: 'EUR',
      }),
    );
    expect(result.quotes).toEqual([
      {
        provider: 'bamboo',
        price_cents: 150,
        available: true,
        available_quantity: 7,
      },
    ]);
  });

  it('skips Bamboo refresh when dto.provider_code filters to a non-bamboo account', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'o-b',
          provider_account_id: 'acc-bamboo',
          external_offer_id: '999',
          currency: 'USD',
          last_price_cents: 1,
          available_quantity: null,
        },
        {
          id: 'o-e',
          provider_account_id: 'acc-e',
          external_offer_id: null,
          currency: 'USD',
          last_price_cents: 200,
          available_quantity: 5,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'acc-bamboo',
          provider_code: 'bamboo',
          display_name: 'B',
          api_profile: { account_id: 1 },
        },
        { id: 'acc-e', provider_code: 'eneba', display_name: 'E', api_profile: {} },
      ]);

    const update = vi.fn().mockResolvedValue([]);
    const db = { query, update } as unknown as IDatabase;
    const repo = new SupabaseAdminProcurementRepository(db, {} as IMarketplaceAdapterRegistry);

    const result = await repo.testProviderQuote({
      variant_id: 'var-1',
      provider_code: 'eneba',
      admin_id: 'admin-1',
    });

    expect(hoisted.quoteMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.quotes).toEqual([
      {
        provider: 'eneba',
        price_cents: 200,
        available: true,
        available_quantity: 5,
      },
    ]);
  });
});
