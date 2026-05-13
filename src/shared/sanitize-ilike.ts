/**
 * Remove PostgREST ILIKE / `or()` metacharacters from untrusted user input so
 * search strings cannot widen a pattern or inject extra OR operands.
 */
export function sanitizeIlikeTerm(raw: string): string {
  return raw.replace(/\\/g, '').replace(/[%_]/g, '').trim();
}
