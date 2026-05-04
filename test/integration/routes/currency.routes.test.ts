import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestApp, createAdminToken, createEmployeeToken, type TestApp } from '../../helpers/test-app.js';
import type { CurrencyRate } from '../../../src/core/use-cases/currency/currency.types.js';

const MOCK_RATE: CurrencyRate = {
  id: 'rate-1',
  from_currency: 'USD',
  to_currency: 'EUR',
  rate: 0.92,
  margin_pct: 2,
  last_updated: '2024-06-01T00:00:00Z',
  source: 'manual',
  is_active: true,
};

describe('Currency Routes', () => {
  let testApp: TestApp;
  let adminToken: string;
  let employeeToken: string;

  beforeAll(async () => {
    testApp = await buildTestApp();
    adminToken = createAdminToken(testApp.mocks);
    employeeToken = createEmployeeToken(testApp.mocks);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` });
  const employeeHeaders = () => ({ authorization: `Bearer ${employeeToken}` });

  // ── Auth guard ──────────────────────────────────────────────────

  describe('auth guard', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/currency/rates' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /currency/rates ─────────────────────────────────────────

  describe('GET /currency/rates', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('currency_rates', [MOCK_RATE]);
    });

    it('returns rates for employees', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/currency/rates',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rates).toHaveLength(1);
      expect(body.rates[0].to_currency).toBe('EUR');
    });

    it('returns rates for admins', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/currency/rates',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().rates).toBeDefined();
    });
  });

  // ── POST /currency/rates ────────────────────────────────────────

  describe('POST /currency/rates', () => {
    it('creates a currency rate', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/currency/rates',
        headers: adminHeaders(),
        payload: { to_currency: 'GBP', rate: 0.79 },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().to_currency).toBe('GBP');
    });

    it('rejects employee access', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/currency/rates',
        headers: employeeHeaders(),
        payload: { to_currency: 'GBP', rate: 0.79 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── PUT /currency/rates/:id ─────────────────────────────────────

  describe('PUT /currency/rates/:id', () => {
    it('updates the exchange rate', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/currency/rates/rate-1',
        headers: adminHeaders(),
        payload: { rate: 0.95 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // ── PUT /currency/rates/:id/margin ──────────────────────────────

  describe('PUT /currency/rates/:id/margin', () => {
    it('updates the margin percentage', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/currency/rates/rate-1/margin',
        headers: adminHeaders(),
        payload: { margin_pct: 3.5 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // ── PUT /currency/rates/:id/toggle ──────────────────────────────

  describe('PUT /currency/rates/:id/toggle', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('currency_rates', [MOCK_RATE]);
    });

    it('toggles the active status', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/currency/rates/rate-1/toggle',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(typeof res.json().is_active).toBe('boolean');
    });
  });

  // ── DELETE /currency/rates/:id ──────────────────────────────────

  describe('DELETE /currency/rates/:id', () => {
    it('deletes a currency rate', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/currency/rates/rate-1',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });

    it('rejects employee access', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/currency/rates/rate-1',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /currency/sync ─────────────────────────────────────────

  describe('POST /currency/sync', () => {
    beforeEach(() => {
      testApp.mocks.db.setRpcResult('sync_currency_and_update_prices', { message: 'Synced' });
    });

    it('syncs currency rates', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/currency/sync',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // ── POST /currency/generate-prices ──────────────────────────────

  describe('POST /currency/generate-prices', () => {
    beforeEach(() => {
      testApp.mocks.db.setRpcResult('generate_all_localized_prices', { inserted: 10, updated: 5, errors: 0 });
    });

    it('generates all localized prices', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/currency/generate-prices',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.inserted).toBe(10);
      expect(body.updated).toBe(5);
    });
  });
});
