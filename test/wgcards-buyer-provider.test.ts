import { describe, expect, it, vi } from 'vitest';
import { WgcardsBuyerProvider } from '../src/infra/procurement/wgcards/wgcards-buyer-provider.js';
import type { WgcardsManualBuyer } from '../src/infra/procurement/wgcards/wgcards-manual-buyer.js';
import type { BuyerManualPurchaseService } from '../src/infra/procurement/buyer-manual-purchase.service.js';

const PROVIDER_ACCOUNT_ID = '6b0aa257-6e3b-41df-8f77-1b81f2502d36';

function makeBuyer(overrides: Partial<typeof stubBuyer> = {}) {
  const stubBuyer = {
    getAccount: vi.fn(),
    quote: vi.fn(),
    purchase: vi.fn(),
  } as unknown as WgcardsManualBuyer;
  return Object.assign(stubBuyer, overrides);
}

function makeService() {
  return {
    executeJitPurchase: vi.fn(),
  } as unknown as BuyerManualPurchaseService;
}

describe('WgcardsBuyerProvider', () => {
  // ─── providerCode ─────────────────────────────────────────────────────────

  it('exposes providerCode = "wgcards"', () => {
    const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), makeService());
    expect(provider.providerCode).toBe('wgcards');
  });

  // ─── quote ────────────────────────────────────────────────────────────────

  describe('quote', () => {
    it('returns snapshot price with live availability from getStock', async () => {
      const buyer = makeBuyer({
        quote: vi.fn().mockResolvedValue({
          price_cents: 0,
          currency: 'USD',
          available_quantity: 25,
        }),
      } as Partial<WgcardsManualBuyer>);
      const snapshots = new Map([
        ['sku-abc', { unitCostCents: 1999, currency: 'USD' }],
      ]);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService(), snapshots);

      const result = await provider.quote('sku-abc');
      expect(result.unitCostCents).toBe(1999);
      expect(result.currency).toBe('USD');
      expect(result.availableQuantity).toBe(25);
    });

    it('maps availability -1 to null (unlimited stock)', async () => {
      const buyer = makeBuyer({
        quote: vi.fn().mockResolvedValue({
          price_cents: 0,
          currency: 'USD',
          available_quantity: null,
        }),
      } as Partial<WgcardsManualBuyer>);
      const snapshots = new Map([['sku-unlimited', { unitCostCents: 999, currency: 'EUR' }]]);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService(), snapshots);

      const result = await provider.quote('sku-unlimited');
      expect(result.availableQuantity).toBeNull();
    });

    it('returns 0-cent quote with null availability when quote() throws', async () => {
      const buyer = makeBuyer({
        quote: vi.fn().mockRejectedValue(new Error('getStock API error')),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.quote('sku-unknown');
      expect(result.unitCostCents).toBe(0);
      expect(result.availableQuantity).toBeNull();
    });

    it('returns 0-cent quote when no snapshot exists for the offerId', async () => {
      const buyer = makeBuyer({
        quote: vi.fn().mockResolvedValue({ price_cents: 0, currency: 'USD', available_quantity: 5 }),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.quote('sku-no-snapshot');
      expect(result.unitCostCents).toBe(0);
      expect(result.currency).toBe('USD');
    });
  });

  // ─── walletPreflight ──────────────────────────────────────────────────────

  describe('walletPreflight', () => {
    it('returns ok:true when wallet has sufficient balance', async () => {
      const buyer = makeBuyer({
        getAccount: vi.fn().mockResolvedValue({
          userId: 'app-id',
          accounts: [{ walletId: 'w1', currency: 'USD', balance: 100.0, effective: true }],
        }),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.walletPreflight(1999, 2, 'USD');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.walletCurrency).toBe('USD');
        // 100.00 USD = 10000 cents; required = 1999 * 2 = 3998
        expect(result.spendableCents).toBe(10_000);
      }
    });

    it('returns insufficient when balance is too low', async () => {
      const buyer = makeBuyer({
        getAccount: vi.fn().mockResolvedValue({
          userId: 'app-id',
          accounts: [{ walletId: 'w1', currency: 'USD', balance: 5.0, effective: true }],
        }),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.walletPreflight(1999, 3, 'USD');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('insufficient');
    });

    it('returns no_wallet when no effective wallet for currency', async () => {
      const buyer = makeBuyer({
        getAccount: vi.fn().mockResolvedValue({
          userId: 'app-id',
          accounts: [{ walletId: 'w1', currency: 'EUR', balance: 500.0, effective: true }],
        }),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.walletPreflight(1000, 1, 'USD');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('no_wallet');
    });

    it('ignores wallets where effective=false', async () => {
      const buyer = makeBuyer({
        getAccount: vi.fn().mockResolvedValue({
          userId: 'app-id',
          accounts: [
            { walletId: 'w1', currency: 'USD', balance: 200.0, effective: false },
            { walletId: 'w2', currency: 'USD', balance: 50.0, effective: true },
          ],
        }),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      // required = 8000 cents; only effective wallet has 50 USD = 5000 cents
      const result = await provider.walletPreflight(8000, 1, 'USD');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('insufficient');
    });

    it('returns unavailable when getAccount throws', async () => {
      const buyer = makeBuyer({
        getAccount: vi.fn().mockRejectedValue(new Error('network error')),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.walletPreflight(1000, 1, 'USD');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unavailable');
    });

    it('returns unavailable for invalid computed spend (0 quantity)', async () => {
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), makeService());
      const result = await provider.walletPreflight(1000, 0, 'USD');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unavailable');
    });

    it('returns currency_mismatch for invalid currency string', async () => {
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), makeService());
      const result = await provider.walletPreflight(1000, 1, 'INVALID');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('currency_mismatch');
    });

    it('normalizes currency to uppercase for matching', async () => {
      const buyer = makeBuyer({
        getAccount: vi.fn().mockResolvedValue({
          userId: 'app-id',
          accounts: [{ walletId: 'w1', currency: 'USD', balance: 100.0, effective: true }],
        }),
      } as Partial<WgcardsManualBuyer>);
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, buyer, makeService());

      const result = await provider.walletPreflight(100, 1, 'usd'); // lowercase
      expect(result.ok).toBe(true);
    });
  });

  // ─── purchase ────────────────────────────────────────────────────────────

  describe('purchase', () => {
    it('delegates to executeJitPurchase with wgcards provider_code', async () => {
      const service = makeService();
      (service.executeJitPurchase as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), service);

      await provider.purchase({
        variantId: 'var-1',
        providerAccountId: PROVIDER_ACCOUNT_ID,
        offerId: 'sku-abc',
        quantity: 2,
        idempotencyKey: 'idem-key-1',
      });

      expect(service.executeJitPurchase).toHaveBeenCalledWith(
        expect.objectContaining({
          variant_id: 'var-1',
          provider_code: 'wgcards',
          provider_account_id: PROVIDER_ACCOUNT_ID,
          offer_id: 'sku-abc',
          quantity: 2,
          idempotency_key: 'idem-key-1',
        }),
      );
    });

    it('passes adminUserId when provided', async () => {
      const service = makeService();
      (service.executeJitPurchase as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), service);

      await provider.purchase({
        variantId: 'v',
        providerAccountId: PROVIDER_ACCOUNT_ID,
        offerId: 'sku-x',
        quantity: 1,
        idempotencyKey: 'k',
        adminUserId: 'admin-user-uuid',
      });

      expect(service.executeJitPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ admin_user_id: 'admin-user-uuid' }),
      );
    });

    it('passes walletCurrencyHint when provided', async () => {
      const service = makeService();
      (service.executeJitPurchase as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), service);

      await provider.purchase({
        variantId: 'v',
        providerAccountId: PROVIDER_ACCOUNT_ID,
        offerId: 'sku-y',
        quantity: 1,
        idempotencyKey: 'k2',
        walletCurrencyHint: 'EUR',
      });

      expect(service.executeJitPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ wallet_currency: 'EUR' }),
      );
    });

    it('omits adminUserId and wallet_currency keys when not provided', async () => {
      const service = makeService();
      (service.executeJitPurchase as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
      const provider = new WgcardsBuyerProvider(PROVIDER_ACCOUNT_ID, makeBuyer(), service);

      await provider.purchase({
        variantId: 'v',
        providerAccountId: PROVIDER_ACCOUNT_ID,
        offerId: 'sku-z',
        quantity: 1,
        idempotencyKey: 'k3',
      });

      const [dto] = (service.executeJitPurchase as ReturnType<typeof vi.fn>).mock.calls[0] as [Record<string, unknown>];
      expect('admin_user_id' in dto).toBe(false);
      expect('wallet_currency' in dto).toBe(false);
    });
  });
});
