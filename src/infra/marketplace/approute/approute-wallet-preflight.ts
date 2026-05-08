/**
 * Pure helpers for AppRoute `GET /accounts` wallet checks before placing shop orders.
 */
import { floatToCents } from '../../../shared/pricing.js';
import type { AppRouteAccountItem } from './types.js';

export function normalizeCurrencyIso4217(input: string): string | null {
  const t = input.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(t) ? t : null;
}

export function findAppRouteAccountForCurrency(
  items: readonly AppRouteAccountItem[] | undefined,
  currency: string,
): AppRouteAccountItem | null {
  const want = normalizeCurrencyIso4217(currency);
  if (!want) return null;
  for (const row of items ?? []) {
    const c = typeof row.currency === 'string' ? normalizeCurrencyIso4217(row.currency) : null;
    if (c === want) return row;
  }
  return null;
}

/** Spendable headroom in major units (`available` + positive `overdraftLimit`). */
export function appRouteSpendableMajor(row: AppRouteAccountItem): number | null {
  const avail = Number(row.available);
  if (!Number.isFinite(avail)) return null;
  const odRaw = row.overdraftLimit;
  const od = odRaw === undefined || odRaw === null ? 0 : Number(odRaw);
  const odAdj = Number.isFinite(od) && od > 0 ? od : 0;
  return avail + odAdj;
}

export function appRouteSpendableCents(row: AppRouteAccountItem): number | null {
  const m = appRouteSpendableMajor(row);
  return m == null ? null : floatToCents(m);
}
