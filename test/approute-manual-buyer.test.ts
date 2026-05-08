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
