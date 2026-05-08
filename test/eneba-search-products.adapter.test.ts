import { describe, expect, it, vi } from 'vitest';
import type { EnebaGraphQLClient } from '../src/infra/marketplace/eneba/graphql-client.js';
import { EnebaAdapter } from '../src/infra/marketplace/eneba/adapter.js';

describe('EnebaAdapter.searchProducts', () => {
  it('hydrates prices from batched S_competition after S_products (non-sandbox)', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({
        S_products: {
          edges: [
            {
              node: {
                id: 'prod-a',
                name: 'Xbox Gift TRY',
                slug: 'g',
                regions: [{ code: 'TR' }],
                drm: { slug: 'xbox' },
                type: { value: 'gift' },
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
          totalCount: 1,
        },
      })
      .mockResolvedValueOnce({
        S_competition: [
          {
            productId: 'prod-a',
            competition: {
              edges: [
                {
                  node: {
                    belongsToYou: false,
                    merchantName: 'Mid',
                    price: { amount: 597, currency: 'EUR' },
                  },
                },
                {
                  node: {
                    belongsToYou: false,
                    merchantName: 'Lowest',
                    price: { amount: 512, currency: 'EUR' },
                  },
                },
              ],
            },
          },
        ],
      });

    const adapter = new EnebaAdapter({ execute } as unknown as EnebaGraphQLClient, {
      baseUrl: 'https://api-prod.eneba.com',
      clientId: 'production-eneba-client',
    });

    const hits = await adapter.searchProducts('xbox try', 5);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.priceCents).toBe(512);
    expect(hits[0]?.currency).toBe('EUR');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('skips S_competition in sandbox and leaves prices at zero', async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      S_products: {
        edges: [
          {
            node: {
              id: 'prod-b',
              name: 'Sandbox card',
              slug: 's',
              regions: [],
              drm: null,
              type: null,
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    });

    const adapter = new EnebaAdapter({ execute } as unknown as EnebaGraphQLClient, {
      baseUrl: 'https://sandbox.eneba.com',
      clientId: 'not-used',
    });

    const hits = await adapter.searchProducts('card');
    expect(hits[0]?.priceCents).toBe(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
