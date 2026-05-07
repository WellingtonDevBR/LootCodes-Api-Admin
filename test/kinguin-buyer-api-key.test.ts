import { describe, expect, it } from 'vitest';
import { kinguinBuyerApiKeyFromSecrets } from '../src/infra/marketplace/kinguin-buyer-api-key.js';

describe('kinguinBuyerApiKeyFromSecrets', () => {
  it('prefers KINGUIN_BUYER_API_KEY over KINGUIN_API_KEY', () => {
    expect(
      kinguinBuyerApiKeyFromSecrets({
        KINGUIN_BUYER_API_KEY: 'buyer',
        KINGUIN_API_KEY: 'edge',
      }),
    ).toBe('buyer');
  });

  it('falls back to KINGUIN_API_KEY when buyer-specific secret is absent', () => {
    expect(
      kinguinBuyerApiKeyFromSecrets({
        KINGUIN_API_KEY: 'edge-only',
      }),
    ).toBe('edge-only');
  });

  it('returns undefined when neither key is set', () => {
    expect(kinguinBuyerApiKeyFromSecrets({})).toBeUndefined();
  });

  it('trims whitespace', () => {
    expect(kinguinBuyerApiKeyFromSecrets({ KINGUIN_API_KEY: '  secret  ' })).toBe('secret');
  });
});
