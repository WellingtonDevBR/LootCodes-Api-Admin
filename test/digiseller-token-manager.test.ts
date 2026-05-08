import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DigisellerTokenManager } from '../src/infra/marketplace/digiseller/token-manager.js';

// ─── Minimal DB stub ─────────────────────────────────────────────────

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
  credsHash: string;
}

function makeDb(cached: TokenCacheEntry | null = null) {
  const storage = { cachedToken: cached };
  return {
    rpc: vi.fn<[string, Record<string, unknown>], Promise<unknown>>(),
    storage,
    writtenToken: null as TokenCacheEntry | null,
    /**
     * Simulate writing cached_token back to DB.
     * The manager calls this when it obtains a fresh token.
     */
    writeToken(entry: TokenCacheEntry): Promise<void> {
      storage.cachedToken = entry;
      this.writtenToken = entry;
      return Promise.resolve();
    },
  };
}

// ─── Fake fetch ───────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetch(tokenResponse: {
  retval: number;
  token?: string;
  valid_thru?: string;
  retdesc?: string;
}): FetchMock {
  return vi.fn().mockResolvedValue({
    ok: tokenResponse.retval === 0,
    status: tokenResponse.retval === 0 ? 200 : 401,
    statusText: tokenResponse.retval === 0 ? 'OK' : 'Unauthorized',
    json: () => Promise.resolve(tokenResponse),
    text: () => Promise.resolve(JSON.stringify(tokenResponse)),
  });
}

describe('DigisellerTokenManager', () => {
  const API_KEY = 'ABC08FF2B67B4E579A66750A5D8C003C';
  const SELLER_ID = 1_225_238;
  const API_LOGIN_URL = 'https://api.digiseller.com/api/apilogin';

  let globalFetch: FetchMock;

  beforeEach(() => {
    globalFetch = vi.fn();
    vi.stubGlobal('fetch', globalFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── Token from valid DB cache ───────────────────────────────────

  it('returns the cached token without calling apilogin when cache is still valid', async () => {
    const future = Date.now() + 30 * 60 * 1000; // 30 min from now
    const db = makeDb({ accessToken: 'cached-token-xyz', expiresAt: future, credsHash: 'abc' });

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
      initialCache: { accessToken: 'cached-token-xyz', expiresAt: future, credsHash: 'abc' },
    });

    const token = await manager.getToken();

    expect(token).toBe('cached-token-xyz');
    expect(globalFetch).not.toHaveBeenCalled();
    void db; // suppress unused var warning
  });

  // ─── Token refresh when cache expired ────────────────────────────

  it('calls apilogin and returns a fresh token when cache is expired', async () => {
    const past = Date.now() - 1000; // already expired
    const freshToken = 'fresh-session-token-abc';
    // Digiseller returns valid_thru as an ISO string indicating TTL
    const validThru = new Date(Date.now() + 3600 * 1000).toISOString();

    globalFetch = mockFetch({ retval: 0, token: freshToken, valid_thru: validThru });
    vi.stubGlobal('fetch', globalFetch);

    let savedToken: TokenCacheEntry | null = null;
    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
      initialCache: { accessToken: 'stale-token', expiresAt: past, credsHash: 'abc' },
      onTokenRefreshed: (entry) => { savedToken = entry; },
    });

    const token = await manager.getToken();

    expect(token).toBe(freshToken);
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).toHaveBeenCalledWith(
      API_LOGIN_URL,
      expect.objectContaining({ method: 'POST' }),
    );
    // DB write callback was invoked
    expect(savedToken).not.toBeNull();
    expect((savedToken as unknown as TokenCacheEntry).accessToken).toBe(freshToken);
    expect((savedToken as unknown as TokenCacheEntry).expiresAt).toBeGreaterThan(Date.now());
  });

  // ─── No cache — cold start ────────────────────────────────────────

  it('calls apilogin on first use when no cache is provided', async () => {
    const freshToken = 'brand-new-token';
    const validThru = new Date(Date.now() + 3600 * 1000).toISOString();

    globalFetch = mockFetch({ retval: 0, token: freshToken, valid_thru: validThru });
    vi.stubGlobal('fetch', globalFetch);

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
    });

    const token = await manager.getToken();

    expect(token).toBe(freshToken);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  // ─── POST body structure ──────────────────────────────────────────

  it('sends seller_id, timestamp, and sha256-based sign to apilogin', async () => {
    const freshToken = 'token-from-login';
    const validThru = new Date(Date.now() + 3600 * 1000).toISOString();

    globalFetch = mockFetch({ retval: 0, token: freshToken, valid_thru: validThru });
    vi.stubGlobal('fetch', globalFetch);

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
    });

    await manager.getToken();

    const [, init] = globalFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      seller_id: number;
      timestamp: number;
      sign: string;
    };

    expect(body.seller_id).toBe(SELLER_ID);
    expect(typeof body.timestamp).toBe('number');
    expect(body.timestamp).toBeGreaterThan(1_700_000_000); // after ~Nov 2023 in seconds
    // sign must be a 64-char lowercase hex string (SHA256)
    expect(body.sign).toMatch(/^[0-9a-f]{64}$/);
  });

  // ─── Concurrent callers share one refresh ────────────────────────

  it('coalesces concurrent getToken calls into a single apilogin request', async () => {
    const freshToken = 'coalesced-token';
    const validThru = new Date(Date.now() + 3600 * 1000).toISOString();

    let resolveLogin!: (v: Response) => void;
    const loginPromise = new Promise<Response>((res) => { resolveLogin = res; });
    globalFetch = vi.fn().mockReturnValue(loginPromise);
    vi.stubGlobal('fetch', globalFetch);

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
    });

    const [p1, p2, p3] = [manager.getToken(), manager.getToken(), manager.getToken()];

    resolveLogin({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ retval: 0, token: freshToken, valid_thru: validThru }),
    } as Response);

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);

    expect(t1).toBe(freshToken);
    expect(t2).toBe(freshToken);
    expect(t3).toBe(freshToken);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  // ─── apilogin failure ─────────────────────────────────────────────

  it('throws when apilogin returns a non-zero retval', async () => {
    globalFetch = mockFetch({ retval: -1, retdesc: 'Invalid credentials' });
    vi.stubGlobal('fetch', globalFetch);

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
    });

    await expect(manager.getToken()).rejects.toThrow('Digiseller apilogin failed');
  });

  // ─── Preemptive refresh 5 min before expiry ───────────────────────

  it('treats a token expiring within the preemptive buffer as expired', async () => {
    const almostExpired = Date.now() + 2 * 60 * 1000; // 2 min (< 5 min buffer)
    const freshToken = 'preemptively-refreshed';
    const validThru = new Date(Date.now() + 3600 * 1000).toISOString();

    globalFetch = mockFetch({ retval: 0, token: freshToken, valid_thru: validThru });
    vi.stubGlobal('fetch', globalFetch);

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
      initialCache: { accessToken: 'almost-stale', expiresAt: almostExpired, credsHash: 'abc' },
      preemptiveRefreshMs: 5 * 60 * 1000, // 5 min
    });

    const token = await manager.getToken();

    expect(token).toBe(freshToken);
    expect(globalFetch).toHaveBeenCalledTimes(1);
  });

  // ─── getDbCacheEntry snapshot ─────────────────────────────────────

  it('getDbCacheEntry reflects the latest token after a refresh', async () => {
    const freshToken = 'snapshot-token';
    const validThru = new Date(Date.now() + 3600 * 1000).toISOString();

    globalFetch = mockFetch({ retval: 0, token: freshToken, valid_thru: validThru });
    vi.stubGlobal('fetch', globalFetch);

    const manager = new DigisellerTokenManager({
      apiKey: API_KEY,
      sellerId: SELLER_ID,
      apiLoginUrl: API_LOGIN_URL,
    });

    await manager.getToken();
    const snapshot = manager.getDbCacheEntry();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.accessToken).toBe(freshToken);
    expect(snapshot!.expiresAt).toBeGreaterThan(Date.now());
    // credsHash is deterministic for a given apiKey
    expect(snapshot!.credsHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
