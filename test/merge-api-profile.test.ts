import { describe, expect, it } from 'vitest';
import { mergeApiProfilePatch } from '../src/infra/seller/merge-api-profile.js';

describe('mergeApiProfilePatch', () => {
  it('merges patch over existing keys without mutating inputs', () => {
    const existing = { base_url: 'https://old.example/api/v1', keep: 1 };
    const patch = { base_url: 'https://new.example/api/v1' };
    const merged = mergeApiProfilePatch(existing, patch);
    expect(merged).toEqual({
      base_url: 'https://new.example/api/v1',
      keep: 1,
    });
    expect(existing.base_url).toBe('https://old.example/api/v1');
  });

  it('treats null existing as empty object', () => {
    expect(mergeApiProfilePatch(null, { base_url: 'https://x/api/v1' })).toEqual({
      base_url: 'https://x/api/v1',
    });
  });
});
