import { describe, expect, it, vi } from 'vitest';
import { AppRoutePublicApi } from '../src/infra/marketplace/approute/app-route-public-api.js';

describe('AppRoutePublicApi.getService', () => {
  it('GET services/{id} and returns the service node', async () => {
    const http = {
      get: vi.fn().mockResolvedValue({
        status: 'SUCCESS',
        statusCode: 0,
        data: { id: 'svc-nested', name: 'Steam', items: [{ id: 'd1', price: 1 }] },
      }),
    };
    const api = new AppRoutePublicApi(http as never);
    const out = await api.getService('svc-nested');
    expect(http.get).toHaveBeenCalledWith('services/svc-nested');
    expect(out.id).toBe('svc-nested');
    expect(out.items?.[0]?.id).toBe('d1');
  });
});
