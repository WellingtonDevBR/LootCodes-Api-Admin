import { describe, expect, it, beforeEach } from 'vitest';
import {
  CreditAwareDeclaredStockSelectorUseCase,
  type DeclaredStockOfferRow,
  type DeclaredStockPricingConfig,
  type DeclaredStockSelectorInput,
} from '../src/core/use-cases/seller/credit-aware-declared-stock-selector.use-case.js';
import type { IProcurementFxConverter } from '../src/core/ports/procurement-fx-converter.port.js';
import type { WalletSnapshot } from '../src/core/ports/buyer-wallet-snapshot.port.js';
import { MAX_PROCUREMENT_DECLARED_STOCK } from '../src/core/shared/procurement-declared-stock.js';

class FixedFxConverter implements IProcurementFxConverter {
  /** USD → currency rate map (matches `currency_rates` shape: `from_currency='USD'`). */
  constructor(private readonly usdToX: Map<string, number>) {}
  async toUsdCents(cents: number, from: string): Promise<number | null> {
    const code = from.trim().toUpperCase();
    if (code === 'USD') return Math.round(cents);
    const rate = this.usdToX.get(code);
    if (rate == null) return null;
    return Math.round(cents / rate);
  }
}

function offerRow(o: Partial<DeclaredStockOfferRow> & {
  provider_code: string;
  provider_account_id: string;
  last_price_cents: number | null;
  currency: string;
}): DeclaredStockOfferRow {
  return {
    id: `offer-${o.provider_code}`,
    provider_code: o.provider_code,
    provider_account_id: o.provider_account_id,
    currency: o.currency,
    last_price_cents: o.last_price_cents,
    available_quantity: o.available_quantity ?? null,
    prioritize_quote_sync: o.prioritize_quote_sync ?? false,
  };
}

function snapshotOf(rows: Array<[string, Array<[string, number]>]>): WalletSnapshot {
  return new Map(rows.map(([id, pairs]) => [id, new Map(pairs)]));
}

describe('CreditAwareDeclaredStockSelectorUseCase', () => {
  let fx: FixedFxConverter;
  let uc: CreditAwareDeclaredStockSelectorUseCase;

  const baseConfig: DeclaredStockPricingConfig = {
    sellerSalePriceUsdCents: 1_000,
    minProfitMarginPct: 0,
    commissionRatePercent: 0,
    minPriceFloorUsdCents: 0,
    listingMinUsdCents: 0,
    requestedQty: 1,
  };

  beforeEach(() => {
    // 1 USD = 0.92 EUR → 100 EUR cents ≈ 109 USD cents
    fx = new FixedFxConverter(new Map([['EUR', 0.92], ['GBP', 0.79]]));
    uc = new CreditAwareDeclaredStockSelectorUseCase(fx);
  });

  // ─── 1. Cheapest USD-normalized buyer with credit wins ──────────

  it('picks the cheapest USD-normalized buyer when both have credit', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 600,
        currency: 'EUR', // ≈ 652 USD cents
        available_quantity: 5,
      }),
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
        available_quantity: 3,
      }),
    ];
    const snapshot = snapshotOf([
      ['acct-bamboo', [['EUR', 100_000]]],
      ['acct-approute', [['USD', 100_000]]],
    ]);

    const input: DeclaredStockSelectorInput = { offers, snapshot, config: baseConfig };
    const out = await uc.execute(input);

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('approute');
      expect(out.declaredQty).toBe(3); // capped by approute available_quantity
      expect(out.costBasisUsdCents).toBe(500);
    }
  });

  // ─── 2. Skip uncredited buyer; pick more expensive credited buyer ─

  it('skips a cheaper buyer with no credit and picks the credited (more expensive) one', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500, // cheapest USD
        currency: 'USD',
        available_quantity: 3,
      }),
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 800, // more expensive
        currency: 'USD',
        available_quantity: 2,
      }),
    ];
    // Only Bamboo has USD credit — AppRoute USD wallet is missing.
    const snapshot = snapshotOf([
      ['acct-approute', [['EUR', 50_000]]],
      ['acct-bamboo', [['USD', 50_000]]],
    ]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('bamboo');
      expect(out.declaredQty).toBe(2);
      expect(out.costBasisUsdCents).toBe(800);
    }
  });

  // ─── 3. No offers ───────────────────────────────────────────────

  it("returns disable: 'no_offer' when no buyer-capable rows exist", async () => {
    const out = await uc.execute({
      offers: [],
      snapshot: new Map(),
      config: baseConfig,
    });

    expect(out.kind).toBe('disable');
    if (out.kind === 'disable') {
      expect(out.reason).toBe('no_offer');
    }
  });

  // ─── 4. No credit anywhere ──────────────────────────────────────

  it("returns disable: 'no_credit' when zero buyers have credit in the offer currency", async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 500,
        currency: 'USD',
      }),
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
      }),
    ];
    const snapshot = snapshotOf([
      ['acct-bamboo', []],
      ['acct-approute', [['EUR', 1_000]]], // wrong currency
    ]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('disable');
    if (out.kind === 'disable') {
      expect(out.reason).toBe('no_credit');
    }
  });

  // ─── 5. Insufficient credit (credit < required total) ───────────

  it("returns disable: 'no_credit' when credit exists but is below the requested total", async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 1_000,
        currency: 'USD',
        available_quantity: 5,
      }),
    ];
    // We need 10 × 1000 = 10_000¢; wallet has 5_000¢
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 5_000]]]]);

    const out = await uc.execute({
      offers,
      snapshot,
      config: { ...baseConfig, requestedQty: 10 },
    });

    expect(out.kind).toBe('disable');
    if (out.kind === 'disable') {
      expect(out.reason).toBe('no_credit');
    }
  });

  // ─── 6. Margin / pricing-strategy floor breach ──────────────────

  it("returns disable: 'uneconomic' when only credited buyer's USD cost breaches the margin guard", async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 950,
        currency: 'USD',
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 100_000]]]]);

    // Sale 1000¢, margin 200¢ → max acceptable = 800¢; bamboo at 950¢ is uneconomic.
    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        sellerSalePriceUsdCents: 1_000,
        minProfitMarginPct: 20, // 200¢ on a 1000¢ sale
      },
    });

    expect(out.kind).toBe('disable');
    if (out.kind === 'disable') {
      expect(out.reason).toBe('uneconomic');
    }
  });

  // ─── 7. Provider min price floor (gross-up via commission) ──────

  it('honors minPriceFloorUsdCents when checking economic viability', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 600,
        currency: 'USD',
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 100_000]]]]);

    // listingMin 800¢ commission-grossed-up, we still expect bamboo at 600¢
    // to be economic (min price floors clamp the SELLING price upward, not
    // the BUYING price downward — the selector should accept this).
    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        listingMinUsdCents: 800,
        sellerSalePriceUsdCents: 1_000,
      },
    });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('bamboo');
    }
  });

  // ─── 8. Cap declared qty at MAX_PROCUREMENT_DECLARED_STOCK ──────

  it('caps declaredQty at MAX_PROCUREMENT_DECLARED_STOCK when supplier reports more', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 100,
        currency: 'USD',
        available_quantity: 50_000,
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 1_000_000_000]]]]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.declaredQty).toBe(MAX_PROCUREMENT_DECLARED_STOCK);
    }
  });

  // ─── 9. Unknown stock (null available_quantity) → declare 1 ─────

  it('declares 1 unit when available_quantity is unknown but credit covers it', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 200,
        currency: 'USD',
        available_quantity: null,
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 100_000]]]]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      // Conservative: declare 1 when supplier doesn't tell us the count
      expect(out.declaredQty).toBe(1);
    }
  });

  // ─── 10. Skip offer with null/non-positive last_price_cents ─────

  it('skips offers with null/non-positive prices and uses the next viable one', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: null,
        currency: 'USD',
      }),
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 700,
        currency: 'USD',
      }),
    ];
    const snapshot = snapshotOf([
      ['acct-bamboo', [['USD', 100_000]]],
      ['acct-approute', [['USD', 100_000]]],
    ]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('approute');
    }
  });

  // ─── 11. Skip offer in unsupported FX currency ──────────────────

  it('skips offers whose currency cannot be normalized to USD', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 300,
        currency: 'JPY', // not in fx map
      }),
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
      }),
    ];
    const snapshot = snapshotOf([
      ['acct-bamboo', [['JPY', 100_000]]],
      ['acct-approute', [['USD', 100_000]]],
    ]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('approute');
    }
  });

  // ─── 12a. Fixed per-sale fee enters profitability ceiling ────────

  // Concrete scenario: Eneba Minecraft EUX (the bug that triggered this fix).
  // Sale €15.18 ≈ $1786 USD (at 0.85 EUR/USD); 6% commission; €0.25 ≈ $30 USD fee;
  // 1% min margin. Without the fee subtraction the ceiling is ~$1662 and Bamboo
  // at $1642 is accepted; with the €0.25 fee subtracted it becomes ~$1633 and
  // Bamboo ($1642) is correctly rejected as uneconomic.
  it("returns disable: 'uneconomic' when only credited buyer breaches the ceiling once the fixed per-sale fee is applied", async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 1_642,
        currency: 'USD',
        available_quantity: 100,
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 1_000_000]]]]);

    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        sellerSalePriceUsdCents: 1_786,
        commissionRatePercent: 6,
        minProfitMarginPct: 1,
        fixedFeeUsdCents: 30, // €0.25 ≈ $30
      },
    });

    expect(out.kind).toBe('disable');
    if (out.kind === 'disable') {
      expect(out.reason).toBe('uneconomic');
    }
  });

  it('still picks the cheaper credited buyer when the fixed-fee-adjusted ceiling clears it', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 1_642,
        currency: 'USD',
        available_quantity: 100,
      }),
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 1_614,
        currency: 'USD',
        available_quantity: 50,
      }),
    ];
    const snapshot = snapshotOf([
      ['acct-bamboo', [['USD', 1_000_000]]],
      ['acct-approute', [['USD', 1_000_000]]],
    ]);

    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        sellerSalePriceUsdCents: 1_786,
        commissionRatePercent: 6,
        minProfitMarginPct: 1,
        fixedFeeUsdCents: 30,
      },
    });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      // AppRoute clears the ceiling, Bamboo does not — selector must skip
      // Bamboo despite being sorted first by price-ascending.
      expect(out.offer.provider_code).toBe('approute');
      expect(out.costBasisUsdCents).toBe(1_614);
    }
  });

  // ─── 12b. Marketplace-authoritative netPayoutUsdCents wins over manual config ─

  /**
   * When the reconcile service has fetched the marketplace's own answer
   * (`netPayoutUsdCents` from `S_calculatePrice` / `/v3/pricing/simulations`
   * / Kinguin commission API / Gamivo `calculate-customer-price`), the
   * selector MUST use it directly and ignore the manual `commissionRatePercent`
   * and `fixedFeeUsdCents` config — those are stale estimates by definition.
   *
   * This test pins the precedence: a misconfigured zero-commission/zero-fee
   * row paired with an authoritative `netPayoutUsdCents=1649` (≈€1402 from
   * Eneba's own response for the Minecraft EUX listing) must reject a buyer
   * at $1700, even though the manual ceiling would let it pass.
   */
  it('uses marketplace-authoritative netPayoutUsdCents and ignores stale commission/fee config', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 1_700,
        currency: 'USD',
        available_quantity: 100,
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 1_000_000]]]]);

    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        sellerSalePriceUsdCents: 1_786,
        // Intentionally wrong — would let buyer pass if used
        commissionRatePercent: 0,
        fixedFeeUsdCents: 0,
        // Authoritative answer from the marketplace's own calculator
        netPayoutUsdCents: 1_649,
        minProfitMarginPct: 1,
      },
    });

    expect(out.kind).toBe('disable');
    if (out.kind === 'disable') {
      expect(out.reason).toBe('uneconomic');
    }
  });

  it('accepts a buyer below the netPayoutUsdCents ceiling even when stale manual config would reject', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 1_600,
        currency: 'USD',
        available_quantity: 100,
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 1_000_000]]]]);

    // Manual config (stale): 20% commission → ceiling ≈ 1786*0.8*0.99 = 1414
    //   → would reject buyer at 1600 as 'uneconomic'.
    // Authoritative `netPayoutUsdCents` (fresh): 1700 → ceiling ≈ 1700*0.99 = 1683
    //   → accepts buyer at 1600.
    // The selector MUST trust the marketplace's own answer.
    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        sellerSalePriceUsdCents: 1_786,
        commissionRatePercent: 20,
        fixedFeeUsdCents: 0,
        netPayoutUsdCents: 1_700,
        minProfitMarginPct: 1,
      },
    });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.costBasisUsdCents).toBe(1_600);
    }
  });

  it('treats missing fixedFeeUsdCents as zero (backward-compatible config)', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 1_642,
        currency: 'USD',
        available_quantity: 10,
      }),
    ];
    const snapshot = snapshotOf([['acct-bamboo', [['USD', 1_000_000]]]]);

    // Same numbers as the uneconomic test above MINUS the fixedFeeUsdCents
    // field — the omitted field must default to 0 and let Bamboo through.
    const out = await uc.execute({
      offers,
      snapshot,
      config: {
        ...baseConfig,
        sellerSalePriceUsdCents: 1_786,
        commissionRatePercent: 6,
        minProfitMarginPct: 1,
      },
    });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('bamboo');
    }
  });

  // ─── 12. prioritize_quote_sync tie-breaker ──────────────────────

  it('uses prioritize_quote_sync as tie-breaker when USD prices match', async () => {
    const offers: DeclaredStockOfferRow[] = [
      offerRow({
        provider_code: 'bamboo',
        provider_account_id: 'acct-bamboo',
        last_price_cents: 500,
        currency: 'USD',
        prioritize_quote_sync: false,
      }),
      offerRow({
        provider_code: 'approute',
        provider_account_id: 'acct-approute',
        last_price_cents: 500,
        currency: 'USD',
        prioritize_quote_sync: true,
      }),
    ];
    const snapshot = snapshotOf([
      ['acct-bamboo', [['USD', 100_000]]],
      ['acct-approute', [['USD', 100_000]]],
    ]);

    const out = await uc.execute({ offers, snapshot, config: baseConfig });

    expect(out.kind).toBe('declare');
    if (out.kind === 'declare') {
      expect(out.offer.provider_code).toBe('approute');
    }
  });
});
