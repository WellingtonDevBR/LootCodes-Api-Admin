import { describe, expect, it, vi } from 'vitest';
import type { MarketplaceHttpClient } from '../src/infra/marketplace/_shared/marketplace-http.js';
import { AppRoutePublicApi } from '../src/infra/marketplace/approute/app-route-public-api.js';
import { MarketplaceApiError } from '../src/infra/marketplace/_shared/marketplace-http.js';

describe('AppRoutePublicApi.postDtuOrder', () => {
  it('sends ordersType=dtu with referenceId and orders payload', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      statusCode: 0,
      data: {
        orderId: 'order_123',
        status: 'SUCCESS',
        price: 10.5,
        currency: 'USD',
        result: {
          vouchers: null,
          attributes: { reference: 'ref-001', account_reference: 'acct-001' },
        },
      },
    });
    const http = { get: vi.fn(), post } as unknown as MarketplaceHttpClient;
    const api = new AppRoutePublicApi(http);

    const out = await api.postDtuOrder({
      referenceId: 'ref-001',
      orders: [
        {
          denominationId: 'denom-1',
          quantity: 1,
          amountCurrencyCode: 'RUB',
          fields: [
            { key: 'account_reference', value: 'acct-001' },
            { key: 'amount', value: '10' },
          ],
        },
      ],
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('orders');
    expect(body).toEqual({
      ordersType: 'dtu',
      referenceId: 'ref-001',
      orders: [
        {
          denominationId: 'denom-1',
          quantity: 1,
          amountCurrencyCode: 'RUB',
          fields: [
            { key: 'account_reference', value: 'acct-001' },
            { key: 'amount', value: '10' },
          ],
        },
      ],
    });
    expect((out as { orderId: string }).orderId).toBe('order_123');
  });

  it('still unwraps the envelope on idempotency replay (statusCode 2)', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      statusCode: 2,
      statusMessage: 'Idempotent replay',
      data: {
        orderId: 'order_123',
        status: 'SUCCESS',
        price: 10.5,
        currency: 'USD',
        result: { vouchers: null, attributes: { reference: 'ref-001' } },
      },
    });
    const http = { get: vi.fn(), post } as unknown as MarketplaceHttpClient;
    const api = new AppRoutePublicApi(http);

    const out = await api.postDtuOrder({
      referenceId: 'ref-001',
      orders: [
        {
          denominationId: 'denom-1',
          quantity: 1,
        },
      ],
    });

    expect((out as { orderId: string }).orderId).toBe('order_123');
  });

  it('throws MarketplaceApiError when AppRoute returns a validation error envelope', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'CANCELLED',
      statusCode: 3,
      statusMessage: 'Validation error',
      data: null,
      errors: [{ field: 'body', code: 'INVALID_VALUE', message: 'invalid' }],
    });
    const http = { get: vi.fn(), post } as unknown as MarketplaceHttpClient;
    const api = new AppRoutePublicApi(http);

    await expect(
      api.postDtuOrder({
        referenceId: 'bad',
        orders: [{ denominationId: 'd', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(MarketplaceApiError);
  });
});

describe('AppRoutePublicApi.postDtuCheck', () => {
  it('sends ordersType=dtu with checkOnly=true and returns the check result', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      statusCode: 0,
      data: {
        canRecharge: true,
        price: 10.5,
        currency: 'USD',
        providerStatus: 'SUCCESS',
        providerMessage: 'OK',
        attributes: { nickname: 'PlayerOne' },
      },
    });
    const http = { get: vi.fn(), post } as unknown as MarketplaceHttpClient;
    const api = new AppRoutePublicApi(http);

    const out = await api.postDtuCheck({
      orders: [
        {
          denominationId: 'denom-1',
          quantity: 1,
          amountCurrencyCode: 'RUB',
          fields: [
            { key: 'account_reference', value: 'acct-001' },
            { key: 'amount', value: '10' },
          ],
        },
      ],
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('orders');
    expect(body).toMatchObject({
      ordersType: 'dtu',
      checkOnly: true,
      orders: [
        {
          denominationId: 'denom-1',
          quantity: 1,
          amountCurrencyCode: 'RUB',
        },
      ],
    });

    expect(out.canRecharge).toBe(true);
    expect(out.price).toBe(10.5);
    expect(out.currency).toBe('USD');
    expect(out.providerStatus).toBe('SUCCESS');
  });

  it('does NOT include referenceId in the body (DTU check is read-only)', async () => {
    const post = vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      statusCode: 0,
      data: { canRecharge: false, price: 0, currency: 'USD', providerStatus: 'FAIL' },
    });
    const http = { get: vi.fn(), post } as unknown as MarketplaceHttpClient;
    const api = new AppRoutePublicApi(http);

    await api.postDtuCheck({
      orders: [{ denominationId: 'd', quantity: 1 }],
    });

    const [, body] = post.mock.calls[0]!;
    expect(body).not.toHaveProperty('referenceId');
  });
});
