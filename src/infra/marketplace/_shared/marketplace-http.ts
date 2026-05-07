/**
 * Shared HTTP client for marketplace API integrations.
 *
 * Provides:
 *   - Retry with exponential backoff
 *   - Request timeout via AbortSignal
 *   - Circuit breaker (trips after N consecutive failures)
 *   - Rate limiter (sliding window)
 *   - Error normalization across providers
 *   - Lazy header resolution (for OAuth token refresh)
 */
import { createLogger, type LogContext } from '../../../shared/logger.js';

const logger = createLogger('marketplace-http');

// ─── Configuration ───────────────────────────────────────────────────

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

export interface MarketplaceHttpConfig {
  baseUrl: string;
  providerCode: string;
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  circuitBreaker?: Partial<CircuitBreakerConfig>;
  rateLimiter?: Partial<RateLimiterConfig>;
  headers?: () => Promise<Record<string, string>>;
  /**
   * Optional HMAC signing headers for outbound requests through a reverse proxy
   * (same semantics as Edge `buildProviderProxyHeaders`).
   * Receives the wire JSON body string, or empty string for GET/DELETE.
   */
  proxySigner?: (rawBody: string) => Promise<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY: RetryConfig = { maxRetries: 2, baseDelayMs: 500, maxDelayMs: 10_000 };
const DEFAULT_CB: CircuitBreakerConfig = { failureThreshold: 5, resetTimeoutMs: 60_000 };
const DEFAULT_RL: RateLimiterConfig = { maxRequests: 50, windowMs: 60_000 };

/** Prefer GraphQL `errors[].message` when present (many gateways use HTTP 4xx + JSON errors body). */
function summarizeMarketplaceErrorBody(body: string): string {
  const trimmed = body.trim().slice(0, 2000);
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as {
      errors?: ReadonlyArray<{ message?: string | undefined }>;
    };
    const errs = parsed.errors;
    if (Array.isArray(errs) && errs.length > 0) {
      const msgs = errs
        .map((e) => (typeof e?.message === 'string' ? e.message.trim() : ''))
        .filter(Boolean);
      if (msgs.length > 0) return msgs.join('; ');
    }
  } catch {
    /* plain text or truncated JSON */
  }
  return trimmed;
}

// ─── Error Types ─────────────────────────────────────────────────────

export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    public readonly providerCode: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
  ) {
    super(message);
    this.name = 'MarketplaceApiError';
  }
}

export class CircuitOpenError extends Error {
  constructor(providerCode: string) {
    super(`Circuit breaker open for ${providerCode}`);
    this.name = 'CircuitOpenError';
  }
}

export class RateLimitExceededError extends Error {
  constructor(providerCode: string) {
    super(`Rate limit exceeded for ${providerCode}`);
    this.name = 'RateLimitExceededError';
  }
}

// ─── Circuit Breaker ─────────────────────────────────────────────────

type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeout: number;

  constructor(config: CircuitBreakerConfig) {
    this.threshold = config.failureThreshold;
    this.resetTimeout = config.resetTimeoutMs;
  }

  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState { return this.state; }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}

// ─── Rate Limiter ────────────────────────────────────────────────────

class RateLimiter {
  private readonly timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(config: RateLimiterConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  canExecute(): boolean {
    this.prune();
    return this.timestamps.length < this.maxRequests;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}

// ─── HTTP Client ─────────────────────────────────────────────────────

export class MarketplaceHttpClient {
  private readonly baseUrl: string;
  private readonly providerCode: string;
  private readonly timeoutMs: number;
  private readonly retryConfig: RetryConfig;
  private readonly resolveHeaders: () => Promise<Record<string, string>>;
  private readonly proxySigner?: (rawBody: string) => Promise<Record<string, string>>;
  private readonly cb: CircuitBreaker;
  private readonly rl: RateLimiter;

  constructor(config: MarketplaceHttpConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.providerCode = config.providerCode;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    this.resolveHeaders = config.headers ?? (() => Promise.resolve({}));
    this.proxySigner = config.proxySigner;
    this.cb = new CircuitBreaker({ ...DEFAULT_CB, ...config.circuitBreaker });
    this.rl = new RateLimiter({ ...DEFAULT_RL, ...config.rateLimiter });
  }

  async get<T>(path: string, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('GET', path, undefined, options?.headers);
  }

  async post<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('POST', path, body, options?.headers);
  }

  async put<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('PUT', path, body, options?.headers);
  }

  async patch<T>(path: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('PATCH', path, body, options?.headers);
  }

  async delete<T>(path: string, options?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options?.headers);
  }

  /**
   * Send a raw GraphQL query/mutation.
   */
  async graphql<T>(body: { query: string; variables?: Record<string, unknown> }): Promise<T> {
    return this.request<T>('POST', '', body, { 'Content-Type': 'application/json' });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    if (!this.cb.canExecute()) {
      throw new CircuitOpenError(this.providerCode);
    }

    if (!this.rl.canExecute()) {
      throw new RateLimitExceededError(this.providerCode);
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(
          this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1),
          this.retryConfig.maxDelayMs,
        );
        await sleep(delay);
      }

      try {
        this.rl.record();
        const result = await this.executeRequest<T>(method, path, body, extraHeaders);
        this.cb.recordSuccess();
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (err instanceof MarketplaceApiError && err.statusCode !== undefined) {
          if (err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
            this.cb.recordFailure();
            throw err;
          }
        }

        if (attempt === this.retryConfig.maxRetries) {
          this.cb.recordFailure();
        }

        logger.warn('Request failed, retrying', {
          provider: this.providerCode,
          method,
          path,
          attempt: attempt + 1,
          maxRetries: this.retryConfig.maxRetries,
          error: lastError.message,
        } as LogContext);
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  private async executeRequest<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = path ? `${this.baseUrl}/${path.replace(/^\//, '')}` : this.baseUrl;
    const baseHeaders = await this.resolveHeaders();

    const rawBody = body !== undefined ? JSON.stringify(body) : '';
    const proxyHeaders = this.proxySigner ? await this.proxySigner(rawBody) : {};

    const headers: Record<string, string> = {
      ...baseHeaders,
      ...proxyHeaders,
      ...extraHeaders,
    };

    if (body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchPromise = fetch(url, {
      method,
      headers,
      body: body !== undefined ? rawBody : undefined,
    });

    const timeoutPromise = sleep(this.timeoutMs).then(() => {
      throw new MarketplaceApiError(
        `${this.providerCode} request timeout (${this.timeoutMs}ms)`,
        this.providerCode,
      );
    });

    try {
      const response = await Promise.race([fetchPromise, timeoutPromise]) as Response;

      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        const summary = summarizeMarketplaceErrorBody(responseBody);
        const detail = summary.length > 0 ? `: ${summary}` : '';
        throw new MarketplaceApiError(
          `${this.providerCode} API error: ${response.status} ${response.statusText}${detail}`,
          this.providerCode,
          response.status,
          summary.length > 0 ? summary : undefined,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        return await response.json() as T;
      }

      const text = await response.text();
      return text as unknown as T;
    } catch (err) {
      if (err instanceof MarketplaceApiError) throw err;

      throw new MarketplaceApiError(
        `${this.providerCode} network error: ${err instanceof Error ? err.message : String(err)}`,
        this.providerCode,
      );
    }
  }

  getCircuitState(): string { return this.cb.getState(); }

  resetCircuitBreaker(): void {
    this.cb.reset();
  }
}

// ─── Token Cache ─────────────────────────────────────────────────────

export interface OAuth2TokenConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  grantType?: string;
  extraParams?: Record<string, string>;
}

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * OAuth2 token manager with in-memory + DB cache.
 * Preemptively refreshes tokens 60s before expiry.
 */
export class OAuth2TokenManager {
  private cached: CachedToken | null = null;
  private refreshPromise: Promise<CachedToken> | null = null;
  private readonly config: OAuth2TokenConfig;
  private readonly preemptiveRefreshMs: number;

  constructor(config: OAuth2TokenConfig, preemptiveRefreshMs = 60_000) {
    this.config = config;
    this.preemptiveRefreshMs = preemptiveRefreshMs;
  }

  async getAccessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - this.preemptiveRefreshMs) {
      return this.cached.accessToken;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh().finally(() => { this.refreshPromise = null; });
    }

    const token = await this.refreshPromise;
    return token.accessToken;
  }

  loadFromCache(cached: CachedToken | null): void {
    if (cached && cached.expiresAt > Date.now()) {
      this.cached = cached;
    }
  }

  private async refresh(): Promise<CachedToken> {
    const { tokenUrl, clientId, clientSecret, grantType, extraParams } = this.config;

    const body = new URLSearchParams({
      grant_type: grantType ?? 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      ...extraParams,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`OAuth2 token refresh failed: ${response.status} ${errorText.slice(0, 500)}`);
    }

    const data = await response.json() as {
      access_token: string;
      expires_in?: number;
      token_type?: string;
    };

    const expiresIn = data.expires_in ?? 3600;
    const token: CachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    this.cached = token;
    return token;
  }
}

// ─── Timing-Safe Comparison ──────────────────────────────────────────

import { timingSafeEqual as cryptoTimingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks on token validation.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    const dummy = Buffer.alloc(Math.max(a.length, b.length));
    cryptoTimingSafeEqual(dummy, dummy);
    return false;
  }
  return cryptoTimingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ─── Helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
