import { describe, expect, it } from 'vitest';
import { procurementCronSecretMatches, timingSafeEqualString } from '../src/http/middleware/procurement-cron-secret-validation.js';

describe('procurementCronSecretMatches', () => {
  it('rejects empty or whitespace-only secrets', () => {
    expect(procurementCronSecretMatches('', ['alpha'])).toBe(false);
    expect(procurementCronSecretMatches('   ', ['alpha'])).toBe(false);
  });

  it('accepts a timing-safe matching candidate', () => {
    expect(procurementCronSecretMatches('correct', ['wrong', 'correct'])).toBe(true);
  });

  it('filters blank candidates', () => {
    expect(procurementCronSecretMatches('x', ['', '  ', 'x'])).toBe(true);
  });
});

describe('timingSafeEqualString', () => {
  it('returns false for unequal lengths', () => {
    expect(timingSafeEqualString('a', 'aa')).toBe(false);
  });
});
