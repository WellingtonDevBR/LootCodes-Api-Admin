/**
 * Shared helpers for Eneba declared-stock use cases.
 */

/**
 * Build candidate order IDs for reservation lookup.
 * Eneba sometimes sends a different orderId for the same logical order
 * (originalOrderId links back to the RESERVE orderId).
 */
export function buildOrderIdCandidates(orderId: string, originalOrderId: string | null): string[] {
  const set = new Set([orderId]);
  if (originalOrderId && originalOrderId !== orderId) set.add(originalOrderId);
  return Array.from(set);
}
