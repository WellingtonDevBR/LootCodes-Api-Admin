/**
 * DigisellerTokenManager
 *
 * Digiseller uses a short-lived session token (valid ~2 hours) obtained by
 * POST /api/apilogin with a SHA-256 signature:
 *
 *   sign = sha256(api_key + timestamp_seconds)   — single-hash per Digiseller docs
 *   POST /api/apilogin { seller_id, timestamp, sign }
 *   → { retval: 0, token: "<session_token>", valid_thru: "<ISO>" }
 *
 * Reference: https://my.digiseller.com/inside/api_general.asp#token
 *
 * The session token is then appended to every API call as `?token=<session_token>`.
 *
 * This manager:
 *   - Accepts an optional `initialCache` loaded from `provider_accounts.cached_token`
 *     to survive process restarts without an extra API round-trip.
 *   - Preemptively refreshes tokens `preemptiveRefreshMs` before expiry (default 5 min).
 *   - Coalesces concurrent callers onto a single in-flight refresh.
 *   - Calls `onTokenRefreshed` after each successful refresh so the caller
 *     can persist the updated token back to the database.
 */
import { createHash } from 'crypto';
import { createLogger } from '../../../shared/logger.js';

const logger = createLogger('digiseller-token-manager');

const DEFAULT_PREEMPTIVE_REFRESH_MS = 5 * 60 * 1000; // 5 min

export interface DigisellerCachedToken {
  accessToken: string;
  expiresAt: number;   // milliseconds since epoch
  credsHash: string;   // sha256(api_key) — hex, for identity verification
}

export interface DigisellerTokenManagerOptions {
  apiKey: string;
  sellerId: number;
  apiLoginUrl: string;
  initialCache?: DigisellerCachedToken | null;
  preemptiveRefreshMs?: number;
  /** Called with the new token entry whenever the manager obtains a fresh token. */
  onTokenRefreshed?: (entry: DigisellerCachedToken) => void;
}

interface ApiLoginResponse {
  retval: number;
  retdesc?: string;
  token?: string;
  valid_thru?: string; // ISO string or "YYYY-MM-DD HH:mm:ss"
}

export class DigisellerTokenManager {
  private readonly apiKey: string;
  private readonly sellerId: number;
  private readonly apiLoginUrl: string;
  private readonly preemptiveRefreshMs: number;
  private readonly onTokenRefreshed?: (entry: DigisellerCachedToken) => void;

  /** sha256(api_key) — stored as a credential fingerprint in the DB cache entry */
  private readonly credsHash: string;

  private cached: DigisellerCachedToken | null;
  private refreshPromise: Promise<DigisellerCachedToken> | null = null;

  constructor(opts: DigisellerTokenManagerOptions) {
    this.apiKey = opts.apiKey;
    this.sellerId = opts.sellerId;
    this.apiLoginUrl = opts.apiLoginUrl;
    this.preemptiveRefreshMs = opts.preemptiveRefreshMs ?? DEFAULT_PREEMPTIVE_REFRESH_MS;
    this.onTokenRefreshed = opts.onTokenRefreshed;
    this.credsHash = sha256hex(opts.apiKey);

    this.cached = opts.initialCache ?? null;
  }

  /**
   * Returns a valid session token, refreshing via apilogin if needed.
   * Concurrent callers are coalesced onto a single in-flight request.
   */
  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - this.preemptiveRefreshMs) {
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

  /**
   * Returns the current cached token entry — useful for writing back to DB
   * after a refresh, or for seeding the next process run.
   */
  getDbCacheEntry(): DigisellerCachedToken | null {
    return this.cached;
  }

  // ─── Private ───────────────────────────────────────────────────────

  private async refresh(): Promise<DigisellerCachedToken> {
    const timestamp = Math.floor(Date.now() / 1000);
    // Digiseller sign formula: sha256(api_key + timestamp) — single hash per official docs
    const sign = sha256hex(this.apiKey + String(timestamp));

    logger.info('Digiseller apilogin: requesting fresh session token', {
      sellerId: this.sellerId,
      timestamp,
    });

    const response = await fetch(this.apiLoginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ seller_id: this.sellerId, timestamp, sign }),
    });

    let data: ApiLoginResponse;
    try {
      data = (await response.json()) as ApiLoginResponse;
    } catch {
      const text = await response.text().catch(() => '');
      throw new Error(`Digiseller apilogin failed: HTTP ${response.status} — ${text.slice(0, 300)}`);
    }

    if (data.retval !== 0 || !data.token) {
      throw new Error(
        `Digiseller apilogin failed: retval=${data.retval} ${data.retdesc ?? 'no token returned'}`,
      );
    }

    const expiresAt = parseValidThru(data.valid_thru);

    const entry: DigisellerCachedToken = {
      accessToken: data.token,
      expiresAt,
      credsHash: this.credsHash,
    };

    this.cached = entry;
    this.onTokenRefreshed?.(entry);

    logger.info('Digiseller apilogin: session token obtained', {
      sellerId: this.sellerId,
      expiresAt: new Date(expiresAt).toISOString(),
    });

    return entry;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sha256hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Digiseller returns `valid_thru` as an ISO string or "YYYY-MM-DD HH:mm:ss".
 * Fall back to 1 hour from now if unparseable.
 */
function parseValidThru(raw: string | undefined): number {
  if (!raw) return Date.now() + 3600 * 1000;
  const ms = Date.parse(raw);
  if (Number.isFinite(ms) && ms > Date.now()) return ms;
  return Date.now() + 3600 * 1000;
}
