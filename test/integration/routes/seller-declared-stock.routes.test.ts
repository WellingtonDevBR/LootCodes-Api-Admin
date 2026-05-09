import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { container } from 'tsyringe';
import { UC_TOKENS } from '../../../src/di/tokens.js';
import { buildTestApp, createAdminToken, type TestApp } from '../../helpers/test-app.js';

interface MockUseCase {
  execute: ReturnType<typeof vi.fn>;
}

describe('PATCH /seller/listings/:id/declared-stock', () => {
  let testApp: TestApp;
  let useCase: MockUseCase;
  let adminToken: string;

  beforeAll(async () => {
    useCase = { execute: vi.fn() };
    container.register(UC_TOKENS.SetSellerListingDeclaredStock, { useValue: useCase });

    testApp = await buildTestApp();
    adminToken = createAdminToken(testApp.mocks);
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(() => {
    useCase.execute.mockReset();
  });

  const authHeaders = () => ({ authorization: `Bearer ${adminToken}` });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/seller/listings/lst-1/declared-stock',
      payload: { quantity: 5 },
    });
    expect(res.statusCode).toBe(401);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('forwards listing id, quantity and admin id to the use case and returns its result', async () => {
    useCase.execute.mockResolvedValue({
      listing_id: 'lst-1',
      declared_stock: 7,
      manual_declared_stock: 7,
      synced_at: '2026-05-09T00:00:00.000Z',
    });

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/seller/listings/lst-1/declared-stock',
      headers: authHeaders(),
      payload: { quantity: 7 },
    });

    expect(res.statusCode).toBe(200);
    expect(useCase.execute).toHaveBeenCalledWith({
      listing_id: 'lst-1',
      quantity: 7,
      admin_id: expect.any(String),
    });
    expect(res.json()).toEqual({
      listing_id: 'lst-1',
      declared_stock: 7,
      manual_declared_stock: 7,
      synced_at: '2026-05-09T00:00:00.000Z',
    });
  });

  it('rejects a non-numeric quantity with 400 before invoking the use case', async () => {
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/seller/listings/lst-1/declared-stock',
      headers: authHeaders(),
      payload: { quantity: 'not-a-number' },
    });

    expect(res.statusCode).toBe(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('rejects a negative quantity with 400 before invoking the use case', async () => {
    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/seller/listings/lst-1/declared-stock',
      headers: authHeaders(),
      payload: { quantity: -3 },
    });

    expect(res.statusCode).toBe(400);
    expect(useCase.execute).not.toHaveBeenCalled();
  });

  it('returns 400 with the use case error message when the adapter rejects the update', async () => {
    useCase.execute.mockRejectedValue(new Error('Provider "noop" does not support manual declared-stock updates'));

    const res = await testApp.app.inject({
      method: 'PATCH',
      url: '/seller/listings/lst-1/declared-stock',
      headers: authHeaders(),
      payload: { quantity: 5 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: expect.stringContaining('does not support'),
    });
  });
});
