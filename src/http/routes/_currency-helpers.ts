import type { IDatabase } from '../../core/ports/database.port.js';

/**
 * Sparse map of `"FROM->TO"` → rate pairs loaded from `currency_rates`.
 * Example key: `"USD->EUR"`, value: `0.92`.
 */
export type RateMap = Map<string, number>;

/**
 * Process-level cache for currency rates.
 *
 * The `/orders`, `/inventory`, `/pricing` and `/analytics` routes
 * previously called `loadCurrencyRates` on every request, each
 * issuing a fresh `SELECT * FROM currency_rates`. Rates only change
 * a few times per day, so the per-request fetch is pure overhead.
 *
 * A short TTL keeps memory pressure bounded and means the cache will
 * pick up new rates within `CURRENCY_RATES_TTL_MS` of an admin
 * updating the table — a perfectly acceptable trade-off.
 *
 * Coalesces concurrent first-loads through `inflight` so a stampede
 * of incoming requests doesn't all hit Postgres at once.
 */
const CURRENCY_RATES_TTL_MS = 60_000; // 60 seconds
let cachedRates: RateMap | null = null;
let cachedAt = 0;
let inflight: Promise<RateMap> | null = null;

async function fetchRates(db: IDatabase): Promise<RateMap> {
  const rows = await db.query<{
    from_currency: string;
    to_currency: string;
    rate: string | number;
  }>('currency_rates', { select: 'from_currency, to_currency, rate', eq: [['is_active', true]] });

  const map: RateMap = new Map();
  for (const r of rows) {
    const rate = typeof r.rate === 'number' ? r.rate : Number(r.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    map.set(`${r.from_currency}->${r.to_currency}`, rate);
  }
  return map;
}

/**
 * Loads active currency rates from the `currency_rates` table into a
 * sparse `RateMap`. Used by order, inventory, and pricing endpoints for
 * multi-currency conversion via {@link convertCents}.
 *
 * Cached at module level with a {@link CURRENCY_RATES_TTL_MS} TTL.
 */
export async function loadCurrencyRates(db: IDatabase): Promise<RateMap> {
  const now = Date.now();
  if (cachedRates !== null && now - cachedAt < CURRENCY_RATES_TTL_MS) {
    return cachedRates;
  }
  if (inflight !== null) return inflight;

  inflight = (async () => {
    try {
      const fresh = await fetchRates(db);
      cachedRates = fresh;
      cachedAt = Date.now();
      return fresh;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Force the rates cache to refresh on the next call. Intended for
 * admin actions that mutate `currency_rates` and want their next
 * read to be fresh without waiting for the TTL.
 */
export function invalidateCurrencyRatesCache(): void {
  cachedRates = null;
  cachedAt = 0;
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
