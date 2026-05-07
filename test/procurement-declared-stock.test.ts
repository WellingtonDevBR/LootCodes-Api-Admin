import { describe, expect, it } from 'vitest';
import {
  compareProcurementOffers,
  computeDeclaredStockTarget,
  MAX_PROCUREMENT_DECLARED_STOCK,
} from '../src/core/shared/procurement-declared-stock.js';

describe('computeDeclaredStockTarget', () => {
  it('uses internal quantity first when follows_provider', () => {
    expect(
      computeDeclaredStockTarget({
        internalQty: 5,
        procurementQtyRaw: 999999,
        followsProvider: true,
        listingType: 'declared_stock',
      }),
    ).toBe(5);
  });

  it('caps procurement quantity when internal keys are zero', () => {
    expect(
      computeDeclaredStockTarget({
        internalQty: 0,
        procurementQtyRaw: MAX_PROCUREMENT_DECLARED_STOCK + 500,
        followsProvider: true,
        listingType: 'declared_stock',
      }),
    ).toBe(MAX_PROCUREMENT_DECLARED_STOCK);
  });

  it('treats unknown procurement quantity as zero when internal keys are zero', () => {
    expect(
      computeDeclaredStockTarget({
        internalQty: 0,
        procurementQtyRaw: null,
        followsProvider: true,
        listingType: 'declared_stock',
      }),
    ).toBe(0);
  });

  it('ignores procurement when follows_provider is false', () => {
    expect(
      computeDeclaredStockTarget({
        internalQty: 0,
        procurementQtyRaw: 100,
        followsProvider: false,
        listingType: 'declared_stock',
      }),
    ).toBe(0);
  });
});

describe('compareProcurementOffers', () => {
  it('prefers prioritize_quote_sync then lowest price', () => {
    const a = { prioritize_quote_sync: false, last_price_cents: 100, available_quantity: 1 };
    const b = { prioritize_quote_sync: true, last_price_cents: 500, available_quantity: 2 };
    expect(compareProcurementOffers(a, b)).toBeGreaterThan(0);

    const c = { prioritize_quote_sync: true, last_price_cents: 200, available_quantity: 3 };
    const d = { prioritize_quote_sync: true, last_price_cents: 99, available_quantity: 4 };
    expect(compareProcurementOffers(c, d)).toBeGreaterThan(0);
  });
});
