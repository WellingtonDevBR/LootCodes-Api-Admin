/**
 * PostgREST / supabase-js may return 400 Bad Request when `.in(...)` lists are huge.
 *
 * SHA-256 hex hashes are 64 chars each — fewer per chunk than UUID lists.
 */
export const LOOKUP_BY_HASH_CHUNK_SIZE = 80;
export const LOOKUP_IN_CHUNK_UUID = 200;
