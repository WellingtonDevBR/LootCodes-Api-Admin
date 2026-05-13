import { describe, expect, it } from 'vitest';
import { sanitizeIlikeTerm } from '../src/shared/sanitize-ilike.js';

describe('sanitizeIlikeTerm', () => {
  it('strips ILIKE metacharacters and backslashes', () => {
    expect(sanitizeIlikeTerm('100%_off')).toBe('100off');
  });

  it('trims whitespace', () => {
    expect(sanitizeIlikeTerm('  foo  ')).toBe('foo');
  });
});
