import { describe, expect, it, vi } from 'vitest';
import type { MarketplaceHttpClient } from '../src/infra/marketplace/_shared/marketplace-http.js';
import { MarketplaceApiError } from '../src/infra/marketplace/_shared/marketplace-http.js';
import { AppRoutePublicApi } from '../src/infra/marketplace/approute/app-route-public-api.js';
import {
  AppRouteManualBuyer,
  approuteReferenceUuidFromKey,
} from '../src/infra/procurement/approute-manual-buyer.js';

describe('approuteReferenceUuidFromKey', () => {
  it('returns a stable UUID-shaped reference for the same key material', () => {
    expect(approuteReferenceUuidFromKey('manual-var-req')).toBe(approuteReferenceUuidFromKey('manual-var-req'));
  });
});

describe('AppRouteManualBuyer.preflightSufficientBalance', () => {
  it('passes when spendable major units cover required cents', async () => {
    const http = { get: vi.fn(), post: vi.fn() } as unknown as MarketplaceHttpClient;
    const api = {
      getAccounts: vi.fn().mockResolvedValue({
        items: [{ currency: 'USD', available: 50, overdraftLimit: 0 }],
      }),
    };
    const buyer = new AppRouteManualBuyer(api as never, http);
    const out = await buyer.preflightSufficientBalance(4999, 'usd');
    expect(out.ok).toBe(true);
    expect(api.getAccounts).toHaveBeenCalledTimes(1);
  });

  it('fails when available balance is below required cents', async () => {
    const http = { get: vi.fn(), post: vi.fn() } as unknown as MarketplaceHttpClient;
    const api = {
      getAccounts: vi.fn().mockResolvedValue({
        items: [{ currency: 'USD', available: 49.98, overdraftLimit: 0 }],
      }),
    };
    const buyer = new AppRouteManualBuyer(api as never, http);
    const out = await buyer.preflightSufficientBalance(5000, 'USD');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Insufficient AppRoute funds/);
  });

  it('fails when GET accounts throws', async () => {
    const http = { get: vi.fn(), post: vi.fn() } as unknown as MarketplaceHttpClient;
    const api = {
      getAccounts: vi.fn().mockRejectedValue(new Error('network down')),
    };
    const buyer = new AppRouteManualBuyer(api as never, http);
    const out = await buyer.preflightSufficientBalance(100, 'USD');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/wallet lookup failed/);
  });
});

describe('AppRouteManualBuyer', () => {
  it('creates an order, polls until terminal, calls unhide when codes are masked, then returns plaintext keys', async () => {
    const get = vi.fn();
    const post = vi.fn();
    const http = { get, post } as unknown as MarketplaceHttpClient;

    const buyer = new AppRouteManualBuyer(new AppRoutePublicApi(http), http);

    post.mockResolvedValueOnce({
      status: 'OK',
      data: { accepted: true },
    });

    get
      .mockResolvedValueOnce({
        status: 'OK',
        data: { status: 'IN_PROGRESS' },
      })
      .mockResolvedValueOnce({
        status: 'OK',
        data: {
          status: 'SUCCESS',
          orders: [{ vouchers: [{ code: 'ABCD-****-EFGH' }] }],
        },
      })
      .mockResolvedValueOnce({
        status: 'OK',
        data: {
          status: 'SUCCESS',
          orders: [{ vouchers: [{ code: 'KEY-ONE' }, { code: 'KEY-TWO' }] }],
          totalAmountCents: 500,
          currency: 'USD',
        },
      });

    const result = await buyer.purchase('denom-99', 2, 'manual-variant-req');

    expect(result.success).toBe(true);
    expect(result.keys).toEqual(['KEY-ONE', 'KEY-TWO']);
    expect(result.cost_cents).toBe(500);
    expect(post).toHaveBeenCalledWith(
      'orders',
      expect.objectContaining({
        ordersType: 'shop',
        orders: [{ denominationId: 'denom-99', quantity: 2 }],
      }),
    );
    expect(get.mock.calls.some((c) => String(c[0]).includes('unhide=true'))).toBe(true);
  });

  it('continues after POST when message indicates IDEMPOTENCY_REPLAY', async () => {
    const get = vi.fn();
    const post = vi.fn().mockRejectedValue(
      new MarketplaceApiError(
        'conflict',
        'approute',
        409,
        '{"errors":[{"code":"IDEMPOTENCY_REPLAY"}]}',
      ),
    );
    const http = { get, post } as unknown as MarketplaceHttpClient;
    const buyer = new AppRouteManualBuyer(new AppRoutePublicApi(http), http);

    get.mockResolvedValue({
      status: 'OK',
      data: { status: 'SUCCESS', voucherCode: 'REPLAY-CODE' },
    });

    const result = await buyer.purchase('d1', 1, 'idem-key');
    expect(result.success).toBe(true);
    expect(result.keys).toEqual(['REPLAY-CODE']);
  });
});
