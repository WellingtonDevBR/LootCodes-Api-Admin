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
