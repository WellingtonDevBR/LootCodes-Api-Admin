/**
 * Seller key operations port — atomic key claim, decrypt, provision, release.
 *
 * Abstraction over the DB-level key management that the webhook handlers need.
 * Infrastructure implements this with direct DB queries + in-process crypto
 * for decryption via IKeyDecryptionPort.
 */

export interface ClaimKeysResult {
  reservationId: string;
  keyIds: string[];
  viaJit: boolean;
}

export interface ClaimKeysParams {
  variantId: string;
  listingId: string;
  providerAccountId: string;
  quantity: number;
  externalReservationId: string;
  externalOrderId: string;
  expiresAt: string;
  providerMetadata?: Record<string, unknown>;
  /** Sale price in the marketplace's listing currency (e.g. EUR cents for Eneba). */
  salePriceCents?: number;
  /** ISO-4217 currency code for salePriceCents. Must be provided alongside salePriceCents. */
  salePriceCurrency?: string;
  feesCents?: number;
  minMarginCents?: number;
}

export interface DecryptedKey {
  keyId: string;
  plaintext: string;
}

export interface ProvisionResult {
  keyIds: string[];
  decryptedKeys: DecryptedKey[];
}

export interface CompleteProvisionParams {
  reservationId: string;
  listingId: string;
  variantId: string;
  productId: string;
  providerCode: string;
  externalOrderId: string;
  keyIds: string[];
  keysProvisionedCount: number;
  priceCents: number;
  feeCents?: number;
  currency: string;
  marketplaceFinancialsSnapshot?: Record<string, unknown>;
  buyerEmail?: string;
  /** When true, suppresses marketplace_sale transaction — used for key replacements. */
  isReplacement?: boolean;
}

export interface ReleaseKeysResult {
  keysReleased: number;
}

export interface PostProvisionReturnParams {
  reservation: {
    id: string;
    seller_listing_id: string;
    quantity: number;
  };
  providerCode: string;
  externalOrderId: string;
  reason: string;
  maxKeysToRestock?: number;
  refundEventId?: string;
}

export interface DecryptPendingResult {
  keyIds: string[];
  provisionIds: string[];
  decryptedKeys: DecryptedKey[];
  keyFormats: string[];
}

export interface ISellerKeyOperationsPort {
  /**
   * Atomically claim keys for a seller reservation with native JIT fallback (linked Bamboo offers).
   * Uses `claim_and_reserve_atomic` RPC internally.
   */
  claimKeysForReservation(params: ClaimKeysParams): Promise<ClaimKeysResult>;

  /**
   * Provision keys from a pending reservation — decrypt and prepare for delivery.
   * Delegates decryption to `encrypt-product-keys` Edge Function.
   */
  provisionFromPendingKeys(reservationId: string): Promise<ProvisionResult>;

  /**
   * Decrypt pending provisions WITHOUT finalising DB state.
   * Used by marketplaces that need outbound key delivery (Kinguin)
   * where finalization should only happen after successful upload.
   */
  decryptPendingWithoutFinalize(reservationId: string): Promise<DecryptPendingResult>;

  /**
   * Finalize provisions that were previously decrypted without finalizing.
   * Marks provisions as 'delivered' and keys as 'seller_provisioned'.
   */
  finalizeProvisions(reservationId: string, keyIds: string[], provisionIds: string[]): Promise<void>;

  /**
   * Decrypt keys from an already-provisioned reservation (idempotent replay).
   */
  decryptDeliveredProvisionKeys(reservationId: string): Promise<{ decryptedKeys: DecryptedKey[] }>;

  /**
   * Complete post-provision orchestration: record marketplace sale, emit
   * domain events, notify stock change.
   */
  completeProvisionOrchestration(params: CompleteProvisionParams): Promise<void>;

  /**
   * Release keys from a pending reservation back to available inventory.
   * Calls `release_seller_reserved_keys` RPC, flips provisions to 'failed',
   * and sets reservation status to the given target.
   */
  releaseReservationKeys(reservationId: string, targetStatus: 'cancelled' | 'expired' | 'failed'): Promise<number>;

  /**
   * Handle post-provision merchandise return — restock keys + ledger refund.
   * Supports partial refunds via `maxKeysToRestock`.
   */
  handlePostProvisionReturn(params: PostProvisionReturnParams): Promise<number>;
}
