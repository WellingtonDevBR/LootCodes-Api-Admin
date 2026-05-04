import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildTestApp, createAdminToken, createEmployeeToken, type TestApp } from '../../helpers/test-app.js';

describe('Security Routes', () => {
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

  // ── Auth guard ────────────────────────────────────────────────

  describe('auth guard', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await testApp.app.inject({ method: 'GET', url: '/security/configs' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Security Configs ──────────────────────────────────────────

  describe('GET /security/configs', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('security_config', [
        { config_key: 'rate_limit_auth', config_value: { per_ip_hourly: 100 }, description: null, updated_at: '2024-01-01', updated_by: null },
      ]);
    });

    it('returns configs for employee', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/configs',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configs).toBeDefined();
      expect(body.configs[0].config_key).toBe('rate_limit_auth');
    });
  });

  describe('PUT /security/configs', () => {
    it('rejects employee (admin only)', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/security/configs',
        headers: employeeHeaders(),
        payload: { key: 'rate_limit_auth', value: { per_ip_hourly: 200 } },
      });
      expect(res.statusCode).toBe(403);
    });

    it('updates config for admin', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/security/configs',
        headers: adminHeaders(),
        payload: { key: 'rate_limit_auth', value: { per_ip_hourly: 200 } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('rejects missing key', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/security/configs',
        headers: adminHeaders(),
        payload: { value: {} },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Rate Limit Unlock ─────────────────────────────────────────

  describe('POST /security/rate-limit/unlock', () => {
    it('unlocks rate limit for admin', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/rate-limit/unlock',
        headers: adminHeaders(),
        payload: { identifier: 'user@test.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('rejects missing identifier', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/rate-limit/unlock',
        headers: adminHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /security/rate-limit/direct-unlock', () => {
    it('directly unlocks rate limit', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/rate-limit/direct-unlock',
        headers: adminHeaders(),
        payload: { identifier: '1.2.3.4' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // ── Rate Limit Violations ─────────────────────────────────────

  describe('GET /security/rate-limit/violations', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('rate_limits', [
        { identifier: 'user@test.com', identifier_type: 'email', limit_type: 'auth', action_type: null, attempt_count: 5, is_blocked: true, blocked_until: null, ip_address: '1.2.3.4', created_at: '2024-01-01' },
      ]);
    });

    it('lists violations for employee', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/rate-limit/violations',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().violations).toBeDefined();
    });
  });

  // ── IP Blocklist ──────────────────────────────────────────────

  describe('GET /security/ip-blocklist', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('ip_blocklist', [
        { id: 'ip-1', ip_address: '10.0.0.1', blocked_reason: 'spam', severity: 'high', blocked_by: null, blocked_at: '2024-01-01', expires_at: null, is_active: true, auto_blocked: false, metadata: null, created_at: '2024-01-01' },
      ]);
    });

    it('lists ip blocklist for employee', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/ip-blocklist',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entries).toBeDefined();
    });
  });

  describe('POST /security/ip-blocklist', () => {
    it('blocks IP for admin', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/ip-blocklist',
        headers: adminHeaders(),
        payload: { ip_address: '10.0.0.2', reason: 'fraud', severity: 'high' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
    });

    it('rejects missing ip_address', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/ip-blocklist',
        headers: adminHeaders(),
        payload: { reason: 'fraud' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /security/ip-blocklist/:id', () => {
    it('removes IP block for admin', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/security/ip-blocklist/00000000-0000-0000-0000-000000000001',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('rejects invalid UUID', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/security/ip-blocklist/not-a-uuid',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Customer Blocklist ────────────────────────────────────────

  describe('GET /security/customer-blocklist', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('customer_blocklist', [
        { id: 'cb-1', user_id: null, email: 'bad@test.com', ip_address: null, card_fingerprint: null, block_type: 'manual', blocked_reason: 'fraud', severity: 'high', blocked_by: null, blocked_at: '2024-01-01', expires_at: null, is_active: true, auto_blocked: false, metadata: null, created_at: '2024-01-01' },
      ]);
    });

    it('lists customer blocklist', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/customer-blocklist',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().entries).toBeDefined();
    });
  });

  describe('POST /security/customer-blocklist', () => {
    beforeEach(() => {
      testApp.mocks.db.setRpcResult('admin_block_customer', { blocked_id: 'cb-new' });
    });

    it('blocks customer for admin', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/customer-blocklist',
        headers: adminHeaders(),
        payload: { email: 'bad@test.com', reason: 'fraud' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().success).toBe(true);
    });

    it('rejects missing reason', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/customer-blocklist',
        headers: adminHeaders(),
        payload: { email: 'bad@test.com' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /security/customer-blocklist/:id', () => {
    it('removes customer block', async () => {
      const res = await testApp.app.inject({
        method: 'DELETE',
        url: '/security/customer-blocklist/00000000-0000-0000-0000-000000000002',
        headers: adminHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  // ── Force Logout ──────────────────────────────────────────────

  describe('POST /security/force-logout', () => {
    beforeEach(() => {
      testApp.mocks.db.setRpcResult('invalidate_all_user_sessions', { sessions_invalidated: 3 });
    });

    it('forces logout for admin', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/force-logout',
        headers: adminHeaders(),
        payload: { user_id: '00000000-0000-0000-0000-000000000003' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(res.json().sessions_invalidated).toBe(3);
    });

    it('rejects invalid user_id', async () => {
      const res = await testApp.app.inject({
        method: 'POST',
        url: '/security/force-logout',
        headers: adminHeaders(),
        payload: { user_id: 'bad' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Surge State ───────────────────────────────────────────────

  describe('GET /security/surge-state', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('surge_state', [
        { metric: 'new_card_orders_1h', current_value: 5, surge_level: 'normal', window_minutes: 60, threshold_elevated: 10, threshold_critical: 20, last_computed_at: null, metadata: null },
      ]);
      testApp.mocks.db.setQueryResult('platform_settings', [
        { key: 'fulfillment_mode', value: 'auto', updated_at: '2024-01-01' },
      ]);
    });

    it('returns surge state for employee', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/surge-state',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.metrics).toBeDefined();
      expect(body.fulfillment_mode).toBeDefined();
    });
  });

  // ── Platform Settings ─────────────────────────────────────────

  describe('GET /security/platform-settings/:key', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('platform_settings', [
        { key: 'risk_assessment_settings', value: { enabled: true }, updated_at: '2024-01-01' },
      ]);
    });

    it('returns platform setting', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/platform-settings/risk_assessment_settings',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('PUT /security/platform-settings/:key', () => {
    it('updates allowed security setting', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/security/platform-settings/risk_assessment_settings',
        headers: adminHeaders(),
        payload: { value: { enabled: false } },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('rejects non-security key', async () => {
      const res = await testApp.app.inject({
        method: 'PUT',
        url: '/security/platform-settings/some_other_key',
        headers: adminHeaders(),
        payload: { value: {} },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Audit Log ─────────────────────────────────────────────────

  describe('GET /security/audit-log', () => {
    beforeEach(() => {
      testApp.mocks.db.setQueryResult('admin_actions', [
        { id: 'a1', admin_user_id: 'admin-1', action_type: 'update_security_config', target_id: 'rate_limit_auth', target_type: 'security_config', details: null, ip_address: null, admin_email: 'admin@test.com', admin_name: 'Admin', created_at: '2024-01-01' },
      ]);
    });

    it('lists audit log for employee', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/audit-log',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.entries).toBeDefined();
    });

    it('supports filters', async () => {
      const res = await testApp.app.inject({
        method: 'GET',
        url: '/security/audit-log?action_type=update_security_config&limit=10',
        headers: employeeHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
