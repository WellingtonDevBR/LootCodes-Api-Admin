/**
 * Gamivo Import API payload parsing and response builders.
 *
 * All validation and response construction for Gamivo webhooks lives here.
 * Follows the same pattern as g2a-parser.ts — pure functions, no side effects.
 */

export class GamivoParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GamivoParseError';
  }
}

// ─── Reservation parsing ────────────────────────────────────────────

export function parseReservationRequest(body: unknown): {
  productId: number;
  quantity: number;
  unitPrice: number;
} {
  const obj = body as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    throw new GamivoParseError('Body must be a JSON object');
  }

  const productId = Number(obj.product_id);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new GamivoParseError('product_id must be a positive integer');
  }

  const quantity = Number(obj.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new GamivoParseError('quantity must be a positive integer');
  }

  const unitPrice = Number(obj.unit_price);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new GamivoParseError('unit_price must be a non-negative number');
  }

  return { productId, quantity, unitPrice };
}

// ─── Order parsing ──────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOrderRequest(body: unknown): {
  reservationId: string;
  gamivoOrderId: string;
  createdTime: string;
} {
  const obj = body as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    throw new GamivoParseError('Body must be a JSON object');
  }

  const reservationId = typeof obj.reservation_id === 'string'
    ? obj.reservation_id.trim()
    : '';
  if (!reservationId || !UUID_RE.test(reservationId)) {
    throw new GamivoParseError('reservation_id must be a valid UUID');
  }

  const gamivoOrderId = typeof obj.gamivo_order_id === 'string'
    ? obj.gamivo_order_id.trim()
    : '';
  if (!gamivoOrderId) {
    throw new GamivoParseError('gamivo_order_id is required');
  }

  const createdTime = typeof obj.created_time === 'string'
    ? obj.created_time.trim()
    : '';
  if (!createdTime) {
    throw new GamivoParseError('created_time is required');
  }

  return { reservationId, gamivoOrderId, createdTime };
}

// ─── Refund parsing ─────────────────────────────────────────────────

export function parseRefundRequest(body: unknown): {
  orderId: string;
  reservationId: string;
  refundedAt: string;
  refundedKeysCount: number;
} {
  const obj = body as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    throw new GamivoParseError('Body must be a JSON object');
  }

  const orderId = typeof obj.order_id === 'string' ? obj.order_id.trim() : '';
  const reservationId = typeof obj.reservation_id === 'string'
    ? obj.reservation_id.trim()
    : '';
  const refundedAt = typeof obj.refunded_at === 'string'
    ? obj.refunded_at.trim()
    : '';
  const refundedKeysCountRaw = Number(obj.refunded_keys_count);
  const refundedKeysCount = Number.isInteger(refundedKeysCountRaw) && refundedKeysCountRaw >= 0
    ? refundedKeysCountRaw
    : NaN;

  if (!orderId || !reservationId || !refundedAt || Number.isNaN(refundedKeysCount)) {
    throw new GamivoParseError(
      'order_id, reservation_id, refunded_at and refunded_keys_count are required',
    );
  }

  return { orderId, reservationId, refundedAt, refundedKeysCount };
}

// ─── Offer deactivation parsing ─────────────────────────────────────

export function parseOfferDeactivation(body: unknown): {
  offerId: number;
  productName: string;
  reason: string;
} {
  const obj = body as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    throw new GamivoParseError('Body must be a JSON object');
  }

  const offerId = Number(obj.offer_id);
  if (!Number.isInteger(offerId) || offerId <= 0) {
    throw new GamivoParseError('offer_id must be a positive integer');
  }

  const productName = typeof obj.product_name === 'string' ? obj.product_name : '';
  const reason = typeof obj.reason === 'string' ? obj.reason : '';

  return { offerId, productName, reason };
}

// ─── Financials resolver ────────────────────────────────────────────

/**
 * Resolves the unit sale pricing for a Gamivo order from the reservation
 * `provider_metadata` JSONB column.
 *
 * Gamivo's Import API spec (public-api-import.pdf §"Order reservation")
 * delivers `unit_price` ONLY on `POST /reservation`. Per the offer pricing
 * model (`seller_price`), that float is the NET payout we receive — i.e.
 * `retail_price - commission`. The follow-up `POST /order` webhook carries
 * no price, so the order handler must read the unit price back from the
 * reservation we persisted earlier.
 *
 * Returns `null` when the metadata is missing or malformed so callers can
 * fall back to the listing's price snapshot.
 */
export function resolveGamivoSalePricing(
  providerMetadata: unknown,
): { grossCents: number; netCents: number; currency: string } | null {
  if (!providerMetadata || typeof providerMetadata !== 'object') return null;
  const meta = providerMetadata as Record<string, unknown>;

  const unitPriceCentsRaw = Number(meta.unit_price_cents);
  if (Number.isInteger(unitPriceCentsRaw) && unitPriceCentsRaw > 0) {
    const currency = typeof meta.currency === 'string' && meta.currency.length > 0
      ? meta.currency
      : 'EUR';
    return { grossCents: unitPriceCentsRaw, netCents: unitPriceCentsRaw, currency };
  }

  const unitPriceRaw = Number(meta.unit_price);
  if (Number.isFinite(unitPriceRaw) && unitPriceRaw > 0) {
    const cents = Math.round(unitPriceRaw * 100);
    const currency = typeof meta.currency === 'string' && meta.currency.length > 0
      ? meta.currency
      : 'EUR';
    return { grossCents: cents, netCents: cents, currency };
  }

  return null;
}

/**
 * Builds the `marketplaceFinancialsSnapshot` payload persisted in
 * `orders.marketplace_pricing`. Mirrors the Eneba snapshot shape (keys
 * `provider`, `currency`, `gross_cents_per_unit`, `seller_profit_cents_per_unit`,
 * etc.) so cross-marketplace analytics queries stay uniform.
 *
 * Gamivo gross == net because the Import API never exposes the customer-side
 * price. The `raw` block preserves the exact reservation metadata we saw
 * so downstream audits can recover the original wire values.
 */
export function buildGamivoFinancialsSnapshot(args: {
  unitPriceCents: number;
  quantity: number;
  currency: string;
  providerMetadata: Record<string, unknown>;
}): Record<string, unknown> {
  const { unitPriceCents, quantity, currency, providerMetadata } = args;
  return {
    provider: 'gamivo',
    currency,
    key_count: quantity,
    gross_cents_per_unit: unitPriceCents,
    seller_profit_cents_per_unit: unitPriceCents,
    provider_fee_cents_per_unit: 0,
    total_gross_cents: unitPriceCents * quantity,
    total_seller_profit_cents: unitPriceCents * quantity,
    total_provider_fee_aggregate_cents: 0,
    raw: {
      unit_price: providerMetadata.unit_price ?? null,
      unit_price_cents: providerMetadata.unit_price_cents ?? null,
      currency: providerMetadata.currency ?? null,
      gamivo_product_id: providerMetadata.gamivo_product_id ?? null,
    },
  };
}

// ─── Response builders ──────────────────────────────────────────────

export function buildErrorResponse(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

export { floatToCents } from '../../../../shared/pricing.js';
