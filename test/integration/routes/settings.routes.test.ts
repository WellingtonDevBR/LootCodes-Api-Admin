import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestApp, createAdminToken, type TestApp } from '../../helpers/test-app.js';

describe('Settings Routes', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await buildTestApp();
    adminToken = createAdminToken(testApp.mocks);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  const authHeaders = () => ({ authorization: `Bearer ${adminToken}` });

  // ── Auth guard ────────────────────────────────────────────────

  describe('auth guard', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/settings/languages' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Languages ─────────────────────────────────────────────────

  describe('GET /settings/languages', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('languages', [
        { id: '1', name: 'English', code: 'en', native_name: 'English', is_active: true },
      ]);
    });

    it('returns list of languages', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/languages',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body[0].code).toBe('en');
    });
  });

  describe('POST /settings/languages', () => {
    it('creates a language', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/languages',
        headers: authHeaders(),
        payload: { name: 'Portuguese', code: 'pt', native_name: 'Português' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('Portuguese');
    });

    it('rejects missing required fields', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/languages',
        headers: authHeaders(),
        payload: { name: 'No Code' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /settings/languages/:id', () => {
    it('updates a language', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/settings/languages/lang-1',
        headers: authHeaders(),
        payload: { is_active: false },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Countries ─────────────────────────────────────────────────

  describe('GET /settings/countries', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('countries', [
        { id: '1', name: 'Brazil', code: 'BR', is_active: true },
      ]);
    });

    it('returns list of countries', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/countries',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].code).toBe('BR');
    });
  });

  describe('POST /settings/countries', () => {
    it('creates a country', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/countries',
        headers: authHeaders(),
        payload: { name: 'Australia', code: 'AU' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects missing fields', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/countries',
        headers: authHeaders(),
        payload: { name: 'No Code' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('PUT /settings/countries/:id', () => {
    it('updates a country', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/settings/countries/country-1',
        headers: authHeaders(),
        payload: { is_active: false },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Regions ───────────────────────────────────────────────────

  describe('GET /settings/regions', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('product_regions', [
        { id: '1', name: 'Europe', code: 'EU', is_global: false, restrictions: null, created_at: '2024-01-01' },
      ]);
    });

    it('returns list of regions', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/regions',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].code).toBe('EU');
    });
  });

  describe('POST /settings/regions', () => {
    it('creates a region', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/regions',
        headers: authHeaders(),
        payload: { name: 'Asia', code: 'ASIA' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects missing fields', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/regions',
        headers: authHeaders(),
        payload: { name: 'No Code' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /settings/regions/:id/excluded-countries', () => {
    beforeEach(() => {
      testApp.mocks.db.setRpcResult('get_excluded_countries_for_region', [
        { country_code: 'RU', country_name: 'Russia' },
      ]);
    });

    it('returns excluded countries', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/regions/region-1/excluded-countries',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].country_code).toBe('RU');
    });
  });

  // ── Platform families ─────────────────────────────────────────

  describe('GET /settings/platform-families', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('platform_families', [
        { id: '1', name: 'PC', code: 'pc', slug: 'pc', icon_url: null, display_order: 1 },
      ]);
    });

    it('returns list of platform families', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/platform-families',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].code).toBe('pc');
    });
  });

  describe('POST /settings/platform-families', () => {
    it('creates a platform family', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/platform-families',
        headers: authHeaders(),
        payload: { name: 'Nintendo', code: 'nintendo', slug: 'nintendo' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects missing fields', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/platform-families',
        headers: authHeaders(),
        payload: { name: 'Missing slug' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /settings/platform-families/:id', () => {
    it('deletes a platform family', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/settings/platform-families/family-1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── Platforms ──────────────────────────────────────────────────

  describe('GET /settings/platforms', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('product_platforms', [
        { id: '1', name: 'Steam', code: 'steam', slug: 'steam', icon_url: null, default_instructions: null, display_order: 1, family_id: null, redemption_url_template: null, key_display_label: null },
      ]);
    });

    it('returns list of platforms', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/platforms',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].code).toBe('steam');
    });
  });

  describe('POST /settings/platforms', () => {
    it('creates a platform', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/platforms',
        headers: authHeaders(),
        payload: { name: 'Epic', code: 'epic', slug: 'epic-games' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects missing fields', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/platforms',
        headers: authHeaders(),
        payload: { name: 'No slug or code' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Genres ────────────────────────────────────────────────────

  describe('GET /settings/genres', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('genres', [
        { id: '1', name: 'Action', slug: 'action', sort_order: 1 },
      ]);
    });

    it('returns list of genres', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/genres',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()[0].slug).toBe('action');
    });
  });

  describe('POST /settings/genres', () => {
    it('creates a genre', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/genres',
        headers: authHeaders(),
        payload: { name: 'RPG' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects missing name', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/settings/genres',
        headers: authHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /settings/genres/:id', () => {
    it('deletes a genre', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/settings/genres/genre-1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(204);
    });
  });

  // ── Platform settings ─────────────────────────────────────────

  describe('GET /settings/platform-settings', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('platform_settings', [
        { key: 'marketing_integrations', value: { trustpilot_enabled: true } },
        { key: 'payment_methods', value: { stripe: true } },
      ]);
    });

    it('returns platform settings as key-value map', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/settings/platform-settings',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.marketing_integrations).toBeDefined();
      expect(body.payment_methods).toBeDefined();
    });
  });

  describe('PUT /settings/platform-settings/:key', () => {
    beforeEach(() => {
      testApp.mocks.db.setRpcResult('admin_update_setting', { success: true });
    });

    it('updates a platform setting', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/settings/platform-settings/payment_methods',
        headers: authHeaders(),
        payload: { value: { stripe: true, paypal: false } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });
});
