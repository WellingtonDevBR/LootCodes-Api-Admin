import { describe, expect, it } from 'vitest';
import {
  appRouteSpendableCents,
  findAppRouteAccountForCurrency,
  normalizeCurrencyIso4217,
} from '../src/infra/marketplace/approute/approute-wallet-preflight.js';

describe('approute-wallet-preflight', () => {
  it('normalizes a 3-letter ISO currency code', () => {
    expect(normalizeCurrencyIso4217('usd')).toBe('USD');
    expect(normalizeCurrencyIso4217(' eur ')).toBe('EUR');
    expect(normalizeCurrencyIso4217('US')).toBeNull();
  });

  it('finds an account row case-insensitively by currency', () => {
    const row = findAppRouteAccountForCurrency(
      [{ currency: 'Usd', available: 10, overdraftLimit: 0 }],
      'usd',
    );
    expect(row?.available).toBe(10);
  });

  it('returns null when no row matches the currency', () => {
    expect(findAppRouteAccountForCurrency([{ currency: 'EUR', available: 1 }], 'USD')).toBeNull();
  });

  it('converts available plus positive overdraftLimit to cents', () => {
    expect(
      appRouteSpendableCents({
        currency: 'USD',
        available: 12.005,
        overdraftLimit: 0.5,
      }),
    ).toBe(1251);
  });

  it('ignores non-positive overdraft limits', () => {
    expect(
      appRouteSpendableCents({
        currency: 'USD',
        available: 10,
        overdraftLimit: 0,
      }),
    ).toBe(1000);
  });
});
