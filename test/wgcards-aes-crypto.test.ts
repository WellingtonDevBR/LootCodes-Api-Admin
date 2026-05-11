import { describe, expect, it } from 'vitest';
import { WgcardsAesCrypto } from '../src/infra/procurement/wgcards/wgcards-aes-crypto.js';

const VALID_APP_ID = '2025112058411324'; // exactly 16 UTF-8 bytes — test credential from WGCards PDF

describe('WgcardsAesCrypto', () => {
  // ─── Construction ────────────────────────────────────────────────────────

  it('constructs successfully when appId is exactly 16 bytes', () => {
    expect(() => new WgcardsAesCrypto(VALID_APP_ID)).not.toThrow();
  });

  it('throws when appId is shorter than 16 bytes', () => {
    expect(() => new WgcardsAesCrypto('short')).toThrow(
      'WGCards: appId must be exactly 16 UTF-8 bytes',
    );
  });

  it('throws when appId is longer than 16 bytes', () => {
    expect(() => new WgcardsAesCrypto('this-app-id-is-too-long')).toThrow(
      'WGCards: appId must be exactly 16 UTF-8 bytes',
    );
  });

  it('throws when appId is empty', () => {
    expect(() => new WgcardsAesCrypto('')).toThrow(
      'WGCards: appId must be exactly 16 UTF-8 bytes',
    );
  });

  // ─── Round-trip ──────────────────────────────────────────────────────────

  it('encrypt then decrypt returns the original plaintext', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const original = 'hello wgcards world';
    expect(crypto.decrypt(crypto.encrypt(original))).toBe(original);
  });

  it('round-trips a JSON payload faithfully', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const payload = JSON.stringify({ appId: VALID_APP_ID, appKey: 'secret-key' });
    const decrypted = crypto.decrypt(crypto.encrypt(payload));
    expect(decrypted).toBe(payload);
    expect(JSON.parse(decrypted)).toEqual({ appId: VALID_APP_ID, appKey: 'secret-key' });
  });

  it('round-trips a payload with special characters', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const payload = JSON.stringify({ msg: 'Line1\nLine2\tTabbed "quoted"', count: 42 });
    expect(crypto.decrypt(crypto.encrypt(payload))).toBe(payload);
  });

  // ─── Determinism ─────────────────────────────────────────────────────────

  it('produces Base64 output (no non-Base64 characters)', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const enc = crypto.encrypt('determinism check');
    expect(enc).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('produces the same ciphertext for the same input (ECB is deterministic)', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const payload = 'same-input-same-output';
    expect(crypto.encrypt(payload)).toBe(crypto.encrypt(payload));
  });

  // ─── decryptJson ─────────────────────────────────────────────────────────

  it('decryptJson parses JSON after decryption', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const obj = { code: 200, data: 'my-token', msg: 'success' };
    const ciphertext = crypto.encrypt(JSON.stringify(obj));
    const result = crypto.decryptJson<typeof obj>(ciphertext);
    expect(result).toEqual(obj);
  });

  it('decryptJson throws on malformed JSON ciphertext', () => {
    const crypto = new WgcardsAesCrypto(VALID_APP_ID);
    const badCiphertext = crypto.encrypt('not-json-at-all');
    expect(() => crypto.decryptJson(badCiphertext)).toThrow();
  });

  // ─── Wrong key ───────────────────────────────────────────────────────────

  it('decrypt with different key produces garbage (not original plaintext)', () => {
    const crypto1 = new WgcardsAesCrypto(VALID_APP_ID);
    const crypto2 = new WgcardsAesCrypto('1234567890123456'); // different key
    const ciphertext = crypto1.encrypt('secret message here');
    // decryption with wrong key will either throw or return garbled text
    let decrypted: string | undefined;
    try {
      decrypted = crypto2.decrypt(ciphertext);
    } catch {
      // padding error is expected — test passes
      decrypted = undefined;
    }
    expect(decrypted).not.toBe('secret message here');
  });
});
