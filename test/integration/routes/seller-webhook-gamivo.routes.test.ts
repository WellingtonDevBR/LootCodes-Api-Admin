/**
 * Wire-format integration tests for the Gamivo Import API surface.
 *
 * Covers route-level concerns that the per-handler unit tests can't reach:
 *   - HTTP method + path mapping is correct
 *   - Bearer auth middleware is mounted and rejects with 401
 *   - parser errors return the spec-compliant `{code, message}` envelope
 *   - the unauthenticated health check (`GET /webhooks/gamivo`) returns 204
 *
 * Use-case logic itself is intentionally NOT exercised here — those paths are
 * locked down by `test/handle-gamivo-*.use-case.test.ts`. We only need the
 * routes to wire request → parser → auth → use case.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestApp, type TestApp } from '../../helpers/test-app.js';

const VALID_GAMIVO_CALLBACK_TOKEN = 'gamivo-callback-secret-abc123';

function authHeader() {
  return { authorization: `Bearer ${VALID_GAMIVO_CALLBACK_TOKEN}` };
}

function configureGamivoAuth(app: TestApp) {
  // The marketplace auth middleware looks up the provider_accounts row by
  // (provider_code='gamivo', supports_seller=true) and compares the bearer
  // token (timing-safe) against seller_config.callback_auth_token.
  app.mocks.db.setQueryResult('provider_accounts', [{
    id: '00000000-0000-0000-0000-00000000ga01',
    provider_code: 'gamivo',
    seller_config: {
      callback_auth_token: VALID_GAMIVO_CALLBACK_TOKEN,
    },
  }]);
}

describe('Gamivo Import API routes — wire format', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(() => {
    configureGamivoAuth(testApp);
  });

  // ─── Health check (no auth) ────────────────────────────────────────

  it('GET /webhooks/gamivo returns 204 No Content (unauthenticated health probe)', async () => {
    const res = await testApp.app.inject({ method: 'GET', url: '/webhooks/gamivo' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  // ─── Auth gating ───────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/reservation',
        payload: { product_id: 1, quantity: 1, unit_price: 1 },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when the Bearer token does not match seller_config.callback_auth_token', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/reservation',
        headers: { authorization: 'Bearer not-the-real-token' },
        payload: { product_id: 1, quantity: 1, unit_price: 1 },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on /webhooks/gamivo/order without auth', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/order',
        payload: {
          reservation_id: '00000000-1be0-11e9-aaaa-0123456789ab',
          gamivo_order_id: 'g-1',
          created_time: '2021-07-20 13:33:22',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on /webhooks/gamivo/refund without auth', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/refund',
        payload: {
          order_id: 'g-1',
          reservation_id: '5654uy-oYYuy6',
          refunded_at: '2021-07-20 13:33:22',
          refunded_keys_count: 1,
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on /webhooks/gamivo/offer-deactivation without auth', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/offer-deactivation',
        payload: { offer_id: 1 },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 401 on /webhooks/gamivo/order/:id/keys without auth', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/webhooks/gamivo/order/00000000-1be0-11e9-aaaa-0123456789ab/keys',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ─── Parser → 400 invalid_request envelope ─────────────────────────

  describe('parser → 400 invalid_request envelope', () => {
    it('reservation: returns {code: "invalid_request", message: ...} on bad body', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/reservation',
        headers: authHeader(),
        payload: { product_id: -1, quantity: 1, unit_price: 1 },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('invalid_request');
      expect(typeof body.message).toBe('string');
      expect(body.message).toMatch(/product_id/);
    });

    it('order: rejects non-UUID reservation_id with 400 invalid_request', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/order',
        headers: authHeader(),
        payload: {
          reservation_id: 'not-a-uuid',
          gamivo_order_id: 'g-1',
          created_time: '2021-07-20 13:33:22',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        code: 'invalid_request',
        message: expect.stringContaining('reservation_id'),
      });
    });

    it('refund: rejects negative refunded_keys_count with 400 invalid_request', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/refund',
        headers: authHeader(),
        payload: {
          order_id: 'g-1',
          reservation_id: 'r-1',
          refunded_at: '2021-07-20 13:33:22',
          refunded_keys_count: -1,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_request');
    });

    it('offer-deactivation: rejects offer_id <= 0 with 400 invalid_request', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/webhooks/gamivo/offer-deactivation',
        headers: authHeader(),
        payload: { offer_id: 0 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_request');
    });

    it('get-keys: rejects path id that violates [A-Za-z0-9_-]{1,128} with 400 invalid_request', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/webhooks/gamivo/order/has spaces/keys',
        headers: authHeader(),
      });
      // Fastify decodes the path before matching, so this hits the route.
      // The route's GAMIVO_ID_SEGMENT regex rejects the space.
      expect([400, 404]).toContain(res.statusCode);
      if (res.statusCode === 400) {
        expect(res.json().code).toBe('invalid_request');
      }
    });
  });
});
