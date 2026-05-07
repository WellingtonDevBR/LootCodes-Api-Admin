import { describe, expect, it, vi } from 'vitest';
import type { MarketplaceHttpClient } from '../src/infra/marketplace/_shared/marketplace-http.js';
import { DigisellerMarketplaceAdapter } from '../src/infra/marketplace/digiseller/adapter.js';

describe('DigisellerMarketplaceAdapter.searchProducts', () => {
  it('filters seller-goods rows by query substring', async () => {
    const httpClient = {
      post: vi.fn().mockResolvedValue({
        retval: 0,
        pages: 1,
        rows: [
          { id_goods: 42, name_goods: 'Minecraft Java Edition', price: 19.99, currency: 'USD', in_stock: 1 },
          { id_goods: 43, name_goods: 'Other Game', price: 9.99, currency: 'USD', in_stock: 1 },
        ],
      }),
    };

    const adapter = new DigisellerMarketplaceAdapter(httpClient as unknown as MarketplaceHttpClient, {
      sellerNumericId: 152_200,
    });

    const hits = await adapter.searchProducts('mine', 5);

    expect(httpClient.post).toHaveBeenCalledWith(
      'seller-goods',
      expect.objectContaining({ id_seller: 152_200, page: 1 }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.externalProductId).toBe('42');
    expect(hits[0]?.productName).toContain('Minecraft');
  });

  it('does not call seller-goods when seller id is missing', async () => {
    const httpClient = { post: vi.fn() };
    const adapter = new DigisellerMarketplaceAdapter(httpClient as unknown as MarketplaceHttpClient);

    await expect(adapter.searchProducts('mine')).resolves.toEqual([]);

    expect(httpClient.post).not.toHaveBeenCalled();
  });
});
