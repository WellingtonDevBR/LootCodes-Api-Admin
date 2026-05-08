/**
 * Unit tests for SellerJitProcurementService.
 *
 * Key coverage: FX-conversion of the sale price before it reaches the
 * RouteAndPurchaseJitOffersUseCase margin gate. Without conversion, a listing
 * priced in EUR (e.g. 1518 EUR cents ≈ $16.39) would be passed as a raw USD
 * ceiling of $15.18, making every buy-side offer with USD cost > 1518
 * falsely appear unprofitable (the production incident that prompted this fix).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { SellerJitProcurementService } from '../src/infra/seller/seller-jit-procurement.service.js';
import type { IProcurementFxConverter } from '../src/core/ports/procurement-fx-converter.port.js';
import type {
  RouteAndPurchaseJitOffersInput,
  RouteAndPurchaseJitOffersResult,
} from '../src/core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import type { ClaimKeysParams } from '../src/core/ports/seller-key-operations.port.js';

beforeAll(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
  process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'test-secret';
  process.env.NODE_ENV = 'test';
  loadEnv();
});

// ─── Fakes ────────────────────────────────────────────────────────────

class FakeRouteUseCase {
  lastInput: RouteAndPurchaseJitOffersInput | null = null;
  result: RouteAndPurchaseJitOffersResult = {
    purchased: true,
    ingestedKeyCount: 1,
    winningProviderCode: 'bamboo',
    winningProviderAccountId: 'acct-bamboo',
    attemptedProviders: [],
  };

  async execute(input: RouteAndPurchaseJitOffersInput): Promise<RouteAndPurchaseJitOffersResult> {
    this.lastInput = input;
    return this.result;
  }
}

class FixedFxConverter implements IProcurementFxConverter {
  constructor(
    /** rates: from-currency → USD multiplier (e.g. EUR at 1.08 means 1 EUR = 1.08 USD) */
    private readonly rates: Map<string, number>,
  ) {}

  async toUsdCents(cents: number, from: string): Promise<number | null> {
    const code = from.trim().toUpperCase();
    if (code === 'USD') return Math.round(cents);
    const rate = this.rates.get(code);
    if (rate == null) return null;
    return Math.round(cents * rate);
  }
}

class NullFxConverter implements IProcurementFxConverter {
  async toUsdCents(_cents: number, _from: string): Promise<number | null> {
    return null;
  }
}

function makeParams(overrides: Partial<ClaimKeysParams> = {}): ClaimKeysParams {
  return {
    variantId: '9b9d95e9-292c-4854-8edb-813e69c406cf',
    listingId: 'eb4e1b68-261a-4b7e-b5eb-968c8213661e',
    providerAccountId: '4c2da164-ce47-4713-a144-35a720567324',
    quantity: 1,
    externalReservationId: 'res-001',
    externalOrderId: 'ord-001',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('SellerJitProcurementService', () => {
  describe('sale price FX conversion', () => {
    it('passes salePriceCents as-is when currency is USD', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1518, salePriceCurrency: 'USD' }),
      );

      expect(route.lastInput?.salePriceUsdCents).toBe(1518);
    });

    it('FX-converts EUR sale price to USD before passing to margin gate', async () => {
      // Production incident: 1518 EUR cents listed on Eneba
      // EUR/USD ≈ 1.08 → should be ~1639 USD cents
      // Without conversion: 1518 "pseudo-USD" < 1614 AppRoute buy price → falsely blocked
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1518, salePriceCurrency: 'EUR' }),
      );

      // 1518 * 1.08 = 1639.44 → rounds to 1639
      expect(route.lastInput?.salePriceUsdCents).toBe(1639);
    });

    it('omits salePriceUsdCents when FX conversion returns null (missing rate)', async () => {
      const route = new FakeRouteUseCase();
      const svc = new SellerJitProcurementService(route as never, new NullFxConverter());

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1518, salePriceCurrency: 'EUR' }),
      );

      // No ceiling — JIT should still run without the margin gate
      expect(route.lastInput?.salePriceUsdCents).toBeUndefined();
    });

    it('omits salePriceUsdCents when salePriceCents is absent', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(makeParams());

      expect(route.lastInput?.salePriceUsdCents).toBeUndefined();
    });

    it('defaults to USD when salePriceCurrency is absent', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(makeParams({ salePriceCents: 2000 }));

      expect(route.lastInput?.salePriceUsdCents).toBe(2000);
    });
  });

  describe('fees FX conversion', () => {
    it('FX-converts EUR feesCents to USD using salePriceCurrency', async () => {
      // campaignFee of 114 EUR × 1.08 = ~123 USD cents
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({
          salePriceCents: 1509,
          salePriceCurrency: 'EUR',
          feesCents: 114,
        }),
      );

      // 114 * 1.08 = 123.12 → rounds to 123
      expect(route.lastInput?.feesUsdCents).toBe(123);
    });

    it('passes USD feesCents through without conversion', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1509, salePriceCurrency: 'USD', feesCents: 200 }),
      );

      expect(route.lastInput?.feesUsdCents).toBe(200);
    });

    it('omits feesUsdCents when feesCents is zero', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1509, salePriceCurrency: 'EUR', feesCents: 0 }),
      );

      expect(route.lastInput?.feesUsdCents).toBeUndefined();
    });

    it('omits feesUsdCents when feesCents is absent', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1509, salePriceCurrency: 'EUR' }),
      );

      expect(route.lastInput?.feesUsdCents).toBeUndefined();
    });

    it('simulates the actual incident payload: EUR priceWithoutCommission + campaignFee', async () => {
      // priceWithoutCommission = 1509 EUR, campaignFee = 114 EUR, EUR/USD = 1.08
      // salePriceUsdCents = 1509 * 1.08 = ~1630
      // feesUsdCents      = 114  * 1.08 = ~123
      // max_cost ceiling  = 1630 - 123  = 1507 USD
      // AppRoute at 1614 USD > 1507 → correctly rejected (order unprofitable after campaign)
      const route = new FakeRouteUseCase();
      route.result = {
        purchased: false,
        ingestedKeyCount: 0,
        winningProviderCode: null,
        winningProviderAccountId: null,
        attemptedProviders: [
          { providerCode: 'bamboo', providerAccountId: 'acct-bamboo', reason: 'above_margin_gate' },
          { providerCode: 'approute', providerAccountId: 'acct-approute', reason: 'above_margin_gate' },
        ],
      };
      const fx = new FixedFxConverter(new Map([['EUR', 1.08]]));
      const svc = new SellerJitProcurementService(route as never, fx);

      await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1509, salePriceCurrency: 'EUR', feesCents: 114 }),
      );

      expect(route.lastInput?.salePriceUsdCents).toBe(1630); // 1509 * 1.08 = 1629.72 → 1630
      expect(route.lastInput?.feesUsdCents).toBe(123);       // 114  * 1.08 = 123.12  → 123
    });
  });

  describe('result reporting', () => {
    it('returns true and logs ingested keys on successful purchase', async () => {
      const route = new FakeRouteUseCase();
      const fx = new FixedFxConverter(new Map());
      const svc = new SellerJitProcurementService(route as never, fx);

      const result = await svc.tryJitPurchaseForReservation(makeParams());

      expect(result).toBe(true);
    });

    it('returns false when no provider purchased', async () => {
      const route = new FakeRouteUseCase();
      route.result = {
        purchased: false,
        ingestedKeyCount: 0,
        winningProviderCode: null,
        winningProviderAccountId: null,
        attemptedProviders: [
          { providerCode: 'bamboo', providerAccountId: 'acct-bamboo', reason: 'above_margin_gate' },
          { providerCode: 'approute', providerAccountId: 'acct-approute', reason: 'above_margin_gate' },
        ],
      };
      const fx = new FixedFxConverter(new Map());
      const svc = new SellerJitProcurementService(route as never, fx);

      const result = await svc.tryJitPurchaseForReservation(
        makeParams({ salePriceCents: 1518, salePriceCurrency: 'USD' }),
      );

      expect(result).toBe(false);
    });
  });
});
