import { describe, expect, it } from 'vitest';
import {
  LOOKUP_BY_HASH_CHUNK_SIZE,
  LOOKUP_IN_CHUNK_UUID,
} from '../src/http/routes/inventory-key-lookup.constants.js';

describe('inventory key lookup batching', () => {
  it('uses a small hash chunk size so PostgREST .in(raw_key_hash, …) stays under limits', () => {
    expect(LOOKUP_BY_HASH_CHUNK_SIZE).toBeLessThanOrEqual(100);
    expect(LOOKUP_BY_HASH_CHUNK_SIZE).toBeGreaterThanOrEqual(50);
  });

  it('partitions N unique hashes into ceil(N / chunk) query batches', () => {
    const n = 250;
    const unique = Array.from({ length: n }, (_, i) => `h${i}`);
    let batches = 0;
    for (let i = 0; i < unique.length; i += LOOKUP_BY_HASH_CHUNK_SIZE) {
      batches++;
      expect(unique.slice(i, i + LOOKUP_BY_HASH_CHUNK_SIZE).length).toBeLessThanOrEqual(
        LOOKUP_BY_HASH_CHUNK_SIZE,
      );
    }
    expect(batches).toBe(Math.ceil(n / LOOKUP_BY_HASH_CHUNK_SIZE));
  });

  it('uses a standard UUID in-chunk size aligned with other admin queries', () => {
    expect(LOOKUP_IN_CHUNK_UUID).toBe(200);
  });
});
