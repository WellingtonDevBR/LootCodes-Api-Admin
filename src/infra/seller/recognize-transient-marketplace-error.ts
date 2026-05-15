/**
 * Single source of truth for "is this a transient marketplace failure?".
 *
 * The seller cron and individual marketplace adapters all need to log
 * these at `info` (or omit them from Sentry) instead of `warn` / `error`,
 * because they are normal infrastructure protection events — circuit
 * breakers we opened deliberately, rate limits the upstream enforces,
 * or upstream auth APIs (Digiseller `apilogin`) wobbling. They retry
 * on the next cron tick and resolve themselves.
 *
 * Production reference: Sentry issues `LOOTCODES-API-J`
 * (Procurement declared stock reconcile failed → "Digiseller apilogin
 * failed: retval=-2 no token returned") and `LOOTCODES-API-P`
 * (Digiseller setupFormDelivery failed → "Circuit breaker open for
 * digiseller") were both produced by inline transient regexes that
 * missed these patterns. Centralizing the predicate stops the drift.
 *
 * `LOOTCODES-API-Q`: `seller-stock-sync` had three inline transient
 * checks that only covered CircuitOpenError / RateLimitExceededError,
 * so Digiseller's daily 2000-edit quota (seller-limit-0) was logged as
 * logger.error instead of logger.info, creating 307+ Sentry events.
 * Fixed by replacing all three with isTransientMarketplaceError().
 */

const TRANSIENT_NAMES: ReadonlySet<string> = new Set([
  'CircuitOpenError',
  'RateLimitExceededError',
]);

const TRANSIENT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /^Circuit breaker open for /,
  /^Rate limit exceeded for /,
  /Too Many Requests/i,
  // Digiseller's auth backend ("apilogin") flakes routinely and is recovered
  // on the next cron run.
  /^Digiseller apilogin (?:failed|error)/,
  // Digiseller daily API edit quota ("seller-limit-0"). Resets at UTC midnight.
  // Classifying as transient stops Sentry spam and lets the reconcile retry on
  // the next cron tick rather than escalating to an alert-level error.
  /seller-limit-0/,
  /reached the limit for editing product via API/i,
  // Standard HTTP upstream errors — temporary server-side issues that resolve
  // on the next cron tick. 502/503/504 all indicate the upstream gateway or
  // service is momentarily unavailable (e.g. Digiseller deployment, overload).
  /\b50[234]\b/,
  /Bad Gateway/i,
  /Service Unavailable/i,
  /Gateway Timeout/i,
];

export function isTransientMarketplaceError(err: unknown): boolean {
  if (err instanceof Error) {
    if (TRANSIENT_NAMES.has(err.name)) return true;
    return matchesAnyPattern(err.message);
  }
  if (typeof err === 'string') {
    return matchesAnyPattern(err);
  }
  return false;
}

function matchesAnyPattern(msg: string): boolean {
  for (const re of TRANSIENT_MESSAGE_PATTERNS) {
    if (re.test(msg)) return true;
  }
  return false;
}
