import type { IDatabase } from '../ports/database.port.js';

/**
 * Count available (unencrypted, unassigned) keys for a variant.
 * Used across G2A, Gamivo, and other marketplace webhook handlers.
 */
export async function countAvailableKeys(db: IDatabase, variantId: string): Promise<number> {
  const keys = await db.query<{ id: string }>('product_keys', {
    select: 'id',
    eq: [['variant_id', variantId], ['key_state', 'available']],
  });
  return keys.length;
}

/** Default reservation expiry for key-upload marketplaces (G2A, Gamivo). */
export const MARKETPLACE_RESERVATION_EXPIRY_MS = 30 * 60 * 1000;
