import { describe, expect, it, vi, afterEach } from 'vitest';
import { createWgcardsManualBuyer, WgcardsManualBuyer } from '../src/infra/procurement/wgcards/wgcards-manual-buyer.js';
import { WgcardsAesCrypto } from '../src/infra/procurement/wgcards/wgcards-aes-crypto.js';
import type { WgcardsBuyCardData } from '../src/infra/procurement/wgcards/wgcards-http-client.js';

const VALID_SECRETS = {
  WGCARDS_APP_ID: '2025112058411324',
  WGCARDS_APP_KEY: 'test-app-key-here',
  WGCARDS_ACCOUNT_ID: '100001',
};

const VALID_PROFILE = { base_url: 'https://api.wgcards.com' };

// ─── Factory ─────────────────────────────────────────────────────────────────

describe('createWgcardsManualBuyer', () => {
  it('returns null when WGCARDS_APP_ID is missing', () => {
    const { WGCARDS_APP_ID: _, ...rest } = VALID_SECRETS;
    expect(createWgcardsManualBuyer({ secrets: rest, profile: VALID_PROFILE })).toBeNull();
  });

  it('returns null when WGCARDS_APP_KEY is missing', () => {
    const { WGCARDS_APP_KEY: _, ...rest } = VALID_SECRETS;
    expect(createWgcardsManualBuyer({ secrets: rest, profile: VALID_PROFILE })).toBeNull();
  });

  it('returns null when WGCARDS_ACCOUNT_ID is missing', () => {
    const { WGCARDS_ACCOUNT_ID: _, ...rest } = VALID_SECRETS;
    expect(createWgcardsManualBuyer({ secrets: rest, profile: VALID_PROFILE })).toBeNull();
  });

  it('returns null when secrets are completely empty', () => {
    expect(createWgcardsManualBuyer({ secrets: {}, profile: VALID_PROFILE })).toBeNull();
  });

  it('returns null when WGCARDS_APP_ID has wrong byte length for AES-128', () => {
    const secrets = { ...VALID_SECRETS, WGCARDS_APP_ID: 'tooshort' };
    expect(createWgcardsManualBuyer({ secrets, profile: VALID_PROFILE })).toBeNull();
  });

  it('returns a WgcardsManualBuyer instance with valid credentials', () => {
    const buyer = createWgcardsManualBuyer({ secrets: VALID_SECRETS, profile: VALID_PROFILE });
    expect(buyer).not.toBeNull();
    expect(buyer).toBeInstanceOf(WgcardsManualBuyer);
  });

  it('uses https://api.wgcards.com as the default base_url when not in profile', () => {
    const buyer = createWgcardsManualBuyer({ secrets: VALID_SECRETS, profile: {} });
    expect(buyer).not.toBeNull(); // resolves without error — URL is not exposed externally
  });

  it('accepts sandbox base_url from profile', () => {
    const profile = { base_url: 'http://115.29.241.36:9009' };
    const buyer = createWgcardsManualBuyer({ secrets: VALID_SECRETS, profile });
    expect(buyer).not.toBeNull();
  });

  it('trims whitespace from secret values', () => {
    const secrets = {
      WGCARDS_APP_ID: '  2025112058411324  ',
      WGCARDS_APP_KEY: '  key  ',
      WGCARDS_ACCOUNT_ID: '  100001  ',
    };
    const buyer = createWgcardsManualBuyer({ secrets, profile: VALID_PROFILE });
    expect(buyer).not.toBeNull();
  });

  it('accepts initialTokenCache to warm the token manager without a network call', () => {
    const future = Date.now() + 3_600_000;
    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'warm-token', expiresAt: future },
    });
    expect(buyer).not.toBeNull();
  });
});

// ─── WgcardsManualBuyer.quote ─────────────────────────────────────────────────

describe('WgcardsManualBuyer.quote', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClientMock(stockData: unknown) {
    const crypto = new WgcardsAesCrypto('2025112058411324');
    const envelope = { appId: '2025112058411324', code: 200, msg: 'success', data: stockData };
    const ciphertext = crypto.encrypt(JSON.stringify(envelope));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(ciphertext),
    } as Response));
  }

  it('returns available_quantity from getStock response', async () => {
    makeClientMock([{ itemId: 'i1', skuId: 'sku-aaa', number: 30 }]);
    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const result = await buyer.quote('sku-aaa');
    expect(result.available_quantity).toBe(30);
    expect(result.price_cents).toBe(0); // WGCards getStock doesn't return price
    expect(result.currency).toBe('USD');
  });

  it('returns null available_quantity when stock is -1 (unlimited)', async () => {
    makeClientMock([{ itemId: 'i2', skuId: 'sku-unlimited', number: -1 }]);
    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const result = await buyer.quote('sku-unlimited');
    expect(result.available_quantity).toBeNull();
  });

  it('throws when skuId is not in getStock response', async () => {
    makeClientMock([{ itemId: 'i3', skuId: 'different-sku', number: 5 }]);
    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    await expect(buyer.quote('sku-not-found')).rejects.toThrow('skuId sku-not-found not found');
  });
});

// ─── WgcardsManualBuyer.getSkuCheckoutMeta ────────────────────────────────────

describe('WgcardsManualBuyer.getSkuCheckoutMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSequentialItemAndStockPages(pages: unknown[]) {
    const crypto = new WgcardsAesCrypto('2025112058411324');
    let callIndex = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const data = pages[callIndex++] ?? pages[pages.length - 1];
      const envelope = { appId: '2025112058411324', code: 200, msg: 'success', data };
      const ct = crypto.encrypt(JSON.stringify(envelope));
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(ct),
      } as Response);
    }));
  }

  function itemPageForParent(
    parentId: string,
    skus: Array<{
      skuId: string;
      skuPriceCurrency: string;
      minFaceValue: number;
      maxFaceValue: number;
    }>,
  ) {
    return {
      current: 1,
      pages: 1,
      size: 200,
      total: 1,
      records: [
        {
          itemId: parentId,
          itemName: 'Test item',
          itemTitle: 'Test item',
          itemBrandName: 'Brand',
          currencyCode: 'USD',
          spuImage: null,
          spuType: 2,
          skuInfos: skus.map((s) => ({
            skuId: s.skuId,
            skuName: 'SKU',
            skuPrice: 100,
            skuPriceCurrency: s.skuPriceCurrency,
            maxFaceValue: s.maxFaceValue,
            minFaceValue: s.minFaceValue,
            maxPrice: 0,
            minPrice: 0,
            stock: 10,
          })),
        },
      ],
    };
  }

  it('uses skuPriceCurrency as payCurrency and re-queries getItemAndStock when it differs from the hint', async () => {
    const pageUsd = itemPageForParent('parent-1', [
      { skuId: 'sku-fixed', skuPriceCurrency: 'CNY', minFaceValue: 10, maxFaceValue: 10 },
    ]);
    const pageCny = itemPageForParent('parent-1', [
      { skuId: 'sku-fixed', skuPriceCurrency: 'CNY', minFaceValue: 10, maxFaceValue: 10 },
    ]);
    stubSequentialItemAndStockPages([pageUsd, pageCny]);

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const meta = await buyer.getSkuCheckoutMeta('parent-1', 'sku-fixed', 'USD');
    expect(meta).toEqual({
      payCurrency: 'CNY',
      faceValue: 10,
      minFaceValue: 10,
      maxFaceValue: 10,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('omits faceValue when minFaceValue and maxFaceValue are both zero (supplier sent no fixed denomination)', async () => {
    const page = itemPageForParent('parent-zero', [
      { skuId: 'sku-zero-bounds', skuPriceCurrency: 'USD', minFaceValue: 0, maxFaceValue: 0 },
    ]);
    stubSequentialItemAndStockPages([page]);

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const meta = await buyer.getSkuCheckoutMeta('parent-zero', 'sku-zero-bounds', 'USD');
    expect(meta).toEqual({
      payCurrency: 'USD',
      minFaceValue: 0,
      maxFaceValue: 0,
    });
  });

  it('omits faceValue when minFaceValue and maxFaceValue differ (custom denomination)', async () => {
    const page = itemPageForParent('parent-2', [
      { skuId: 'sku-range', skuPriceCurrency: 'USD', minFaceValue: 5, maxFaceValue: 500 },
    ]);
    stubSequentialItemAndStockPages([page]);

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const meta = await buyer.getSkuCheckoutMeta('parent-2', 'sku-range', 'USD');
    expect(meta).toEqual({ payCurrency: 'USD', minFaceValue: 5, maxFaceValue: 500 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('matches skuId when the API returns it as a number (JSON coercion)', async () => {
    const page = {
      current: 1,
      pages: 1,
      size: 200,
      total: 1,
      records: [
        {
          itemId: 'parent-num',
          itemName: 'Test item',
          itemTitle: 'Test item',
          itemBrandName: 'Brand',
          currencyCode: 'USD',
          spuImage: null,
          spuType: 2,
          skuInfos: [
            {
              skuId: 2024100660466242 as unknown as string,
              skuName: 'SKU',
              skuPrice: 100,
              skuPriceCurrency: 'CNY',
              maxFaceValue: 20,
              minFaceValue: 20,
              maxPrice: 0,
              minPrice: 0,
              stock: 10,
            },
          ],
        },
      ],
    };
    stubSequentialItemAndStockPages([page, page]);

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const meta = await buyer.getSkuCheckoutMeta('parent-num', '2024100660466242', 'USD');
    expect(meta).toEqual({
      payCurrency: 'CNY',
      faceValue: 20,
      minFaceValue: 20,
      maxFaceValue: 20,
    });
  });

  it('returns null when the skuId is not present under the parent', async () => {
    const page = itemPageForParent('parent-3', [
      { skuId: 'other', skuPriceCurrency: 'USD', minFaceValue: 1, maxFaceValue: 1 },
    ]);
    stubSequentialItemAndStockPages([page, page]); // retry with USD after hint path

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const meta = await buyer.getSkuCheckoutMeta('parent-3', 'missing-sku', 'USD');
    expect(meta).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

// ─── WgcardsManualBuyer.purchase — polling ────────────────────────────────────

describe('WgcardsManualBuyer.purchase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCryptoResponses(responses: unknown[]) {
    const crypto = new WgcardsAesCrypto('2025112058411324');
    let callIndex = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const data = responses[callIndex++] ?? responses[responses.length - 1];
      const envelope = { appId: '2025112058411324', code: 200, msg: 'success', data };
      const ct = crypto.encrypt(JSON.stringify(envelope));
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(ct),
      } as Response);
    }));
  }

  it('returns success with keys on first successful poll', async () => {
    vi.useFakeTimers();

    const placeOrderResp = { code: 200, data: 'ord-001', message: '' };
    const cardResp: WgcardsBuyCardData = {
      current: 1, pages: 1, size: 200, total: 1,
      records: [{ skuId: 'sku-aaa', card: 'KEY-1234-5678', pinCode: '', snCode: '' }],
    };

    stubCryptoResponses([placeOrderResp, cardResp]);

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const purchasePromise = buyer.purchase({
      serviceOrder: 'idem-key',
      currency: 'USD',
      items: [{ skuId: 'sku-aaa', buyNum: 1 }],
    });

    await vi.runAllTimersAsync();
    const result = await purchasePromise;

    expect(result.success).toBe(true);
    expect(result.orderId).toBe('ord-001');
    expect(result.keys).toEqual(['KEY-1234-5678']);

    vi.useRealTimers();
  });

  it('returns failure with recoverable:true when placeOrder succeeds but cards never arrive', async () => {
    vi.useFakeTimers();

    const placeOrderResp = { code: 200, data: 'ord-002', message: '' };
    const emptyCardResp: WgcardsBuyCardData = {
      current: 1, pages: 1, size: 200, total: 0, records: [],
    };

    stubCryptoResponses([placeOrderResp, ...Array(20).fill(emptyCardResp)]);

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const purchasePromise = buyer.purchase({
      serviceOrder: 'idem-key-2',
      currency: 'USD',
      items: [{ skuId: 'sku-aaa', buyNum: 1 }],
    });

    // Advance time past all poll intervals
    await vi.runAllTimersAsync();
    const result = await purchasePromise;

    expect(result.success).toBe(false);
    expect(result.orderId).toBe('ord-002');
    expect(result.recoverable).toBe(true);

    vi.useRealTimers();
  });

  it('returns failure with recoverable:false when placeOrder itself fails', async () => {
    const placeOrderErrorResp = { code: 500, data: '', message: 'Out of stock' };
    const crypto = new WgcardsAesCrypto('2025112058411324');
    const outerEnvelope = {
      appId: '2025112058411324', code: 200, msg: 'success', data: placeOrderErrorResp,
    };
    const ct = crypto.encrypt(JSON.stringify(outerEnvelope));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(ct),
    } as Response));

    const buyer = createWgcardsManualBuyer({
      secrets: VALID_SECRETS,
      profile: VALID_PROFILE,
      initialTokenCache: { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 },
    })!;

    const result = await buyer.purchase({
      serviceOrder: 'fail-key',
      currency: 'USD',
      items: [{ skuId: 'sku-x', buyNum: 1 }],
    });

    expect(result.success).toBe(false);
    expect(result.recoverable).toBe(false);
    expect(result.error).toMatch(/Out of stock/);
  });
});
