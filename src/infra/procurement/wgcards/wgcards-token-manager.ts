/**
 * WgcardsTokenManager
 *
 * WGCards session tokens are obtained via POST /api/getToken and are valid for
 * 2 hours. This manager:
 *   - Caches the token in-memory with an `expiresAt` timestamp.
 *   - Accepts an optional `initialCache` loaded from `provider_accounts.cached_token`
 *     so the token survives process restarts without an extra API round-trip.
 *   - Pre-emptively refreshes 5 minutes before expiry.
 *   - Coalesces concurrent callers onto a single in-flight refresh promise.
 *   - Calls `onTokenRefreshed` after each successful refresh so the caller
 *     can persist the entry back to `provider_accounts.cached_token`.
 *
 * Token request (the HTTP call itself is delegated to a provided `fetchToken`
 * factory so this class stays free of fetch/crypto concerns and is trivially
 * testable with a stub).
 */
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('wgcards-token-manager');

/** 2 hours in milliseconds — documented token TTL. */
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/** Pre-emptive refresh 5 minutes before expiry. */
const PREEMPTIVE_REFRESH_MS = 5 * 60 * 1000;

export interface WgcardsCachedToken {
  readonly accessToken: string;
  /** Unix timestamp (ms) when this token expires. */
  readonly expiresAt: number;
}

export interface WgcardsTokenManagerOptions {
  /** Called when a fresh token is needed — must call POST /api/getToken. */
  readonly fetchToken: () => Promise<string>;
  readonly initialCache?: WgcardsCachedToken | null;
  readonly onTokenRefreshed?: (entry: WgcardsCachedToken) => void;
}

export class WgcardsTokenManager {
  private cached: WgcardsCachedToken | null;
  private refreshPromise: Promise<WgcardsCachedToken> | null = null;

  private readonly fetchToken: () => Promise<string>;
  private readonly onTokenRefreshed?: (entry: WgcardsCachedToken) => void;

  constructor(opts: WgcardsTokenManagerOptions) {
    this.fetchToken = opts.fetchToken;
    this.onTokenRefreshed = opts.onTokenRefreshed;
    this.cached = opts.initialCache ?? null;
  }

  /**
   * Returns a valid session token, refreshing via the API if needed.
   * Concurrent callers are coalesced onto the same in-flight request.
   */
  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - PREEMPTIVE_REFRESH_MS) {
      return this.cached.accessToken;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh().finally(() => {
        this.refreshPromise = null;
      });
    }

    const entry = await this.refreshPromise;
    return entry.accessToken;
  }

  /** Returns the current cached entry for external inspection or DB write-back. */
  getCacheEntry(): WgcardsCachedToken | null {
    return this.cached;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async refresh(): Promise<WgcardsCachedToken> {
    logger.info('WGCards: obtaining fresh session token');

    let accessToken: string;
    try {
      accessToken = await this.fetchToken();
    } catch (err) {
      logger.error('WGCards: getToken API call failed', err instanceof Error ? err : new Error(String(err)));
      throw err;
    }

    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const entry: WgcardsCachedToken = { accessToken, expiresAt };

    this.cached = entry;
    this.onTokenRefreshed?.(entry);

    logger.info('WGCards: session token obtained', {
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return entry;
  }
}
