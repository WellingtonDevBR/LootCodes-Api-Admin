import { describe, expect, it } from 'vitest';
import {
  assertAppRouteSuccess,
  parseAppRouteEnvelope,
} from '../src/infra/marketplace/approute/envelope.js';
import { MarketplaceApiError } from '../src/infra/marketplace/_shared/marketplace-http.js';

describe('AppRoute envelope', () => {
  it('parses a successful envelope and returns data', () => {
    const raw = {
      status: 'OK',
      statusCode: 200,
      statusMessage: 'fine',
      traceId: 't1',
      data: { items: [{ id: 'svc', items: [] }] },
      errors: [],
    };
    const env = parseAppRouteEnvelope(raw);
    expect(assertAppRouteSuccess(env)).toEqual(raw.data);
  });

  it('treats SUCCESS status like OK', () => {
    const env = parseAppRouteEnvelope({
      status: 'SUCCESS',
      data: { foo: 1 },
    });
    expect(assertAppRouteSuccess(env)).toEqual({ foo: 1 });
  });

  it('throws MarketplaceApiError when errors array is non-empty', () => {
    const env = parseAppRouteEnvelope({
      statusCode: 400,
      errors: [{ code: 'OUT_OF_STOCK', message: 'none left' }],
    });
    expect(() => assertAppRouteSuccess(env)).toThrow(MarketplaceApiError);
    expect(() => assertAppRouteSuccess(env)).toThrow(/none left/);
  });

  it('throws when envelope is not a plain object', () => {
    expect(() => parseAppRouteEnvelope(null)).toThrow(MarketplaceApiError);
    expect(() => parseAppRouteEnvelope([])).toThrow(MarketplaceApiError);
  });

  it('maps INSUFFICIENT_FUNDS-style message without throwing from assert when HTTP layer already failed', () => {
    const env = parseAppRouteEnvelope({
      statusCode: 402,
      statusMessage: 'INSUFFICIENT_FUNDS',
      data: undefined,
    });
    expect(() => assertAppRouteSuccess(env)).toThrow(/INSUFFICIENT_FUNDS/);
  });
});
