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
