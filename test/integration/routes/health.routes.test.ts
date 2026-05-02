import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp, type TestApp } from '../../helpers/test-app.js';

describe('Health Routes', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await buildTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  it('GET /health/ returns ok', async () => {
    const res = await testApp.app.inject({
      method: 'GET',
      url: '/health/',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('lootcodes-admin-api');
    expect(body.uptime).toBeGreaterThan(0);
  });

  it('GET /health/ready returns ready when DB is up', async () => {
    testApp.mocks.db.setQueryResult('platform_settings', [{ key: 'test' }]);

    const res = await testApp.app.inject({
      method: 'GET',
      url: '/health/ready',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ready');
  });
});
