import { describe, expect, it } from 'vitest';
import { extractPublicApiProfileFields } from '../src/infra/seller/extract-public-api-profile-fields.js';

describe('extractPublicApiProfileFields', () => {
  it('returns trimmed non-empty string values for known URL keys only', () => {
    expect(
      extractPublicApiProfileFields({
        base_url: '  https://api.example/api/v1  ',
        client_secret: 'secret',
        token_endpoint: '',
      }),
    ).toEqual({ base_url: 'https://api.example/api/v1' });
  });

  it('returns empty object when profile is null', () => {
    expect(extractPublicApiProfileFields(null)).toEqual({});
  });
});
