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
