import { describe, expect, it } from 'vitest';
import { resolveAppRouteBaseUrlFromApiProfile } from '../src/infra/marketplace/approute/resolve-app-route-base-url.js';

describe('resolveAppRouteBaseUrlFromApiProfile', () => {
  it('prefers base_url and trims', () => {
    expect(resolveAppRouteBaseUrlFromApiProfile({ base_url: ' https://x.example/api/v1 ' })).toBe(
      'https://x.example/api/v1',
    );
  });

  it('falls back to camelCase keys', () => {
    expect(resolveAppRouteBaseUrlFromApiProfile({ baseUrl: 'https://y.example/api/v1' })).toBe(
      'https://y.example/api/v1',
    );
  });

  it('returns undefined when blank', () => {
    expect(resolveAppRouteBaseUrlFromApiProfile({ base_url: '' })).toBeUndefined();
  });
});
