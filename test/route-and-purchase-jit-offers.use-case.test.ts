import { describe, expect, it, beforeEach } from 'vitest';
import { RouteAndPurchaseJitOffersUseCase } from '../src/core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import type {
  IJitOfferRepository,
  JitCandidateOffer,
  RouteAndPurchaseJitOffersInput,
} from '../src/core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import type {
  IBuyerProvider,
  IBuyerProviderRegistry,
  BuyerWalletCheckResult,
  BuyerPurchaseRequest,
} from '../src/core/ports/buyer-provider.port.js';
import type { IProcurementFxConverter } from '../src/core/ports/procurement-fx-converter.port.js';
import type { ManualProviderPurchaseResult } from '../src/core/use-cases/procurement/procurement.types.js';

// ─── Fakes ────────────────────────────────────────────────────────────

class InMemoryJitOfferRepo implements IJitOfferRepository {
  constructor(private readonly offers: JitCandidateOffer[]) {}
  async findBuyerCapableOffersForVariant(_variantId: string): Promise<JitCandidateOffer[]> {
    return [...this.offers];
  }
}

class FixedFxConverter implements IProcurementFxConverter {
  /** USD → currency rate map (matches `currency_rates` shape). */
  constructor(private readonly usdToX: Map<string, number>) {}
  async toUsdCents(cents: number, from: string): Promise<number | null> {
    const code = from.trim().toUpperCase();
    if (code === 'USD') return Math.round(cents);
    const rate = this.usdToX.get(code);
    if (rate == null) return null;
    return Math.round(cents / rate);
  }
}

interface RecordedPurchase {
  readonly providerCode: string;
  readonly req: BuyerPurchaseRequest;
}

class FakeBuyerProvider implements IBuyerProvider {
  readonly purchases: RecordedPurchase[] = [];
  walletResult: BuyerWalletCheckResult = {
    ok: true,
    walletCurrency: 'USD',
    spendableCents: 1_000_000,
  };
  purchaseResult: ManualProviderPurchaseResult = {
    success: true,
    purchase_id: 'p_default',
    keys_received: 1,
    keys_ingested: 1,
  };

  constructor(
    readonly providerCode: string,
    readonly providerAccountId: string,
  ) {}

  async quote(_offerId: string): Promise<{
    unitCostCents: number;
    currency: string;
    availableQuantity: number | null;
  }> {
    return { unitCostCents: 0, currency: 'USD', availableQuantity: null };
  }
  async walletPreflight(): Promise<BuyerWalletCheckResult> {
    return this.walletResult;
  }
  async purchase(req: BuyerPurchaseRequest): Promise<ManualProviderPurchaseResult> {
    this.purchases.push({ providerCode: this.providerCode, req });
    return this.purchaseResult;
  }
}

class StubRegistry implements IBuyerProviderRegistry {
  constructor(private readonly byAccountId: Map<string, IBuyerProvider | null>) {}
  async resolve(providerAccountId: string): Promise<IBuyerProvider | null> {
    return this.byAccountId.get(providerAccountId) ?? null;
  }
}

function offer(o: Partial<JitCandidateOffer> & {
  provider_code: string;
  provider_account_id: string;
  last_price_cents: number;
  currency: string;
}): JitCandidateOffer {
  return {
    id: `offer-${o.provider_code}`,
    external_offer_id: `ext-${o.provider_code}`,
    available_quantity: null,
    prioritize_quote_sync: false,
    ...o,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('RouteAndPurchaseJitOffersUseCase', () => {
  const variantId = '00000000-0000-4000-8000-000000000001';
  const baseInput: RouteAndPurchaseJitOffersInput = {
    variantId,
    quantity: 1,
    externalReservationId: 'res-001',
    adminUserId: null,
  };

  let bamboo: FakeBuyerProvider;
  let approute: FakeBuyerProvider;
  let registry: StubRegistry;
  let fx: FixedFxConverter;

  beforeEach(() => {
    bamboo = new FakeBuyerProvider('bamboo', 'acct-bamboo');
    approute = new FakeBuyerProvider('approute', 'acct-approute');
    registry = new StubRegistry(
      new Map<string, IBuyerProvider | null>([
        ['acct-bamboo', bamboo],
        ['acct-approute', approute],
      ]),
    );
    // 1 USD = 0.92 EUR  ⇒ 100 EUR cents = ~109 USD cents
    fx = new FixedFxConverter(new Map([['EUR', 0.92], ['RUB', 90]]));
  });

  // ─── 1. Cheapest USD-normalized wins ─────────────────────────

  it('buys from the cheapest USD-normalized provider, ignoring native price differences', async () => {
    const repo = new InMemoryJitOfferRepo([
      // 600 EUR cents ≈ 652 USD cents
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 600, currency: 'EUR' }),
      // 500 USD cents = 500 USD cents — cheaper after normalization
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 500, currency: 'USD' }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(true);
    expect(approute.purchases).toHaveLength(1);
    expect(bamboo.purchases).toHaveLength(0);
    expect(approute.purchases[0]!.req.attemptSource).toBe('seller_jit');
  });

  // ─── 2. FX miss skips offer ──────────────────────────────────

  it('skips offers in unsupported currencies', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 100, currency: 'JPY' }),
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 600, currency: 'USD' }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(true);
    expect(approute.purchases).toHaveLength(1);
    expect(bamboo.purchases).toHaveLength(0);
  });

  // ─── 3. Profitability gate (USD) ─────────────────────────────

  it('skips offers above the USD profitability gate', async () => {
    const repo = new InMemoryJitOfferRepo([
      // 700 USD cents - too expensive vs sale=1000, margin=400 → max=600
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 700, currency: 'USD' }),
      // 550 USD cents - within budget
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 550, currency: 'USD' }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute({
      ...baseInput,
      salePriceUsdCents: 1000,
      minMarginUsdCents: 400,
      feesUsdCents: 0,
    });

    expect(result.purchased).toBe(true);
    expect(approute.purchases).toHaveLength(1);
    expect(bamboo.purchases).toHaveLength(0);
  });

  // ─── 4. Wallet preflight skip ────────────────────────────────

  it('skips a cheaper offer when wallet has no credit and tries the next-cheapest', async () => {
    bamboo.walletResult = { ok: false, reason: 'insufficient', message: 'Bamboo USD wallet empty' };

    const repo = new InMemoryJitOfferRepo([
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 400, currency: 'USD' }),
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 500, currency: 'USD' }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(true);
    expect(bamboo.purchases).toHaveLength(0); // skipped due to wallet
    expect(approute.purchases).toHaveLength(1);
  });

  // ─── 5. Stock gate ───────────────────────────────────────────

  it('skips offers with known available_quantity below requested', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 300,
        currency: 'USD',
        available_quantity: 1,
      }),
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
        available_quantity: null, // unknown — should not be filtered
      }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute({ ...baseInput, quantity: 5 });

    expect(result.purchased).toBe(true);
    expect(bamboo.purchases).toHaveLength(0);
    expect(approute.purchases).toHaveLength(1);
  });

  // ─── 6. Registry returns null (provider not buyer-capable) ───

  it('skips offers whose providers have no buyer adapter wired', async () => {
    registry = new StubRegistry(
      new Map<string, IBuyerProvider | null>([
        ['acct-bamboo', null], // not buyer-capable yet
        ['acct-approute', approute],
      ]),
    );
    const repo = new InMemoryJitOfferRepo([
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 100, currency: 'USD' }),
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 200, currency: 'USD' }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(true);
    expect(approute.purchases).toHaveLength(1);
  });

  // ─── 7. All candidates fail ──────────────────────────────────

  it('returns purchased=false when every candidate fails', async () => {
    bamboo.purchaseResult = { success: false, error: 'OUT_OF_STOCK' };
    approute.purchaseResult = { success: false, error: 'INSUFFICIENT_FUNDS' };

    const repo = new InMemoryJitOfferRepo([
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 300, currency: 'USD' }),
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 500, currency: 'USD' }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(false);
    expect(bamboo.purchases).toHaveLength(1);
    expect(approute.purchases).toHaveLength(1);
    expect(result.attemptedProviders).toHaveLength(2);
  });

  // ─── 8. No offers ────────────────────────────────────────────

  it('returns purchased=false when no buyer-capable offers exist', async () => {
    const repo = new InMemoryJitOfferRepo([]);
    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);

    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(false);
    expect(result.attemptedProviders).toHaveLength(0);
  });

  // ─── 9. prioritize_quote_sync tie-breaker ────────────────────

  it('respects prioritize_quote_sync when prices tie', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 500,
        currency: 'USD',
        prioritize_quote_sync: false,
      }),
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
        prioritize_quote_sync: true,
      }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(true);
    // prioritized one wins on tie
    expect(approute.purchases).toHaveLength(1);
    expect(bamboo.purchases).toHaveLength(0);
  });

  // ─── Smoke: simulated Eneba RESERVE → cheapest AppRoute when Bamboo wallet empty ─

  it('simulated Eneba RESERVE: routes to AppRoute when Bamboo wallet is empty', async () => {
    bamboo.walletResult = { ok: false, reason: 'insufficient', message: 'Bamboo USD empty' };

    const repo = new InMemoryJitOfferRepo([
      // Bamboo offer is cheaper but wallet is empty → must skip
      offer({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 350,
        currency: 'USD',
        prioritize_quote_sync: true,
      }),
      // AppRoute fallback
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 600,
        currency: 'EUR',
      }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute({
      ...baseInput,
      externalReservationId: 'eneba-RES-001',
      salePriceUsdCents: 1500,
      minMarginUsdCents: 200,
    });

    expect(result.purchased).toBe(true);
    expect(result.winningProviderCode).toBe('approute');
    expect(bamboo.purchases).toHaveLength(0);
    expect(approute.purchases).toHaveLength(1);
    expect(approute.purchases[0]!.req.attemptSource).toBe('seller_jit');
    expect(approute.purchases[0]!.req.idempotencyKey).toMatch(/^jit-/);
  });

  // ─── 10. Skips offers with null/zero/negative prices (cannot rank) ──

  it('skips offers with null/non-positive last_price_cents', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 0,
        currency: 'USD',
      }),
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
      }),
    ]);

    const uc = new RouteAndPurchaseJitOffersUseCase(repo, registry, fx);
    const result = await uc.execute(baseInput);

    expect(result.purchased).toBe(true);
    expect(approute.purchases).toHaveLength(1);
    expect(bamboo.purchases).toHaveLength(0);
  });
});
