import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WgcardsTokenManager, type WgcardsCachedToken } from '../src/infra/procurement/wgcards/wgcards-token-manager.js';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

describe('WgcardsTokenManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Valid cache ──────────────────────────────────────────────────────────

  it('returns the cached token without calling fetchToken when cache is still valid', async () => {
    const fetchToken = vi.fn<[], Promise<string>>();
    const mgr = new WgcardsTokenManager({
      fetchToken,
      initialCache: { accessToken: 'cached-token', expiresAt: Date.now() + TWO_HOURS_MS },
    });

    const token = await mgr.getToken();
    expect(token).toBe('cached-token');
    expect(fetchToken).not.toHaveBeenCalled();
  });

  // ─── Cold start (no cache) ────────────────────────────────────────────────

  it('calls fetchToken when no initialCache is provided', async () => {
    const fetchToken = vi.fn<[], Promise<string>>().mockResolvedValue('fresh-token');
    const mgr = new WgcardsTokenManager({ fetchToken });

    const token = await mgr.getToken();
    expect(token).toBe('fresh-token');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  // ─── Expired cache ────────────────────────────────────────────────────────

  it('refreshes when cached token is expired', async () => {
    const fetchToken = vi.fn<[], Promise<string>>().mockResolvedValue('new-token');
    const mgr = new WgcardsTokenManager({
      fetchToken,
      initialCache: { accessToken: 'stale', expiresAt: Date.now() - 1000 },
    });

    const token = await mgr.getToken();
    expect(token).toBe('new-token');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  // ─── Preemptive refresh ───────────────────────────────────────────────────

  it('refreshes preemptively when token expires within the 5-minute buffer', async () => {
    const fetchToken = vi.fn<[], Promise<string>>().mockResolvedValue('pre-refreshed-token');
    const almostExpired = Date.now() + 2 * 60 * 1000; // 2 min (< 5 min buffer)

    const mgr = new WgcardsTokenManager({
      fetchToken,
      initialCache: { accessToken: 'almost-stale', expiresAt: almostExpired },
    });

    const token = await mgr.getToken();
    expect(token).toBe('pre-refreshed-token');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('does NOT refresh when token expires outside the 5-minute buffer', async () => {
    const fetchToken = vi.fn<[], Promise<string>>();
    const safeExpiry = Date.now() + FIVE_MIN_MS + 60_000; // 6 min from now

    const mgr = new WgcardsTokenManager({
      fetchToken,
      initialCache: { accessToken: 'safe-token', expiresAt: safeExpiry },
    });

    const token = await mgr.getToken();
    expect(token).toBe('safe-token');
    expect(fetchToken).not.toHaveBeenCalled();
  });

  // ─── Concurrent coalescing ────────────────────────────────────────────────

  it('coalesces concurrent getToken calls into a single fetchToken request', async () => {
    let resolveFetch!: (v: string) => void;
    const fetchPromise = new Promise<string>((res) => { resolveFetch = res; });
    const fetchToken = vi.fn<[], Promise<string>>().mockReturnValue(fetchPromise);

    const mgr = new WgcardsTokenManager({ fetchToken });

    const [p1, p2, p3] = [mgr.getToken(), mgr.getToken(), mgr.getToken()];
    resolveFetch('coalesced-token');

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
    expect(t1).toBe('coalesced-token');
    expect(t2).toBe('coalesced-token');
    expect(t3).toBe('coalesced-token');
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  // ─── onTokenRefreshed callback ────────────────────────────────────────────

  it('calls onTokenRefreshed with the new entry after a successful refresh', async () => {
    const fetchToken = vi.fn<[], Promise<string>>().mockResolvedValue('callback-token');
    const onTokenRefreshed = vi.fn<[WgcardsCachedToken], void>();

    const mgr = new WgcardsTokenManager({ fetchToken, onTokenRefreshed });
    await mgr.getToken();

    expect(onTokenRefreshed).toHaveBeenCalledTimes(1);
    const [entry] = onTokenRefreshed.mock.calls[0]!;
    expect(entry.accessToken).toBe('callback-token');
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
    expect(entry.expiresAt).toBeLessThanOrEqual(Date.now() + TWO_HOURS_MS + 100);
  });

  it('does NOT call onTokenRefreshed when serving from cache', async () => {
    const fetchToken = vi.fn<[], Promise<string>>();
    const onTokenRefreshed = vi.fn<[WgcardsCachedToken], void>();

    const mgr = new WgcardsTokenManager({
      fetchToken,
      initialCache: { accessToken: 'hot-cache', expiresAt: Date.now() + TWO_HOURS_MS },
      onTokenRefreshed,
    });

    await mgr.getToken();
    expect(onTokenRefreshed).not.toHaveBeenCalled();
    expect(fetchToken).not.toHaveBeenCalled();
  });

  // ─── getCacheEntry ────────────────────────────────────────────────────────

  it('getCacheEntry returns null before any refresh', () => {
    const fetchToken = vi.fn<[], Promise<string>>();
    const mgr = new WgcardsTokenManager({ fetchToken });
    expect(mgr.getCacheEntry()).toBeNull();
  });

  it('getCacheEntry reflects the token after refresh', async () => {
    const fetchToken = vi.fn<[], Promise<string>>().mockResolvedValue('snapshot-token');
    const mgr = new WgcardsTokenManager({ fetchToken });

    await mgr.getToken();
    const snapshot = mgr.getCacheEntry();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.accessToken).toBe('snapshot-token');
    expect(snapshot!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('getCacheEntry returns initialCache when token has not been refreshed', () => {
    const fetchToken = vi.fn<[], Promise<string>>();
    const initial: WgcardsCachedToken = { accessToken: 'init', expiresAt: Date.now() + TWO_HOURS_MS };
    const mgr = new WgcardsTokenManager({ fetchToken, initialCache: initial });
    expect(mgr.getCacheEntry()).toEqual(initial);
  });

  // ─── fetchToken error propagation ────────────────────────────────────────

  it('propagates errors from fetchToken to all callers', async () => {
    const err = new Error('WGCards API unreachable');
    const fetchToken = vi.fn<[], Promise<string>>().mockRejectedValue(err);
    const mgr = new WgcardsTokenManager({ fetchToken });

    await expect(mgr.getToken()).rejects.toThrow('WGCards API unreachable');
  });

  it('clears the in-flight promise after a failed refresh so next call retries', async () => {
    let callCount = 0;
    const fetchToken = vi.fn<[], Promise<string>>().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('first attempt fails'));
      return Promise.resolve('recovered-token');
    });

    const mgr = new WgcardsTokenManager({ fetchToken });

    await expect(mgr.getToken()).rejects.toThrow('first attempt fails');
    // Second call should retry (the in-flight is cleared after failure)
    const token = await mgr.getToken();
    expect(token).toBe('recovered-token');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});
