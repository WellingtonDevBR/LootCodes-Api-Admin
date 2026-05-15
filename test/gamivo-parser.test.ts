/**
 * Wire-format regression suite for the Gamivo Import API parser.
 *
 * Exercises every accept and reject branch of the four request parsers
 * and verifies that `buildErrorResponse` emits the `{code, message}` shape
 * Gamivo's spec requires for 400/401/404 responses.
 *
 * The fixture payloads are taken verbatim from the public-api-import.pdf
 * "Request sample" sections so the parser is locked to the published
 * contract — any future spec change has to update both the PDF and this
 * file in lockstep.
 */
import { describe, it, expect } from 'vitest';
import {
  parseReservationRequest,
  parseOrderRequest,
  parseRefundRequest,
  parseOfferDeactivation,
  buildErrorResponse,
  GamivoParseError,
} from '../src/core/use-cases/seller-webhook/gamivo/gamivo-parser.js';

// ─── Spec sample fixtures (verbatim from public-api-import.pdf) ──────

const SPEC_RESERVATION_BODY = {
  product_id: 56546,
  quantity: 2,
  unit_price: 5.44,
};

const SPEC_ORDER_BODY = {
  reservation_id: '00000000-1be0-11e9-aaaa-0123456789ab',
  gamivo_order_id: '0000acfa-1be0-11e9-aaaa-0xxxxxxxxxx5',
  created_time: '2021-07-20 13:33:22',
};

const SPEC_REFUND_BODY = {
  order_id: '0000acfa-1be0-11e9-aaaa-0xxxxxxxxxx5',
  reservation_id: '5654uy-oYYuy6',
  refunded_at: '2021-07-20 13:33:22',
  refunded_keys_count: 4,
};

const SPEC_OFFER_DEACTIVATION_BODY = {
  offer_id: 75653,
  product_name: 'Elden Ring EU Steam',
  reason: 'Offer deactivated due a problem with product reservation',
};

// ─── parseReservationRequest ─────────────────────────────────────────

describe('parseReservationRequest', () => {
  it('accepts the spec sample body and returns camelCased fields', () => {
    expect(parseReservationRequest(SPEC_RESERVATION_BODY)).toEqual({
      productId: 56546,
      quantity: 2,
      unitPrice: 5.44,
    });
  });

  it('accepts numeric strings for product_id (PostgREST/JSON quirk tolerance)', () => {
    expect(
      parseReservationRequest({ ...SPEC_RESERVATION_BODY, product_id: '56546' }),
    ).toEqual(expect.objectContaining({ productId: 56546 }));
  });

  it('accepts unit_price = 0 (free product edge case)', () => {
    expect(
      parseReservationRequest({ ...SPEC_RESERVATION_BODY, unit_price: 0 }),
    ).toEqual(expect.objectContaining({ unitPrice: 0 }));
  });

  it('rejects null body with GamivoParseError', () => {
    expect(() => parseReservationRequest(null)).toThrow(GamivoParseError);
  });

  it('rejects an array body (must be JSON object, not list)', () => {
    expect(() => parseReservationRequest([])).toThrow(GamivoParseError);
  });

  it('rejects a string body', () => {
    // The cast is intentional — the parser must defend against bad call sites.
    expect(() => parseReservationRequest('not an object' as unknown as Record<string, unknown>))
      .toThrow(GamivoParseError);
  });

  it('rejects product_id <= 0', () => {
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, product_id: 0 }))
      .toThrow(/product_id/);
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, product_id: -1 }))
      .toThrow(/product_id/);
  });

  it('rejects non-integer product_id', () => {
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, product_id: 1.5 }))
      .toThrow(/product_id/);
  });

  it('rejects missing product_id', () => {
    expect(() => parseReservationRequest({ quantity: 1, unit_price: 1 })).toThrow(/product_id/);
  });

  it('rejects quantity < 1 (cannot reserve zero items)', () => {
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, quantity: 0 }))
      .toThrow(/quantity/);
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, quantity: -3 }))
      .toThrow(/quantity/);
  });

  it('rejects non-integer quantity', () => {
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, quantity: 2.5 }))
      .toThrow(/quantity/);
  });

  it('rejects negative unit_price', () => {
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, unit_price: -0.01 }))
      .toThrow(/unit_price/);
  });

  it('rejects non-finite unit_price (NaN, Infinity)', () => {
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, unit_price: 'abc' }))
      .toThrow(/unit_price/);
    expect(() => parseReservationRequest({ ...SPEC_RESERVATION_BODY, unit_price: Infinity }))
      .toThrow(/unit_price/);
  });
});

// ─── parseOrderRequest ───────────────────────────────────────────────

describe('parseOrderRequest', () => {
  it('accepts the spec sample body (with valid UUID reservation_id)', () => {
    expect(parseOrderRequest(SPEC_ORDER_BODY)).toEqual({
      reservationId: '00000000-1be0-11e9-aaaa-0123456789ab',
      gamivoOrderId: '0000acfa-1be0-11e9-aaaa-0xxxxxxxxxx5',
      createdTime: '2021-07-20 13:33:22',
    });
  });

  it('trims whitespace from string fields', () => {
    expect(parseOrderRequest({
      reservation_id: '  00000000-1be0-11e9-aaaa-0123456789ab  ',
      gamivo_order_id: '\torder-1\n',
      created_time: ' 2021-07-20 13:33:22 ',
    })).toEqual({
      reservationId: '00000000-1be0-11e9-aaaa-0123456789ab',
      gamivoOrderId: 'order-1',
      createdTime: '2021-07-20 13:33:22',
    });
  });

  it('rejects null body', () => {
    expect(() => parseOrderRequest(null)).toThrow(GamivoParseError);
  });

  it('rejects reservation_id that is not a UUID v4 shape', () => {
    expect(() => parseOrderRequest({
      ...SPEC_ORDER_BODY,
      reservation_id: '5654uy-oYYuy6',
    })).toThrow(/reservation_id/);
  });

  it('rejects empty reservation_id', () => {
    expect(() => parseOrderRequest({
      ...SPEC_ORDER_BODY,
      reservation_id: '',
    })).toThrow(/reservation_id/);
  });

  it('rejects missing gamivo_order_id', () => {
    expect(() => parseOrderRequest({
      reservation_id: SPEC_ORDER_BODY.reservation_id,
      created_time: SPEC_ORDER_BODY.created_time,
    })).toThrow(/gamivo_order_id/);
  });

  it('rejects empty gamivo_order_id', () => {
    expect(() => parseOrderRequest({
      ...SPEC_ORDER_BODY,
      gamivo_order_id: '   ',
    })).toThrow(/gamivo_order_id/);
  });

  it('rejects missing created_time', () => {
    expect(() => parseOrderRequest({
      reservation_id: SPEC_ORDER_BODY.reservation_id,
      gamivo_order_id: SPEC_ORDER_BODY.gamivo_order_id,
    })).toThrow(/created_time/);
  });
});

// ─── parseRefundRequest ──────────────────────────────────────────────

describe('parseRefundRequest', () => {
  it('accepts the spec sample body', () => {
    expect(parseRefundRequest(SPEC_REFUND_BODY)).toEqual({
      orderId: '0000acfa-1be0-11e9-aaaa-0xxxxxxxxxx5',
      reservationId: '5654uy-oYYuy6',
      refundedAt: '2021-07-20 13:33:22',
      refundedKeysCount: 4,
    });
  });

  it('accepts refunded_keys_count = 0 (idempotent replay before any refunds applied)', () => {
    expect(parseRefundRequest({ ...SPEC_REFUND_BODY, refunded_keys_count: 0 }))
      .toEqual(expect.objectContaining({ refundedKeysCount: 0 }));
  });

  it('rejects null body', () => {
    expect(() => parseRefundRequest(null)).toThrow(GamivoParseError);
  });

  it('rejects negative refunded_keys_count', () => {
    expect(() => parseRefundRequest({ ...SPEC_REFUND_BODY, refunded_keys_count: -1 }))
      .toThrow(GamivoParseError);
  });

  it('rejects non-integer refunded_keys_count', () => {
    expect(() => parseRefundRequest({ ...SPEC_REFUND_BODY, refunded_keys_count: 2.5 }))
      .toThrow(GamivoParseError);
  });

  it('rejects missing order_id', () => {
    const { order_id: _omit, ...rest } = SPEC_REFUND_BODY;
    expect(() => parseRefundRequest(rest)).toThrow(GamivoParseError);
  });

  it('rejects missing reservation_id', () => {
    const { reservation_id: _omit, ...rest } = SPEC_REFUND_BODY;
    expect(() => parseRefundRequest(rest)).toThrow(GamivoParseError);
  });

  it('rejects missing refunded_at', () => {
    const { refunded_at: _omit, ...rest } = SPEC_REFUND_BODY;
    expect(() => parseRefundRequest(rest)).toThrow(GamivoParseError);
  });

  it('rejects whitespace-only string fields', () => {
    expect(() => parseRefundRequest({ ...SPEC_REFUND_BODY, order_id: '   ' }))
      .toThrow(GamivoParseError);
  });
});

// ─── parseOfferDeactivation ──────────────────────────────────────────

describe('parseOfferDeactivation', () => {
  it('accepts the spec sample body', () => {
    expect(parseOfferDeactivation(SPEC_OFFER_DEACTIVATION_BODY)).toEqual({
      offerId: 75653,
      productName: 'Elden Ring EU Steam',
      reason: 'Offer deactivated due a problem with product reservation',
    });
  });

  it('accepts empty product_name and reason as empty strings (do not 400 the webhook)', () => {
    // Gamivo MAY omit product_name/reason in some events. Accepting both as
    // "" keeps the webhook tolerant — we still 204 and persist the alert.
    expect(parseOfferDeactivation({ offer_id: 1 })).toEqual({
      offerId: 1,
      productName: '',
      reason: '',
    });
  });

  it('accepts numeric-string offer_id', () => {
    expect(parseOfferDeactivation({ ...SPEC_OFFER_DEACTIVATION_BODY, offer_id: '75653' }))
      .toEqual(expect.objectContaining({ offerId: 75653 }));
  });

  it('rejects null body', () => {
    expect(() => parseOfferDeactivation(null)).toThrow(GamivoParseError);
  });

  it('rejects offer_id <= 0', () => {
    expect(() => parseOfferDeactivation({ ...SPEC_OFFER_DEACTIVATION_BODY, offer_id: 0 }))
      .toThrow(/offer_id/);
  });

  it('rejects non-integer offer_id', () => {
    expect(() => parseOfferDeactivation({ ...SPEC_OFFER_DEACTIVATION_BODY, offer_id: 1.5 }))
      .toThrow(/offer_id/);
  });

  it('rejects missing offer_id', () => {
    expect(() => parseOfferDeactivation({ product_name: 'foo', reason: 'bar' }))
      .toThrow(/offer_id/);
  });
});

// ─── buildErrorResponse ──────────────────────────────────────────────

describe('buildErrorResponse', () => {
  it('emits the {code, message} shape required by Gamivo for 400/401/404', () => {
    expect(buildErrorResponse('invalid_request', 'foo')).toEqual({
      code: 'invalid_request',
      message: 'foo',
    });
  });

  it('preserves message verbatim (no escaping or rewriting)', () => {
    const message = 'Reservation has expired (id: abc-123)';
    expect(buildErrorResponse('reservation_expired', message).message).toBe(message);
  });
});
