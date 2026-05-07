import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BAMBOO_OFFICIAL_INTEGRATION_V1,
  BAMBOO_OFFICIAL_INTEGRATION_V2,
  resolveBambooIntegrationBaseUrls,
} from '../src/infra/procurement/bamboo-manual-buyer.js';

describe('resolveBambooIntegrationBaseUrls', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses api_profile proxy URLs when BAMBOO_FORCE_PUBLIC_API is unset', () => {
    const r = resolveBambooIntegrationBaseUrls({
      base_url: 'https://proxy.example/v1/',
      base_url_v2: 'https://proxy.example/v2/',
    });
    expect(r.usingForcedPublicApi).toBe(false);
    expect(r.ordersBaseUrl).toBe('https://proxy.example/v1');
    expect(r.catalogBaseUrl).toBe('https://proxy.example/v2');
  });

  it('ignores api_profile hosts when BAMBOO_FORCE_PUBLIC_API=true', () => {
    vi.stubEnv('BAMBOO_FORCE_PUBLIC_API', 'true');
    const r = resolveBambooIntegrationBaseUrls({
      base_url: 'https://proxy.example/v1/',
      base_url_v2: 'https://proxy.example/v2/',
    });
    expect(r.usingForcedPublicApi).toBe(true);
    expect(r.ordersBaseUrl).toBe(BAMBOO_OFFICIAL_INTEGRATION_V1);
    expect(r.catalogBaseUrl).toBe(BAMBOO_OFFICIAL_INTEGRATION_V2);
  });

  it('allows optional public URL overrides', () => {
    vi.stubEnv('BAMBOO_FORCE_PUBLIC_API', '1');
    vi.stubEnv('BAMBOO_PUBLIC_BASE_URL_V1', 'https://sandbox.example/v1/');
    vi.stubEnv('BAMBOO_PUBLIC_BASE_URL_V2', 'https://sandbox.example/v2/');
    const r = resolveBambooIntegrationBaseUrls({});
    expect(r.usingForcedPublicApi).toBe(true);
    expect(r.ordersBaseUrl).toBe('https://sandbox.example/v1');
    expect(r.catalogBaseUrl).toBe('https://sandbox.example/v2');
  });
});
