/**
 * Shared pricing utilities used across marketplace adapters and parsers.
 */

export function floatToCents(value: number): number {
  return Math.round(value * 100);
}
