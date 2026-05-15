/**
 * Currency conversion helpers for route handlers.
 *
 * Routes call {@link loadCurrencyRates} (which resolves the
 * `ICurrencyRatesRepository` from DI) and pass the resulting `RateMap` to
 * {@link convertCents} / {@link convertCentsToUsd}. The repository owns the
 * TTL cache, so this module is purely a thin facade + the pure conversion
 * math — no `IDatabase` access leaks into route code.
 */
import { container } from 'tsyringe';
import { TOKENS } from '../../di/tokens.js';
import type { ICurrencyRatesRepository, RateMap } from '../../core/ports/currency-rates-repository.port.js';

export type { RateMap };

/**
 * Returns the cached map of active currency rates. The underlying repository
 * applies a short TTL so admin updates propagate within a minute.
 */
export async function loadCurrencyRates(): Promise<RateMap> {
  const repo = container.resolve<ICurrencyRatesRepository>(TOKENS.CurrencyRatesRepository);
  return repo.getActiveRates();
}

/** Force the rates cache to refresh on the next call. */
export function invalidateCurrencyRatesCache(): void {
  const repo = container.resolve<ICurrencyRatesRepository>(TOKENS.CurrencyRatesRepository);
  repo.invalidate();
}

/**
 * Convert a minor-unit (cents) amount between two currencies.
 *
 * Resolution order:
 * 1. Direct rate `FROM->TO`
 * 2. Inverse rate `TO->FROM`
 * 3. Two-hop via USD pivot (`USD->FROM` + `USD->TO`)
 * 4. Identity (returns input unchanged) when no path exists
 */
export function convertCents(
  amountCents: number,
  fromCurrency: string,
  toCurrency: string,
  rates: RateMap,
): number {
  if (fromCurrency === toCurrency) return amountCents;
  const direct = rates.get(`${fromCurrency}->${toCurrency}`);
  if (direct !== undefined) return Math.round(amountCents * direct);
  const inverse = rates.get(`${toCurrency}->${fromCurrency}`);
  if (inverse !== undefined && inverse > 0) return Math.round(amountCents / inverse);

  const toUsd = rates.get(`USD->${fromCurrency}`);
  const fromUsd = rates.get(`USD->${toCurrency}`);
  if (toUsd && toUsd > 0 && fromUsd) {
    const inUsdCents = amountCents / toUsd;
    return Math.round(inUsdCents * fromUsd);
  }

  return amountCents;
}

/** Shorthand: convert any currency to USD cents. */
export function convertCentsToUsd(
  amountCents: number,
  fromCurrency: string,
  rates: RateMap,
): number {
  return convertCents(amountCents, fromCurrency, 'USD', rates);
}
