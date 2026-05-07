import crypto from 'node:crypto';

export function timingSafeEqualString(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Returns whether `providedSecret` matches any candidate using timing-safe comparison.
 */
export function procurementCronSecretMatches(
  providedSecret: string,
  candidates: readonly string[],
): boolean {
  const s = providedSecret.trim();
  if (!s) return false;
  const trimmedCandidates = candidates.map((c) => c.trim()).filter((c) => c.length > 0);
  return trimmedCandidates.some((c) => timingSafeEqualString(s, c));
}
