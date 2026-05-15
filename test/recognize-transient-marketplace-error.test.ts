/**
 * Unit tests for the transient-marketplace-error classifier.
 *
 * The reconcile cron (`/internal/cron/reconcile-seller-listings`) and the
 * Digiseller adapter both need to discriminate "infrastructure said no"
 * (rate limit, circuit breaker, upstream auth API down) from "this is a
 * real bug" before deciding whether to log at info or warn level. Misclassifying
 * a transient as `warn`/`error` floods Sentry — that is exactly what
 * production issues `LOOTCODES-API-J` and `LOOTCODES-API-P` were doing.
 */
import { describe, expect, it } from 'vitest';
import { isTransientMarketplaceError } from '../src/infra/seller/recognize-transient-marketplace-error.js';

class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitExceededError';
  }
}

describe('isTransientMarketplaceError', () => {
  it('classifies CircuitOpenError-named errors as transient', () => {
    expect(isTransientMarketplaceError(new CircuitOpenError('Circuit breaker open for eneba'))).toBe(true);
  });

  it('classifies RateLimitExceededError-named errors as transient', () => {
    expect(isTransientMarketplaceError(new RateLimitExceededError('Rate limit exceeded for digiseller'))).toBe(true);
  });

  it('classifies "Circuit breaker open for <provider>" by message', () => {
    expect(isTransientMarketplaceError(new Error('Circuit breaker open for digiseller'))).toBe(true);
    expect(isTransientMarketplaceError(new Error('Circuit breaker open for gamivo'))).toBe(true);
  });

  it('classifies "Rate limit exceeded for <provider>" by message', () => {
    expect(isTransientMarketplaceError(new Error('Rate limit exceeded for kinguin'))).toBe(true);
  });

  it('classifies upstream "Too Many Requests" responses (Eneba GraphQL, Cloudflare 429) as transient', () => {
    expect(isTransientMarketplaceError(new Error('Eneba GraphQL error: Too Many Requests. Retry after 36 seconds.'))).toBe(true);
  });

  // Production LOOTCODES-API-J was emitted because the reconcile classifier
  // did not recognize Digiseller's auth API ("apilogin") returning no token
  // as transient. It is — Digiseller's auth backend wobbles regularly and
  // the cron retries on the next run. Should be info, not error.
  it('classifies Digiseller apilogin auth failures as transient', () => {
    expect(isTransientMarketplaceError(new Error('Digiseller apilogin failed: retval=-2 no token returned'))).toBe(true);
    expect(isTransientMarketplaceError(new Error('Digiseller apilogin failed: HTTP 502 — bad gateway'))).toBe(true);
    expect(isTransientMarketplaceError(new Error('Digiseller apilogin error: retval=-1'))).toBe(true);
  });

  // Production issue: Digiseller enforces a 2000 edits/day limit on their
  // /api/product/edit/arbitrary endpoint (error code "seller-limit-0"). The
  // reconcile cron must treat this as transient so it logs at info (not error)
  // and the DB is updated optimistically to prevent the vicious retry cycle.
  it('classifies Digiseller 2000/day edit quota errors as transient', () => {
    const digiLimitMsg =
      'digiseller API error: 400 Bad Request: {"retval":-1,"retdesc":"Validation error",' +
      '"errors":[{"code":"seller-limit-0","message":[{"locale":"en-US","value":' +
      '"You have reached the limit for editing product via API on 2026-05-15. Limit in day: 2000"}]}],"content":null}';
    expect(isTransientMarketplaceError(new Error(digiLimitMsg))).toBe(true);
    expect(isTransientMarketplaceError(new Error('seller-limit-0'))).toBe(true);
    expect(isTransientMarketplaceError(new Error('You have reached the limit for editing product via API on 2026-05-14. Limit in day: 2000'))).toBe(true);
  });

  it('does NOT classify generic application errors as transient', () => {
    expect(isTransientMarketplaceError(new Error('Listing not found'))).toBe(false);
    expect(isTransientMarketplaceError(new Error('Invalid product ID'))).toBe(false);
    expect(isTransientMarketplaceError(new TypeError('Cannot read property of undefined'))).toBe(false);
  });

  it('handles non-Error inputs gracefully (string, undefined, null)', () => {
    expect(isTransientMarketplaceError('Circuit breaker open for eneba')).toBe(true);
    expect(isTransientMarketplaceError(undefined)).toBe(false);
    expect(isTransientMarketplaceError(null)).toBe(false);
    expect(isTransientMarketplaceError({ message: 'not an error' })).toBe(false);
  });
});
