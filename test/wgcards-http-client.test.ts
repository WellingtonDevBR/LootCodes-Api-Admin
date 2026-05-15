import { describe, expect, it, vi, afterEach } from 'vitest';
import { WgcardsAesCrypto } from '../src/infra/procurement/wgcards/wgcards-aes-crypto.js';
import { WgcardsTokenManager } from '../src/infra/procurement/wgcards/wgcards-token-manager.js';
import { WgcardsHttpClient } from '../src/infra/procurement/wgcards/wgcards-http-client.js';

const APP_ID = '2025112058411324';
const ACCOUNT_ID = '100001';
const BASE_URL = 'https://api.wgcards.com';

function makeClient(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const crypto = new WgcardsAesCrypto(APP_ID);
  const tokenManager = new WgcardsTokenManager({
    fetchToken: async () => 'test-token',
    initialCache: { accessToken: 'test-token', expiresAt: Date.now() + 3_600_000 },
  });
  return new WgcardsHttpClient(BASE_URL, APP_ID, ACCOUNT_ID, crypto, tokenManager);
}

function encryptedResponseFor(crypto: WgcardsAesCrypto, data: unknown, code = 200) {
  const envelope = { appId: APP_ID, code, msg: 'success', data };
  const ciphertext = crypto.encrypt(JSON.stringify(envelope));
  return Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(ciphertext),
  } as Response);
}

describe('WgcardsHttpClient', () => {
  const crypto = new WgcardsAesCrypto(APP_ID);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── getToken (no auth header required) ──────────────────────────────────

  describe('getToken', () => {
    it('POSTs to /api/getToken without Authorization header', async () => {
      const fetchMock = vi.fn().mockReturnValue(
        encryptedResponseFor(crypto, 'my-session-token'),
      );
      const client = makeClient(fetchMock);

      const token = await client.getToken('my-app-key');

      expect(token).toBe('my-session-token');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${BASE_URL}/api/getToken`);
      expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
      expect((init.headers as Record<string, string>)['appId']).toBe(APP_ID);
    });

    it('includes appId and appKey in the encrypted msg', async () => {
      const fetchMock = vi.fn().mockReturnValue(
        encryptedResponseFor(crypto, 'token-abc'),
      );
      const client = makeClient(fetchMock);
      await client.getToken('key-xyz');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { appId: string; accountId: string; msg: string };

      expect(body.appId).toBe(APP_ID);
      expect(body.accountId).toBe(ACCOUNT_ID);
      const decrypted = JSON.parse(crypto.decrypt(body.msg)) as { appId: string; appKey: string };
      expect(decrypted.appId).toBe(APP_ID);
      expect(decrypted.appKey).toBe('key-xyz');
    });

    it('throws when API returns non-200 code inside the envelope', async () => {
      const fetchMock = vi.fn().mockReturnValue(
        encryptedResponseFor(crypto, null, 400),
      );
      const client = makeClient(fetchMock);
      await expect(client.getToken('bad-key')).rejects.toThrow('/api/getToken');
    });
  });

  // ─── getAccount ───────────────────────────────────────────────────────────

  describe('getAccount', () => {
    it('returns decrypted wallet account data', async () => {
      const accountData = {
        userId: APP_ID,
        accounts: [{ walletId: 'w1', currency: 'USD', balance: 150.0, effective: true }],
      };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, accountData));
      const client = makeClient(fetchMock);

      const result = await client.getAccount();
      expect(result.userId).toBe(APP_ID);
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]!.currency).toBe('USD');
      expect(result.accounts[0]!.balance).toBe(150.0);
    });

    it('sends Authorization header with cached token', async () => {
      const fetchMock = vi.fn().mockReturnValue(
        encryptedResponseFor(crypto, { userId: APP_ID, accounts: [] }),
      );
      const client = makeClient(fetchMock);
      await client.getAccount();

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-token');
    });
  });

  // ─── getStock ─────────────────────────────────────────────────────────────

  describe('getStock', () => {
    it('returns stock entries for requested skuIds', async () => {
      const stockData = [
        { itemId: 'item1', skuId: 'sku-aaa', number: 50 },
        { itemId: 'item2', skuId: 'sku-bbb', number: -1 },
      ];
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, stockData));
      const client = makeClient(fetchMock);

      const result = await client.getStock(['sku-aaa', 'sku-bbb']);
      expect(result).toHaveLength(2);
      expect(result[0]!.skuId).toBe('sku-aaa');
      expect(result[0]!.number).toBe(50);
      expect(result[1]!.number).toBe(-1);
    });

    it('sends the skuIds in the encrypted msg', async () => {
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, []));
      const client = makeClient(fetchMock);
      await client.getStock(['sku-x', 'sku-y']);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { msg: string };
      const payload = JSON.parse(crypto.decrypt(body.msg)) as { skuIds: string[] };
      expect(payload.skuIds).toEqual(['sku-x', 'sku-y']);
    });
  });

  // ─── placeOrder ──────────────────────────────────────────────────────────

  describe('placeOrder', () => {
    it('returns the orderId from the nested inner envelope', async () => {
      const placeOrderData = { code: 200, data: 'order-12345', message: '' };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, placeOrderData));
      const client = makeClient(fetchMock);

      const orderId = await client.placeOrder({
        serviceOrder: 'idempotency-key-001',
        currency: 'USD',
        items: [{ skuId: 'sku-aaa', buyNum: 1 }],
      });
      expect(orderId).toBe('order-12345');
    });

    it('throws when inner envelope code != 200', async () => {
      const placeOrderData = { code: 500, data: '', message: 'Out of stock' };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, placeOrderData));
      const client = makeClient(fetchMock);

      await expect(
        client.placeOrder({ serviceOrder: 'k', currency: 'USD', items: [{ skuId: 's', buyNum: 1 }] }),
      ).rejects.toThrow('Out of stock');
    });

    it('sends serviceOrder, currency, and items in the encrypted payload', async () => {
      const placeOrderData = { code: 200, data: 'ord-99', message: '' };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, placeOrderData));
      const client = makeClient(fetchMock);

      await client.placeOrder({
        serviceOrder: 'my-idempotency-key',
        currency: 'EUR',
        items: [{ skuId: 'sku-z', buyNum: 3, faceValue: 42.5 }],
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { msg: string };
      const payload = JSON.parse(crypto.decrypt(body.msg)) as {
        appId: string;
        userId: string;
        accountId: string;
        serviceOrder: string;
        currency: string;
        detailVos: Array<{ skuId: string; buyNum: number; faceValue?: number }>;
      };
      expect(payload.appId).toBe(APP_ID);
      expect(payload.userId).toBe(APP_ID);
      expect(payload.accountId).toBe(ACCOUNT_ID);
      expect(payload.serviceOrder).toBe('my-idempotency-key');
      expect(payload.currency).toBe('EUR');
      expect(payload.detailVos).toEqual([{ skuId: 'sku-z', faceValue: 42.5, buyNum: 3 }]);
      expect(Object.keys(payload.detailVos[0]!)).toEqual(['skuId', 'faceValue', 'buyNum']);
    });

    it('coerces skuId to string and truncates buyNum', async () => {
      const placeOrderData = { code: 200, data: 'ord-100', message: '' };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, placeOrderData));
      const client = makeClient(fetchMock);

      await client.placeOrder({
        serviceOrder: 'svc-1',
        currency: 'USD',
        items: [{ skuId: 999888777 as unknown as string, buyNum: 2.9 }],
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { msg: string };
      const payload = JSON.parse(crypto.decrypt(body.msg)) as {
        detailVos: Array<{ skuId: string; buyNum: number }>;
      };
      expect(payload.detailVos).toEqual([{ skuId: '999888777', buyNum: 2 }]);
    });
  });

  // ─── getBuyCard ───────────────────────────────────────────────────────────

  describe('getBuyCard', () => {
    it('returns the card records', async () => {
      const cardData = {
        current: 1,
        pages: 1,
        size: 200,
        total: 2,
        records: [
          { skuId: 'sku-aaa', card: 'XXXX-YYYY-ZZZZ', pinCode: '', snCode: '' },
          { skuId: 'sku-aaa', card: 'AAAA-BBBB-CCCC', pinCode: '1234', snCode: '' },
        ],
      };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, cardData));
      const client = makeClient(fetchMock);

      const result = await client.getBuyCard('order-12345');
      expect(result.total).toBe(2);
      expect(result.records).toHaveLength(2);
      expect(result.records[0]!.card).toBe('XXXX-YYYY-ZZZZ');
    });

    it('passes orderId and pagination to the encrypted payload', async () => {
      const cardData = { current: 2, pages: 3, size: 100, total: 250, records: [] };
      const fetchMock = vi.fn().mockReturnValue(encryptedResponseFor(crypto, cardData));
      const client = makeClient(fetchMock);

      await client.getBuyCard('ord-abc', 2, 100);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { msg: string };
      const payload = JSON.parse(crypto.decrypt(body.msg)) as {
        orderId: string;
        current: number;
        size: number;
      };
      expect(payload.orderId).toBe('ord-abc');
      expect(payload.current).toBe(2);
      expect(payload.size).toBe(100);
    });
  });

  // ─── HTTP error handling ──────────────────────────────────────────────────

  describe('HTTP error handling', () => {
    it('throws when fetch returns a non-ok HTTP status', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      } as Response);
      const client = makeClient(fetchMock);

      await expect(client.getAccount()).rejects.toThrow('WGCards HTTP 503');
    });

    it('surfaces unencrypted API error JSON (code + msg) as an Error', async () => {
      const errorJson = JSON.stringify({ code: 401, msg: 'Unauthorized: token expired' });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(errorJson),
      } as Response);
      const client = makeClient(fetchMock);

      await expect(client.getAccount()).rejects.toThrow('Unauthorized: token expired');
    });

    it('includes a troubleshooting hint when encrypted envelope code is -101', async () => {
      const envelope = { appId: APP_ID, code: -101, msg: '', data: null };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.resolve(crypto.encrypt(JSON.stringify(envelope))),
      } as Response);
      const client = makeClient(fetchMock);

      await expect(client.getAccount()).rejects.toThrow(/WGCards -101 is undocumented/);
    });
  });
});
