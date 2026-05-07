import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IDatabase } from '../src/core/ports/database.port.js';
import { BuyerManualPurchaseService } from '../src/infra/procurement/buyer-manual-purchase.service.js';
import { createBambooManualBuyer } from '../src/infra/procurement/bamboo-manual-buyer.js';
import { resolveProviderSecrets } from '../src/infra/marketplace/resolve-provider-secrets.js';
import { ingestProviderPurchasedKey } from '../src/infra/procurement/ingest-provider-key.js';

vi.mock('../src/infra/procurement/bamboo-manual-buyer.js', () => ({
  createBambooManualBuyer: vi.fn(),
}));

vi.mock('../src/infra/marketplace/resolve-provider-secrets.js', () => ({
  resolveProviderSecrets: vi.fn(),
}));

vi.mock('../src/infra/procurement/ingest-provider-key.js', () => ({
  ingestProviderPurchasedKey: vi.fn(),
  KeyIngestionError: class KeyIngestionError extends Error {
    readonly stage: string;
    constructor(stage: string, message: string) {
      super(message);
      this.name = 'KeyIngestionError';
      this.stage = stage;
    }
  },
}));

const ADMIN_ID = 'aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee';
const VARIANT_ID = 'bbbbbbbb-bbbb-4ccc-bddd-eeeeeeeeeeee';
const ACCOUNT_ID = 'cccccccc-cccc-4ccc-bddd-eeeeeeeeeeee';

describe('BuyerManualPurchaseService', () => {
  const mockedCreateBuyer = vi.mocked(createBambooManualBuyer);
  const mockedSecrets = vi.mocked(resolveProviderSecrets);
  const mockedIngest = vi.mocked(ingestProviderPurchasedKey);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedSecrets.mockResolvedValue({
      BAMBOO_CLIENT_ID: 'client',
      BAMBOO_CLIENT_SECRET: 'secret',
    });
    mockedIngest.mockResolvedValue('ingested-key-id');
  });

  function baseMocks(): IDatabase {
    const queryOne = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'product_variants') {
        return { sales_blocked_at: null, sales_blocked_reason: null };
      }
      if (table === 'provider_accounts') {
        return {
          api_profile: {
            base_url: 'https://api.bamboocardportal.com/api/integration/v1.0',
            base_url_v2: 'https://api.bamboocardportal.com/api/integration/v2.0',
            account_id: 1,
          },
        };
      }
      return null;
    });

    const query = vi.fn().mockImplementation(async (table: string) => {
      if (table === 'platform_settings') {
        return [{ value: { auto_buy_enabled: true, daily_spend_limit_cents: null } }];
      }
      if (table === 'transactions') {
        return [];
      }
      if (table === 'provider_accounts') {
        return [{ id: ACCOUNT_ID }];
      }
      return [];
    });

    const insert = vi.fn().mockResolvedValue({ id: 'attempt-row-id' });
    const update = vi.fn().mockResolvedValue([]);

    return { queryOne, query, insert, update } as unknown as IDatabase;
  }

  it('rejects a non-uuid admin id before touching the database', async () => {
    const db = {
      queryOne: vi.fn(),
      query: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    } as unknown as IDatabase;
    const svc = new BuyerManualPurchaseService(db);
    const result = await svc.execute({
      variant_id: VARIANT_ID,
      provider_code: 'bamboo',
      offer_id: '50',
      quantity: 1,
      admin_id: 'unknown',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/admin user id/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('completes Bamboo purchase, ingests keys, and finalizes the attempt as success', async () => {
    const db = baseMocks();
    const buyer = {
      quote: vi.fn().mockResolvedValue({
        price_cents: 500,
        currency: 'USD',
        available_quantity: 99,
        provider_metadata: { min_face_value: 25 },
      }),
      purchase: vi.fn().mockResolvedValue({
        success: true,
        keys: ['CODE-1'],
        provider_order_ref: 'bamboo-ref',
        cost_cents: 500,
        currency: 'USD',
      }),
    };
    mockedCreateBuyer.mockReturnValue(buyer as never);

    const svc = new BuyerManualPurchaseService(db);
    const result = await svc.execute({
      variant_id: VARIANT_ID,
      provider_code: 'bamboo',
      offer_id: '50',
      quantity: 1,
      admin_id: ADMIN_ID,
    });

    expect(result.success).toBe(true);
    expect(result.key_ids).toEqual(['ingested-key-id']);
    expect(result.purchase_id).toBe('bamboo-ref');
    expect(buyer.quote).toHaveBeenCalledWith('50', 'USD');
    expect(buyer.purchase).toHaveBeenCalledWith(
      '50',
      1,
      expect.any(String),
      expect.objectContaining({
        prefetchedQuote: expect.any(Object),
        walletCurrency: 'USD',
      }),
    );
    expect(mockedIngest).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        variant_id: VARIANT_ID,
        plaintext_key: 'CODE-1',
        supplier_reference: 'bamboo:bamboo-ref',
        created_by: ADMIN_ID,
      }),
      expect.any(String),
    );
    expect(db.insert).toHaveBeenCalledWith(
      'provider_purchase_attempts',
      expect.objectContaining({
        manual_admin_user_id: ADMIN_ID,
        variant_id: VARIANT_ID,
        status: 'pending',
      }),
    );
    expect(db.update).toHaveBeenCalledWith(
      'provider_purchase_attempts',
      { id: 'attempt-row-id' },
      expect.objectContaining({ status: 'success', provider_order_ref: 'bamboo-ref' }),
    );
  });

  it('returns recoverable true when Bamboo times out with an order ref', async () => {
    const db = baseMocks();
    const buyer = {
      quote: vi.fn().mockResolvedValue({
        price_cents: 500,
        currency: 'USD',
        available_quantity: 99,
        provider_metadata: { min_face_value: 25 },
      }),
      purchase: vi.fn().mockResolvedValue({
        success: false,
        provider_order_ref: 'pending-guid',
        error_code: 'ORDER_TIMEOUT',
        error_message: 'timed out',
      }),
    };
    mockedCreateBuyer.mockReturnValue(buyer as never);

    const svc = new BuyerManualPurchaseService(db);
    const result = await svc.execute({
      variant_id: VARIANT_ID,
      provider_code: 'bamboo',
      offer_id: '50',
      quantity: 1,
      admin_id: ADMIN_ID,
    });

    expect(result.success).toBe(false);
    expect(result.recoverable).toBe(true);
    expect(result.provider_order_ref).toBe('pending-guid');
    expect(db.update).toHaveBeenCalledWith(
      'provider_purchase_attempts',
      { id: 'attempt-row-id' },
      expect.objectContaining({ status: 'timeout', error_code: 'ORDER_TIMEOUT' }),
    );
  });

  it('blocks when auto_buy is disabled', async () => {
    const db = baseMocks();
    vi.mocked(db.query).mockImplementation(async (table: string) => {
      if (table === 'platform_settings') {
        return [{ value: { auto_buy_enabled: false } }];
      }
      if (table === 'transactions') return [];
      if (table === 'provider_accounts') return [{ id: ACCOUNT_ID }];
      return [];
    });

    const svc = new BuyerManualPurchaseService(db);
    const result = await svc.execute({
      variant_id: VARIANT_ID,
      provider_code: 'bamboo',
      offer_id: '50',
      quantity: 1,
      admin_id: ADMIN_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Auto-buy is disabled/i);
    expect(mockedCreateBuyer).not.toHaveBeenCalled();
  });
});
