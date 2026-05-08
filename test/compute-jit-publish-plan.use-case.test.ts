import { describe, expect, it, beforeEach } from 'vitest';
import {
  ComputeJitPublishPlanUseCase,
  DEFAULT_DECLARED_STOCK_WHEN_UNKNOWN,
} from '../src/core/use-cases/seller/compute-jit-publish-plan.use-case.js';
import type { ComputeJitPublishPlanInput } from '../src/core/use-cases/seller/compute-jit-publish-plan.use-case.js';
import type {
  IBuyerProvider,
  IBuyerProviderRegistry,
  BuyerWalletCheckResult,
  BuyerOfferQuote,
  BuyerPurchaseRequest,
} from '../src/core/ports/buyer-provider.port.js';
import type {
  IJitOfferRepository,
  JitCandidateOffer,
} from '../src/core/use-cases/procurement/route-and-purchase-jit-offers.use-case.js';
import type { IProcurementFxConverter } from '../src/core/ports/procurement-fx-converter.port.js';
import type {
  ISellerPricingService,
  PriceSuggestionResult,
  SuggestPriceRequest,
} from '../src/core/ports/seller-pricing.port.js';
import type {
  CompetitorPrice,
  type PricingContext as _PricingContext,
  SellerPayoutResult,
} from '../src/core/ports/marketplace-adapter.port.js';
import type { ManualProviderPurchaseResult } from '../src/core/use-cases/procurement/procurement.types.js';
import type { SellerListingType } from '../src/core/use-cases/seller/seller.types.js';

// ─── Fakes ────────────────────────────────────────────────────────────

class InMemoryJitOfferRepo implements IJitOfferRepository {
  constructor(private readonly offers: JitCandidateOffer[]) {}
  async findBuyerCapableOffersForVariant(_variantId: string): Promise<JitCandidateOffer[]> {
    return [...this.offers];
  }
}

/** USD-anchored converter; rates map = USD → CCY (matches `currency_rates` shape). */
class FixedFxConverter implements IProcurementFxConverter {
  constructor(private readonly usdToX: Map<string, number>) {}
  async toUsdCents(cents: number, from: string): Promise<number | null> {
    const code = from.trim().toUpperCase();
    if (code === 'USD') return Math.round(cents);
    const rate = this.usdToX.get(code);
    if (rate == null) return null;
    return Math.round(cents / rate);
  }
}

class FakeBuyerProvider implements IBuyerProvider {
  walletResult: BuyerWalletCheckResult = {
    ok: true,
    walletCurrency: 'USD',
    spendableCents: 1_000_000,
  };

  constructor(
    readonly providerCode: string,
    readonly providerAccountId: string,
  ) {}

  async quote(_offerId: string): Promise<BuyerOfferQuote> {
    return { unitCostCents: 0, currency: 'USD', availableQuantity: null };
  }
  async walletPreflight(): Promise<BuyerWalletCheckResult> {
    return this.walletResult;
  }
  async purchase(_req: BuyerPurchaseRequest): Promise<ManualProviderPurchaseResult> {
    return { success: false, error: 'not used in plan tests' };
  }
}

class StubRegistry implements IBuyerProviderRegistry {
  constructor(private readonly byAccountId: Map<string, IBuyerProvider | null>) {}
  async resolve(providerAccountId: string): Promise<IBuyerProvider | null> {
    return this.byAccountId.get(providerAccountId) ?? null;
  }
}

interface SuggestCall {
  readonly req: SuggestPriceRequest;
}

class FakeSellerPricingService implements ISellerPricingService {
  readonly suggestCalls: SuggestCall[] = [];
  suggestion: PriceSuggestionResult = {
    suggestedPriceCents: 1_999,
    currency: 'EUR',
    strategy: 'fixed',
    lowestCompetitorCents: null,
    estimatedPayoutCents: 1_700,
    estimatedFeeCents: 299,
  };

  async calculatePayout(): Promise<SellerPayoutResult> {
    throw new Error('not used');
  }
  async suggestPrice(req: SuggestPriceRequest): Promise<PriceSuggestionResult> {
    this.suggestCalls.push({ req });
    return this.suggestion;
  }
  async getCompetitors(): Promise<CompetitorPrice[]> {
    return [];
  }
  enforceMinPrice(price: number): number {
    return price;
  }
  async reverseNetToGross(): Promise<number> {
    throw new Error('not used');
  }
  async reverseGrossToSellerPrice(): Promise<number> {
    throw new Error('not used');
  }
}

function offer(o: Partial<JitCandidateOffer> & {
  provider_code: string;
  provider_account_id: string;
  last_price_cents: number | null;
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

function input(overrides: Partial<ComputeJitPublishPlanInput> = {}): ComputeJitPublishPlanInput {
  return {
    variantId: '00000000-0000-4000-8000-000000000001',
    listingId: 'lst-1',
    externalProductId: 'prod-x',
    providerAccountId: 'pa-eneba',
    listingType: 'declared_stock' satisfies SellerListingType,
    listingCurrency: 'EUR',
    listingMinCents: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('ComputeJitPublishPlanUseCase', () => {
  let bamboo: FakeBuyerProvider;
  let approute: FakeBuyerProvider;
  let registry: StubRegistry;
  let fx: FixedFxConverter;
  let pricing: FakeSellerPricingService;

  beforeEach(() => {
    bamboo = new FakeBuyerProvider('bamboo', 'acct-bamboo');
    approute = new FakeBuyerProvider('approute', 'acct-approute');
    registry = new StubRegistry(
      new Map<string, IBuyerProvider | null>([
        ['acct-bamboo', bamboo],
        ['acct-approute', approute],
      ]),
    );
    // 1 USD = 0.92 EUR  ⇒ 100 EUR cents ≈ 109 USD cents
    fx = new FixedFxConverter(new Map([['EUR', 0.92]]));
    pricing = new FakeSellerPricingService();
  });

  // ─── 1. No buyers ────────────────────────────────────────────

  it('returns kind=no-buyers when no buyer-capable offers exist', async () => {
    const repo = new InMemoryJitOfferRepo([]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('no-buyers');
    expect(pricing.suggestCalls).toHaveLength(0);
  });

  // ─── 2. No funded buyers ─────────────────────────────────────

  it('returns kind=no-funded with diagnostics when every buyer wallet preflight fails', async () => {
    bamboo.walletResult = {
      ok: false,
      reason: 'insufficient',
      message: 'Bamboo USD wallet empty',
    };
    approute.walletResult = {
      ok: false,
      reason: 'insufficient',
      message: 'AppRoute EUR wallet empty',
    };

    const repo = new InMemoryJitOfferRepo([
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 600, currency: 'EUR' }),
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 500, currency: 'EUR' }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('no-funded');
    if (plan.kind !== 'no-funded') return;
    expect(plan.walletDiagnostics).toHaveLength(2);
    expect(plan.walletDiagnostics.every((w) => w.hasCredits === false)).toBe(true);
    expect(pricing.suggestCalls).toHaveLength(0);
  });

  // ─── 3. Cheapest USD-normalized funded buyer wins ────────────

  it('picks the cheapest USD-normalized buyer with credits when multiple are funded', async () => {
    const repo = new InMemoryJitOfferRepo([
      // 600 EUR cents ≈ 652 USD cents — more expensive after FX
      offer({ provider_code: 'bamboo', provider_account_id: 'acct-bamboo', last_price_cents: 600, currency: 'EUR' }),
      // 500 USD cents — cheaper
      offer({ provider_code: 'approute', provider_account_id: 'acct-approute', last_price_cents: 500, currency: 'USD' }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.chosenBuyer.providerCode).toBe('approute');
    expect(plan.chosenBuyer.unitCostCents).toBe(500);
    expect(plan.chosenBuyer.offerCurrency).toBe('USD');
  });

  // ─── 4. Default declared stock when buyer offer's quantity is unknown ─

  it('defaults declaredStock to 10 when buyer offer available_quantity is null', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
        available_quantity: null,
      }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.declaredStock).toBe(DEFAULT_DECLARED_STOCK_WHEN_UNKNOWN);
    expect(DEFAULT_DECLARED_STOCK_WHEN_UNKNOWN).toBe(10);
  });

  // ─── 5. Uses buyer's available_quantity when known ───────────

  it('uses available_quantity for declaredStock when the buyer offer reports a positive integer', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
        available_quantity: 4,
      }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.declaredStock).toBe(4);
  });

  // ─── 6. Calls suggestPrice with cost converted to listing currency ─

  it('calls suggestPrice with procurementCostBasisCents in listing currency', async () => {
    const repo = new InMemoryJitOfferRepo([
      // 500 USD cents → 460 EUR cents (1 USD = 0.92 EUR)
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
      }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(
      input({
        listingCurrency: 'EUR',
        externalProductId: 'prod-EU',
        listingId: 'lst-EU',
        listingMinCents: 1000,
      }),
    );

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;

    expect(pricing.suggestCalls).toHaveLength(1);
    const call = pricing.suggestCalls[0]!.req;
    // 500 USD cents at rate 0.92 = 460 EUR cents
    expect(call.procurementCostBasisCents).toBe(460);
    expect(call.costCents).toBe(460);
    expect(call.listingCurrency).toBe('EUR');
    expect(call.listingMinCents).toBe(1000);
    expect(call.externalProductId).toBe('prod-EU');
    expect(call.listingId).toBe('lst-EU');
    expect(call.providerAccountId).toBe('pa-eneba');

    // costInListingCurrencyCents matches the call
    expect(plan.costInListingCurrencyCents).toBe(460);
  });

  // ─── 7. Skips offers with no price (cannot rank) ─────────────

  it('skips offers with null/zero last_price_cents and uses next-cheapest funded', async () => {
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
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.chosenBuyer.providerCode).toBe('approute');
  });

  // ─── 8. FX miss skips offer ──────────────────────────────────

  it('skips offers in unsupported currencies (FX miss)', async () => {
    const repo = new InMemoryJitOfferRepo([
      offer({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 100,
        currency: 'JPY', // not in fx map
      }),
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
      }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.chosenBuyer.providerCode).toBe('approute');
  });

  // ─── 9. Single funded buyer wins by default ──────────────────

  it('uses the only buyer with credits when only one has wallet headroom', async () => {
    bamboo.walletResult = {
      ok: false,
      reason: 'insufficient',
      message: 'Bamboo wallet empty',
    };

    const repo = new InMemoryJitOfferRepo([
      // bamboo is cheaper but no credits
      offer({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 200,
        currency: 'USD',
      }),
      offer({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
      }),
    ]);
    const uc = new ComputeJitPublishPlanUseCase(repo, registry, fx, pricing);

    const plan = await uc.execute(input());

    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.chosenBuyer.providerCode).toBe('approute');
    // diagnostics still include the rejected one
    const bambooStatus = plan.walletDiagnostics.find((w) => w.providerCode === 'bamboo');
    expect(bambooStatus?.hasCredits).toBe(false);
  });
});
