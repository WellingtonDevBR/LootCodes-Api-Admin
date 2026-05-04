import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, createAdminToken, createEmployeeToken, type TestApp } from '../../helpers/test-app.js';

describe('Auth Guards', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('rejects requests without Authorization header', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/audit/',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with invalid token', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/audit/',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects employee from admin-only routes', async () => {
    const token = createEmployeeToken(testApp.mocks);

    const res = await testApp.app.inject({
      method: 'POST',
      url: '/orders/fulfill-verified',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: { order_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows admin to access admin-only routes', async () => {
    const token = createAdminToken(testApp.mocks);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/audit/',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    // Should not be 401 or 403 — the handler may return other codes
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it('allows employee to access employee routes', async () => {
    const token = createEmployeeToken(testApp.mocks);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/security/configs',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});
