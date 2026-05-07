import { describe, expect, it } from 'vitest';
import {
  compareProcurementOffers,
  compareProcurementOffersForDeclaredStockReconcile,
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

describe('compareProcurementOffersForDeclaredStockReconcile', () => {
  it('prefers a row with known positive quantity over a cheaper prioritized row with unknown qty', () => {
    const cheapUnknown = {
      prioritize_quote_sync: true,
      last_price_cents: 100,
      available_quantity: null as number | null,
    };
    const priceyKnown = {
      prioritize_quote_sync: true,
      last_price_cents: 900,
      available_quantity: 50,
    };
    expect(compareProcurementOffersForDeclaredStockReconcile(cheapUnknown, priceyKnown)).toBeGreaterThan(0);
    expect(compareProcurementOffersForDeclaredStockReconcile(priceyKnown, cheapUnknown)).toBeLessThan(0);
  });

  it('falls back to prioritize_quote_sync and price when both rows report positive qty', () => {
    const sameQtyLowPrice = {
      prioritize_quote_sync: true,
      last_price_cents: 100,
      available_quantity: 10,
    };
    const sameQtyHighPrice = {
      prioritize_quote_sync: true,
      last_price_cents: 500,
      available_quantity: 10,
    };
    expect(
      compareProcurementOffersForDeclaredStockReconcile(sameQtyHighPrice, sameQtyLowPrice),
    ).toBeGreaterThan(0);
  });

  it('prefers explicit zero over unknown when declaring procurement tier order', () => {
    const unknown = {
      prioritize_quote_sync: true,
      last_price_cents: 50,
      available_quantity: null as number | null,
    };
    const explicitZero = {
      prioritize_quote_sync: false,
      last_price_cents: 999,
      available_quantity: 0,
    };
    expect(compareProcurementOffersForDeclaredStockReconcile(unknown, explicitZero)).toBeGreaterThan(0);
  });
});
