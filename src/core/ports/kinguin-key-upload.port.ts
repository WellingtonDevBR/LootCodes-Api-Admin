/**
 * Port for Kinguin-specific outbound key upload operations.
 *
 * Kinguin is declared-stock-only: keys are delivered by POSTing them
 * to the Sales Manager API at /offers/{offerId}/stock, NOT by
 * returning them in the webhook response (unlike Eneba/Gamivo).
 */

export interface KinguinKeyUploadResult {
  success: boolean;
  deliveryMode: 'reservation' | 'pool';
}

export interface KinguinRestockResult {
  attempted: boolean;
  declaredStock?: number;
  reason?: string;
}

export interface IKinguinKeyUploadPort {
  /**
   * Upload a decrypted key to Kinguin's Sales Manager API with retry logic.
   *
   * On 400 "reservation already processed" the service falls back to pool
   * delivery (POST without reservationId).
   */
  uploadKeyWithRetry(
    offerId: string,
    key: string,
    reservationId: string,
    mimeType: string,
    providerAccountId: string,
  ): Promise<KinguinKeyUploadResult>;

  /**
   * PATCH /api/v1/offers/{offerId} to re-assert declared stock
   * after a sale depletes inventory.
   */
  reassertDeclaredStock(
    listingId: string,
    offerId: string,
    providerAccountId: string,
    triggerReservationId?: string,
  ): Promise<KinguinRestockResult>;
}
