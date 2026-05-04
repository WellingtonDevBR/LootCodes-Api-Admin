/**
 * G2A adapter helper functions.
 *
 * Pure utilities shared between the adapter and tests.
 */
import type { G2APricingSimulation, G2AVisibility } from './types.js';

const G2A_MAX_DECLARED_SIZE = 10_000;
const G2A_MIN_DECLARED_SIZE = 0;

/**
 * Clamp a declared stock quantity to G2A's accepted range [0, 10 000].
 */
export function capG2ADeclaredSize(quantity: number): number {
  return Math.max(G2A_MIN_DECLARED_SIZE, Math.min(G2A_MAX_DECLARED_SIZE, Math.floor(quantity)));
}

/**
 * Validate a price (in cents) against G2A's optional offer price limits.
 * Limits are in EUR float (e.g. `{ min: 0.50, max: 200.00 }`).
 */
export function validateG2APrice(
  priceCents: number,
  priceLimit?: { min: number; max: number },
): { ok: boolean; reason?: string; detail?: string } {
  if (priceCents <= 0) {
    return { ok: false, reason: 'invalid_price', detail: 'Price must be positive' };
  }

  if (!priceLimit) return { ok: true };

  const priceEur = priceCents / 100;

  if (priceEur < priceLimit.min) {
    return {
      ok: false,
      reason: 'below_min',
      detail: `Price €${priceEur.toFixed(2)} is below G2A minimum €${priceLimit.min.toFixed(2)}`,
    };
  }

  if (priceEur > priceLimit.max) {
    return {
      ok: false,
      reason: 'above_max',
      detail: `Price €${priceEur.toFixed(2)} is above G2A maximum €${priceLimit.max.toFixed(2)}`,
    };
  }

  return { ok: true };
}

/**
 * Pick the income value from a G2A pricing simulation response.
 *
 * When visibility is `'business'`, uses `businessIncome`; otherwise `income`.
 * Falls back across income fields if the preferred one is missing.
 *
 * Country code determines which locale key to read (e.g. `"PL"`, `"DE"`).
 * Falls back to first available key when no match.
 */
export function pickIncomeValue(
  sim: G2APricingSimulation,
  visibility?: G2AVisibility,
  countryCode?: string,
): number {
  const preferBusiness = visibility === 'business';
  const incomeMap = preferBusiness
    ? (sim.businessIncome ?? sim.income)
    : (sim.income ?? sim.businessIncome);

  if (!incomeMap || Object.keys(incomeMap).length === 0) return 0;

  if (countryCode && incomeMap[countryCode] !== undefined) {
    return incomeMap[countryCode];
  }

  const values = Object.values(incomeMap);
  return values[0] ?? 0;
}

/**
 * Convert a float EUR value to integer cents.
 */
export function floatToCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Convert integer cents to a EUR float string suitable for G2A API.
 * Example: `598` → `"5.98"`
 */
export function centsToEurString(cents: number): string {
  return (cents / 100).toFixed(2);
}
