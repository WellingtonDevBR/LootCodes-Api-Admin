/**
 * WGCards integration smoke test
 *
 * Run locally with:
 *   npx tsx src/infra/procurement/wgcards/wgcards-smoke-test.ts
 *
 * For live sandbox tests set the env vars below (credentials from wgcards.pdf):
 *   WGCARDS_APP_ID       — test appId (must be 16 bytes, e.g. "2025112058411324")
 *   WGCARDS_APP_KEY      — test appKey
 *   WGCARDS_ACCOUNT_ID   — test accountId
 *   WGCARDS_BASE_URL     — sandbox URL (e.g. "http://115.29.241.36:9009")
 *   WGCARDS_LIVE=1       — enable live network calls (skipped by default)
 *
 * Without WGCARDS_LIVE=1, only offline AES and wiring tests run.
 */
import { WgcardsAesCrypto } from './wgcards-aes-crypto.js';
import { WgcardsTokenManager } from './wgcards-token-manager.js';
import { WgcardsHttpClient } from './wgcards-http-client.js';
import { createWgcardsManualBuyer } from './wgcards-manual-buyer.js';

const TEST_APP_ID = process.env['WGCARDS_APP_ID'] ?? '2025112058411324';
const TEST_APP_KEY = process.env['WGCARDS_APP_KEY'] ?? 'test_app_key_placeholder';
const TEST_ACCOUNT_ID = process.env['WGCARDS_ACCOUNT_ID'] ?? '100001';
const TEST_BASE_URL = process.env['WGCARDS_BASE_URL'] ?? 'http://115.29.241.36:9009';
const LIVE = process.env['WGCARDS_LIVE'] === '1';

let pass = 0;
let fail = 0;

function ok(label: string): void {
  console.info(`  ✅ ${label}`);
  pass++;
}

function ko(label: string, err: unknown): void {
  console.error(`  ❌ ${label}: ${err instanceof Error ? err.message : String(err)}`);
  fail++;
}

// ─── 1. AES crypto round-trip ─────────────────────────────────────────────────

console.info('\n[1] AES-128-ECB round-trip');
try {
  const crypto = new WgcardsAesCrypto(TEST_APP_ID);
  const original = JSON.stringify({ appId: TEST_APP_ID, appKey: TEST_APP_KEY });
  const enc = crypto.encrypt(original);
  const dec = crypto.decrypt(enc);
  if (dec === original) {
    ok('encrypt → decrypt returns original');
  } else {
    ko('round-trip mismatch', `got "${dec}"`);
  }
} catch (err) {
  ko('AES construction/round-trip', err);
}

// ─── 2. AES key length validation ────────────────────────────────────────────

console.info('\n[2] AES key length validation');
try {
  new WgcardsAesCrypto('tooshort');
  ko('should reject short appId', 'no error thrown');
} catch (err) {
  ok(`correctly rejects short appId: ${err instanceof Error ? err.message : String(err)}`);
}

try {
  new WgcardsAesCrypto('exactlysixteennn'); // 16 chars
  ok('accepts valid 16-byte appId');
} catch (err) {
  ko('should accept 16-byte appId', err);
}

// ─── 3. Token manager coalescing ─────────────────────────────────────────────

console.info('\n[3] Token manager concurrent refresh coalescing');
try {
  let fetchCount = 0;
  const mgr = new WgcardsTokenManager({
    fetchToken: async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 10));
      return `token-${fetchCount}`;
    },
  });

  const [t1, t2, t3] = await Promise.all([mgr.getToken(), mgr.getToken(), mgr.getToken()]);
  if (t1 === t2 && t2 === t3 && fetchCount === 1) {
    ok(`all 3 concurrent calls got same token, fetchCount=1`);
  } else {
    ko('coalescing failed', `tokens=${t1}/${t2}/${t3} fetchCount=${fetchCount}`);
  }
} catch (err) {
  ko('token coalescing', err);
}

// ─── 4. Token manager initial cache (no fetch needed) ────────────────────────

console.info('\n[4] Token manager: initial cache skips fetch');
try {
  let fetched = false;
  const mgr = new WgcardsTokenManager({
    fetchToken: async () => { fetched = true; return 'should-not-be-called'; },
    initialCache: { accessToken: 'cached-token', expiresAt: Date.now() + 60 * 60 * 1000 },
  });
  const t = await mgr.getToken();
  if (t === 'cached-token' && !fetched) {
    ok('returned cached token without fetching');
  } else {
    ko('should have used cache', `token=${t} fetched=${fetched}`);
  }
} catch (err) {
  ko('initial cache', err);
}

// ─── 5. Factory returns null on missing secrets ───────────────────────────────

console.info('\n[5] Factory: null on missing secrets');
try {
  const buyer = createWgcardsManualBuyer({ secrets: {}, profile: {} });
  if (buyer === null) {
    ok('returns null when secrets are missing');
  } else {
    ko('should return null', 'returned non-null');
  }
} catch (err) {
  ko('factory null guard', err);
}

// ─── 6. Factory constructs successfully with valid creds ─────────────────────

console.info('\n[6] Factory: constructs with valid credentials');
try {
  const buyer = createWgcardsManualBuyer({
    secrets: {
      WGCARDS_APP_ID: TEST_APP_ID,
      WGCARDS_APP_KEY: TEST_APP_KEY,
      WGCARDS_ACCOUNT_ID: TEST_ACCOUNT_ID,
    },
    profile: { base_url: TEST_BASE_URL },
  });
  if (buyer !== null) {
    ok('factory returns WgcardsManualBuyer instance');
  } else {
    ko('factory returned null unexpectedly', '');
  }
} catch (err) {
  ko('factory construction', err);
}

// ─── 7. Live sandbox: getToken ────────────────────────────────────────────────

if (LIVE) {
  console.info('\n[7] LIVE: getToken → getStock → getAccount');
  try {
    const crypto = new WgcardsAesCrypto(TEST_APP_ID);
    let capturedToken: string | null = null;

    const tokenManager = new WgcardsTokenManager({
      initialCache: null,
      onTokenRefreshed: (entry) => {
        capturedToken = entry.accessToken;
      },
      fetchToken: async () => httpClient.getToken(TEST_APP_KEY),
    });

    let httpClient: WgcardsHttpClient;
    httpClient = new WgcardsHttpClient(TEST_BASE_URL, TEST_APP_ID, TEST_ACCOUNT_ID, crypto, tokenManager);

    const token = await tokenManager.getToken();
    if (token && token.length > 0) {
      ok(`getToken returned token: ${token.slice(0, 20)}…`);
    } else {
      ko('getToken', 'empty token');
    }

    if (capturedToken === token) {
      ok('onTokenRefreshed callback fired with correct token');
    } else {
      ko('onTokenRefreshed mismatch', `captured=${capturedToken} vs token=${token}`);
    }

    const accountData = await httpClient.getAccount();
    ok(`getAccount: userId=${accountData.userId} wallets=${accountData.accounts.length}`);

    const stocks = await httpClient.getStock(['TEST_SKU_001']);
    ok(`getStock: ${stocks.length} entries`);
  } catch (err) {
    ko('LIVE getToken/getAccount/getStock', err);
  }
} else {
  console.info('\n[7] LIVE tests skipped — set WGCARDS_LIVE=1 to run against sandbox');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.info(`\n${'─'.repeat(50)}`);
console.info(`Smoke test complete: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
